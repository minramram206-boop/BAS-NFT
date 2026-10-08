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

config/
  devnet.json              devnet addresses and parameters
  mainnet.json             mainnet addresses and parameters

content/
  en/citizens.json         authored English citizen roster

docs/                      this directory
tests/                     reserved for e2e and integration suites (TECH_STACK_ID.md §11)
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

`packages/content/test/citizens.test.ts` fails when the roster points at a
sprite that does not exist in `apps/web/public`, so the two cannot drift apart.
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

## 7. Known gaps

Tracked in [`DECISIONS.md`](./DECISIONS.md):

- `register_citizen` does not yet verify that the presented asset belongs to
  the official Metaplex Core collection. That check needs the
  `packages/metaplex-client` adapter required by `TECH_STACK_ID.md` §11.
- The web app has no wallet integration yet: `walletAddress` is a placeholder
  and `LOGIN` only toggles local state. `@solana/kit` plus Wallet Standard is
  the mandated integration.
- `apps/worker`, `packages/ai`, `packages/db`, `packages/metaplex-client`,
  `packages/mission-engine`, `packages/competition-engine`, `packages/ui` and
  `tests/` do not exist yet. They are later stages of `TECH_STACK_ID.md` §12.
- `programs/district` has no `pause`/`unpause` instruction even though
  `DistrictConfig.is_paused` gates `register_citizen` and `train_stat`, and the
  release sequence requires mainnet to start paused.
