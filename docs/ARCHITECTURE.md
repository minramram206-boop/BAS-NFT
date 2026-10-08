# Architecture and repository layout

This document explains how the repository is organised. Product requirements
live in [`specs/PIXEL_DISTRICT_SPEC_V2_ID.md`](./specs/PIXEL_DISTRICT_SPEC_V2_ID.md)
and the mandated technology choices in [`id/TECH_STACK_ID.md`](./id/TECH_STACK_ID.md).

## 1. Layout

```text
apps/
  web/                     Next.js 15 App Router application
    src/
      app/                 routes and the root layout
      components/
        layout/            arcade shell, status bar
        hud/               header bars and their shared parts
        district/          District 01 plaza, dialogue, registry, agent card
        training/          Agent Training Dojo
        modal/             global dialog
        ui/                shared primitives (PixelIcon, PixelSprite, StatMeter, TrainStatButton)
      config/              presentation constants, stage tuning, stat metadata, copy
      lib/                 audio synthesizer, hooks, class helper
      stores/              zustand store factory, provider, selectors
    public/
      avatars/             120x57 portraits referenced by content
      characters/          1000x1000 sprites referenced by content
      icons/               the six icons the UI actually renders
      images/district/     plaza stage background

packages/
  config/                  typed cluster configuration, read from config/*.json
  content/                 content schema, validation, and server-only loaders
  chain-client/            typed client for the District program

programs/
  Anchor.toml              Anchor toolchain and program ids
  district/                Anchor program: citizen registration and token-burn training
    src/lib.rs             instructions and account constraints
    src/state.rs           DistrictConfig, CitizenState, CitizenStat, STAT_MAX
    src/errors.rs          DistrictError
    src/events.rs          CitizenRegistered, StatTrained, DistrictPausedChanged
    src/mpl_core.rs        Metaplex Core AssetV1 prefix reader + Rust unit tests

config/
  devnet.json              devnet addresses and parameters
  mainnet.json             mainnet addresses and parameters

content/
  en/citizens.json         authored English citizen roster

scripts/
  check-assets.mjs         asset guard: no orphan and no duplicate public file

docs/                      this directory
tests/                     reserved for e2e and integration suites (TECH_STACK_ID.md §11)
.github/workflows/         verify.yml: TypeScript checks, then cargo check and both Rust test suites
```

## 2. Package boundaries

| Package | Runs in | Depends on | Exposes |
| --- | --- | --- | --- |
| `@bas/config` | Node only | `node:fs`, `node:path`, `node:module` | validated `DEVNET_CONFIG` / `MAINNET_CONFIG`, `getNetworkConfig()`, `resolveNetwork()`, `validateProductionReadiness()`, `loadRepoJson()` |
| `@bas/content` | browser **and** Node | none (browser-safe) | `CitizenRecord`, `StatKey`, `MAX_STAT_SCORE`, `STAT_KEYS`, `parseCitizenRoster()` |
| `@bas/content/server` | Node only | `@bas/config`, `server-only` | `getCitizens()`, `loadCitizens()`, `getCitizenById()`, `getDefaultCitizenId()` |
| `@bas/chain-client` | Node only | `@bas/config` | `DistrictChainClient`, protocol constants, receipt types |

Two rules keep these boundaries honest:

1. **`packages/*/src` must not import Node built-ins** unless the module is
   behind the `/server` entry, which imports `server-only`. A client import of
   that entry fails the build instead of silently bundling `node:fs`.
2. **`apps/web` must not re-declare domain data.** Stat caps, stat keys and the
   citizen shape come from `@bas/content`; cluster addresses come from
   `@bas/config`.

`packages/*` are compiled to `dist/` and consumed through their `exports` map.
Next.js keeps `@bas/config` and `@bas/content` out of the server bundle via
`serverExternalPackages`, so their file-system access runs in Node.

## 3. Server/client data flow

```text
content/en/citizens.json
        │  read + validated at request time
        ▼
@bas/content/server  ──►  app/layout.tsx (Server Component)
                                │  serialised props
                                ▼
                        BasStoreProvider (Client Component)
                                │  createBasStore({ citizens })
                                ▼
                        zustand store, one instance per session
                                │  single-value selectors
                                ▼
                        district / training components
```

The store is created in the root layout, not in a page, so session progression
(a trained stat, a minted citizen) survives client-side navigation between `/`
and `/training`. It is seeded synchronously during the first render, which is
why the pre-rendered HTML and the hydrated markup are identical — the registry
is never empty on first paint.

Nothing in the store is canonical. Ownership, progression, burns, credits and
claims must be verified by `programs/district` and trusted server logic.

## 4. Build order

```bash
pnpm install          # installs and runs postinstall -> build:packages
pnpm build:packages   # tsc for @bas/config, @bas/content, @bas/chain-client
pnpm typecheck        # build:packages, then tsc --noEmit everywhere
pnpm test             # builds, then node:test per package
pnpm lint             # next lint for the web app
pnpm build            # build:packages && next build
pnpm verify           # typecheck + test + lint + build
```

`pnpm dev` builds the packages once and then starts Next.js. Use
`pnpm dev:packages` in a second terminal when you are editing a package and
want `tsc --watch`.

Do not run `pnpm build` while `pnpm dev` is running: both write to
`apps/web/.next`, and the dev server then fails with a stale
`Cannot find module './<chunk>.js'`. Stop the dev server, or run
`rm -rf apps/web/.next` and start it again.

### Offline production builds

`next/font/google` downloads Silkscreen and Pixelify Sans during `next build`.
On a runner without internet access the build fails. Either allow
`fonts.googleapis.com` and `fonts.gstatic.com`, or set
`NEXT_FONT_GOOGLE_MOCKED_RESPONSES` (see `.env.example`). `next dev` does not
fail: it logs the error and uses a fallback font.

## 5. Assets

Every sprite the UI renders is referenced from exactly one place:

| Asset | Referenced by |
| --- | --- |
| `public/characters/<id>.png`, `public/avatars/<id>.png` | `content/en/citizens.json` |
| `public/images/district/courtyard_stage_bg.png` | `STAGE.backgroundImage` in `apps/web/src/config/constants.ts` |
| `public/icons/*.png` | `PixelIcon` call sites in `apps/web/src/components` |

Two guards keep this true:

- `packages/content/test/citizens.test.ts` fails when the roster points at a
  sprite that does not exist in `apps/web/public`.
- `scripts/check-assets.mjs` (run as `pnpm assets`, and as the `@bas/web` test)
  fails when a public file is referenced by nothing, or when two public files
  are byte-identical.

Experiment renders, mockup crops and previews do not belong in the repository;
keep them outside the working tree.

## 6. Launch gate

`config/*.json` still ships placeholder addresses. `programId` is 42
characters, which is not a valid Solana public key (43–44 base58 characters).

`@bas/config` therefore validates in two tiers:

- **load time** — the file exists, every field is present, non-empty, and
  correctly shaped. A malformed file breaks the build instead of shipping.
- **launch gate** — `validateProductionReadiness(config)` and
  `findPlaceholderAddresses(config)` reject any address that is not a
  43–44 character base58 key. Call them from deployment and release checks,
  never from rendering.

Before any deployment: generate the program keypair, deploy, then write the
same public key into `config/devnet.json`, `config/mainnet.json` and
`programs/Anchor.toml`, and re-run the gate.

## 7. Cluster telemetry in the UI

The shell never hardcodes a cluster label, program id, or supply. `app/layout.tsx`
calls `loadDistrictTelemetry()` (server-only), which reads the resolved cluster
through `@bas/config` and passes `DistrictTelemetry` down through
`DistrictTelemetryProvider`. Header pill, ticker and status bar all render from
that object, so switching `NEXT_PUBLIC_SOLANA_NETWORK` updates every label.

Measured values that do not exist yet — latency, sync state — are not displayed.

## 8. Continuous integration

`.github/workflows/verify.yml` runs two jobs on every push to `main` and every
pull request:

| Job | Steps | Notes |
| --- | --- | --- |
| `typescript` | install (runs `postinstall` → `build:packages`), `pnpm typecheck`, `pnpm test`, `pnpm lint`, `node scripts/check-assets.mjs` | `next build` is deliberately excluded: `next/font` needs egress to `fonts.googleapis.com`. Enable it once the runner has network access or `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` is provided |
| `programs` | `cargo check --all-targets`, then `cargo test --lib`, then `cargo test --test integration -- --test-threads=1` | Catches Rust syntax and type errors, runs the 9 host-side unit tests for the Metaplex Core asset parser — the only automated proof that the collection check reads the right offsets — and then the 18 instruction-level tests (D-0012). The job sets `RUSTFLAGS: -A unexpected_cfgs` and `RUST_LOG: error`, without which anchor macro warnings and runtime debug logs bury the summary. A real `anchor build` / `anchor test` against a validator must still run before deployment |

## 9. Known gaps

Tracked in [`DECISIONS.md`](./DECISIONS.md):

- `register_citizen` verifies collection membership by reading the Metaplex
  Core asset itself (D-0005, D-0011). Compressed assets are rejected, because a
  `HashedAssetV1` account stores no readable owner or collection. Supporting
  them would need a Merkle tree and a separate decision.
- The web app has no wallet integration yet: `walletAddress` is a placeholder
  and `LOGIN` only toggles local state. `@solana/kit` plus Wallet Standard is
  the mandated integration.
- `apps/worker`, `packages/ai`, `packages/db`, `packages/metaplex-client`,
  `packages/mission-engine`, `packages/competition-engine`, `packages/ui` and
  `tests/` do not exist yet. They are later stages of `TECH_STACK_ID.md` §12.
- `programs/district` now has an instruction-level suite: 18 tests in
  `programs/district/tests/integration.rs` run the real program logic inside
  `solana-program-test`, next to `cargo check --all-targets` and the 9 host-side
  unit tests (D-0012). Two things still need `anchor build` and `anchor test`
  against a real validator before deploying: the emitted event payloads, which
  this harness structurally cannot observe, and everything specific to the BPF
  target, including real compute-unit limits. `set_paused` also still needs
  owner sign-off, because it touches authority (D-0006).
- `packages/metaplex-client`, the off-chain adapter required by
  `TECH_STACK_ID.md` §11, still does not exist. On-chain verification does not
  depend on it, but a wallet integration will.
