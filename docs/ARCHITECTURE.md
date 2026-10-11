# Architecture and repository layout

This document explains how the repository is organised. Product requirements
live in [`specs/BAS_DISTRICT_SPEC_V2_ID.md`](./specs/BAS_DISTRICT_SPEC_V2_ID.md)
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
      lib/                 audio synthesizer, DOM effects, hooks, class helper
      stores/              zustand store: types, slices/ (registry, training, ui), provider, selectors
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
    src/lib.rs             #[program] entry points only; each delegates to its instruction
    src/instructions/      one file per instruction: its Accounts struct and handler
    src/state/             DistrictConfig, ApprovedTemplate, CitizenState/CitizenStat, ClaimReceipt
    src/constants.rs       PDA seeds, STAT_MAX, tiers, layout versions
    src/progression.rs     training cost formula and tiers
    src/mpl_core.rs        Metaplex Core AssetV1 reader and the shared membership check
    src/utility_token.rs   SPL Token / Token-2022 mint verification
    src/pda.rs             PDA addresses and prefund-safe account creation
    src/roles.rs           seven-role registry
    src/errors.rs          DistrictError
    src/events.rs          §13 events plus ConfigUpdated
    tests/integration/     solana-program-test suite: harness/ plus one file per area

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

### Self-hosted pixel fonts

Silkscreen and Pixelify Sans are loaded from the pinned `@fontsource` npm
packages, using only the Latin font files and weights the UI renders. Their
font files are bundled with the app at build time; no request to Google Fonts
or other external host is required, so the production build is reproducible in
an offline runner after dependency installation.

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

`config/*.json` still ships placeholder addresses. They are well-formed public
keys, so everything compiles, but none of them is deployed.

`@bas/config` therefore validates in two tiers:

- **load time** — the file exists, every field is present, non-empty, and
  correctly shaped. A malformed file breaks the build instead of shipping.
- **launch gate** — `validateProductionReadiness(config)` rejects unresolved
  critical addresses and reserved placeholder metadata hosts such as
  `*.invalid` and `example.com`. `findPlaceholderAddresses(config)` reports
  the address portion, while `findPlaceholderConfiguration(config)` reports
  both addresses and the approved-template URI prefix. Call these from
  deployment and release checks, never from rendering. A config test fails if
  any critical address in either shipped manifest slips past the gate.

The program enforces the release order itself (SPEC §5.7): only the upgrade
authority can run `initialize_config`, the district always starts paused, and
`set_paused(false)` is refused until the utility mint is bound and locked.

Before any deployment: generate the program keypair, deploy, then write the
same public key into `config/devnet.json`, `config/mainnet.json` and
`programs/Anchor.toml`; configure the deployed Core collection and a real,
production metadata host at the approved template path; then re-run the gate.

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
| `typescript` | install (runs `postinstall` → `build:packages`), `pnpm typecheck`, `pnpm test`, `pnpm lint`, `node scripts/check-assets.mjs`, `pnpm build` | The web build uses self-hosted `@fontsource` assets and does not require Google Fonts egress |
| `programs` | `cargo fmt --check`, `cargo check --all-targets`, `cargo test --lib`, then `cargo test --test integration -- --test-threads=1` | 29 unit tests (Core parser, template allowlist, state, roles, cost formula) and 63 instruction-level tests, including adversarial cases for forged assets, front-run initialization, cross-citizen claims and prefunded receipts (D-0012, D-0016). `RUSTFLAGS: -A unexpected_cfgs` and `RUST_LOG: error` keep macro warnings and runtime logs out of the summary. A real `anchor build` / `anchor test` against a validator must still run before deployment |

## 9. Known gaps

Tracked in [`DECISIONS.md`](./DECISIONS.md):

- `register_citizen`, `claim_training_credit` and `upgrade_score` verify
  collection membership by reading the Metaplex Core asset itself, and the
  asset account must be owned by the pinned Core program id (D-0011, D-0016).
  Compressed assets are rejected, because a
  `HashedAssetV1` account stores no readable owner or collection. Supporting
  them would need a Merkle tree and a separate decision.
- The web app has no wallet integration yet: `walletAddress` is a placeholder
  and `LOGIN` only toggles local state. `@solana/kit` plus Wallet Standard is
  the mandated integration.
- `apps/worker`, `packages/ai`, `packages/db`, `packages/metaplex-client`,
  `packages/mission-engine`, `packages/competition-engine` and `packages/ui`
  do not exist yet. They are later stages of `TECH_STACK_ID.md` §12. The
  required `tests/e2e` and `tests/integration` directories are present; the
  former is reserved for future Playwright browser tests, while program
  instruction tests currently live beside the Anchor crate.
- `programs/district/tests/integration/` runs the real program logic inside
  `solana-program-test` (D-0012). Two things still need `anchor build` and
  `anchor test` against a real validator before deploying: the emitted event
  payloads, which this harness cannot observe, and everything specific to the
  BPF target, including real compute-unit limits.
- The interactive district is React/CSS today. `TECH_STACK_ID.md` mandates
  Phaser 3 for Stage 4; that scene has not been built yet.
- `packages/metaplex-client`, the off-chain adapter required by
  `TECH_STACK_ID.md` §11, still does not exist. On-chain verification does not
  depend on it, but a wallet integration will.
