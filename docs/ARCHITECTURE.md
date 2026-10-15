# Architecture and repository layout

This document explains how the repository is organised. Product requirements
live in [`specs/BAS_DISTRICT_SPEC_V2_ID.md`](./specs/BAS_DISTRICT_SPEC_V2_ID.md)
and the mandated technology choices in [`id/TECH_STACK_ID.md`](./id/TECH_STACK_ID.md).

## 1. Layout

```text
apps/
  web/                     Next.js 15 App Router application
    src/
      app/                 routes (/, /missions, /training, /mint, /season, /citizen/[id]) and the root layout
      components/
        city/              city screen (top bar, sidebar, framed map), Phaser host, selected citizen card with roster tabs, mission tracker and mission popup, event card
        citizen/           profile screen, the citizen rail (left column of Missions and the city sidebar), the player strip (Training), avatar switcher, stat rows
        journey/           the route from Tier 0 to Tier 3: next-step line and path panel
        layout/            top bars with the desktop tab group, phone tab bar, screen shell and its column layout, telemetry context
        missions/          mission board, step dialog, mission copy lookup
        modal/             global dialog and the mission reward popup
        season/            season standings and prize vault
        training/          training screen
        mint/              the mint screen (a citizen is minted, not picked) and the panel shown to a wallet without a citizen
        token/             where the official token is bought (Pump.fun)
        ui/                shared primitives (PixelIcon, StatBar, PanelTab, Ribbon, ReceiptRow, icons)
      config/              presentation constants and server-side cluster telemetry
      game/                Phaser scene, ambience, grid and the generated city layout
      lib/                 data adapter (types, districts, missions, journey, season, mock/, chain/), Wallet Standard layer (wallet/), audio synthesizer, DOM effects, formatters, class helper, `usePersistedFlag` (open/closed state of the city panels kept in the browser)
      messages/            all public English copy (en.json) and formatMessage
      stores/              zustand store: types, slices/ (district, city, ui), provider, selectors, useJourney
    test/                  node:test for the journey planner and the mission data (hooks.mjs resolves the `@/` imports)
    public/
      avatars/             120x57 portraits referenced by content
      characters/          1000x1000 art referenced by content
      sprites/citizens/    128x128 map sprites (<id> side portrait, optional <id>-front and <id>-back) referenced by content
      icons/               the six icons the UI actually renders
      images/city/         generated city ground, props sheet and district lock overlays
      images/district/     training stage background
      licenses/            OFL texts of the bundled fonts
  mission-server/          mission rules and claim signing (D-0059): catalog, rules, store, chain reader, HTTP API
    src/                   see docs/MISSION_SERVER.md
    test/                  rules, claim transaction, sign-in, service flow, HTTP, file store

packages/
  config/                  typed cluster configuration, read from config/*.json
  content/                 content schema, validation, and server-only loaders
  chain-client/            typed client for the District program
  metaplex-client/         Node-only builders for the public sale and the mint transaction (Umi, Core Candy Machine)

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
  en/citizens.archive.json citizens held back from the roster
  en/roles.json            seven-role registry: starting stats and mint supply

scripts/
  check-assets.mjs         asset guard: no orphan and no duplicate public file
  check-font-licenses.mjs  font license texts match the bundled fonts
  check-metadata.mjs       NFT metadata files match the program's URI and role rules
  check-public-copy.mjs    public copy lives in English only
  gen-metadata.mjs         writes apps/web/public/templates/7/*.json (pnpm metadata)
  gen-program-id.mjs       one-off program keypair and placeholder generator
  devnet/                  deploy.sh, setup.mjs, mint-setup.mjs (Candy Machine), mint-simulate.mjs and the dependency-free solana.mjs they use
  mock-city/               generate_city.py: city images and cityLayout.json

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
| `@bas/chain-client` | Node only | `@bas/config` | `DistrictChainClient`, protocol constants, receipt types, instruction builders, account decoders |
| `@bas/chain-client/browser` | browser **and** Node | `@solana/kit` only | the same constants, instruction builders and account decoders, without `@bas/config` |
| `@bas/chain-client/stats` | browser **and** Node | none | stat and tier arithmetic |
| `@bas/metaplex-client` | Node only | `@bas/chain-client`, Umi, `mpl-core`, `mpl-core-candy-machine` | `createMintBackend()`, `buildMintTransaction()`, `readSale()`, `buildCreateSale()`, `buildAddItems()`, royalties helpers |

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

The store only holds minted citizens. `DistrictDataSource.mintCitizen()` is the
one way a citizen enters it: the mock draws one of the roster citizens nobody
holds yet, takes the mint price in SOL and registers it at its role scores; the
chain source will send the Candy Machine mint and `register_citizen` as one
transaction (SPEC §6.3). `NEXT_PUBLIC_BAS_MOCK_START=empty` starts the mock
wallet without any citizen, to try the first mint.

## 3a. Mode chain

`NEXT_PUBLIC_BAS_DATA=chain` swaps the mock `DistrictDataSource` for
`lib/data/chain/chainDataSource.ts` (D-0060). The default stays the mock, so
`pnpm dev` works without a wallet, a cluster or a server.

| Concern | Where it comes from |
| --- | --- |
| Citizens of the connected wallet | Core assets of the collection (`getProgramAccounts`, memcmp on the collection field), joined with `CitizenState` by asset. The roster record comes from the serial in the metadata URI (`NNN-role.json`) |
| Scores, credits, tier | `CitizenState` on chain |
| `$BAS` balance | the owner's token account for `utilityTokenMint` |
| Missions | `apps/mission-server` (sign-in with `signMessage`, steps, claim) |
| Claim and training | transactions built from `@bas/chain-client/browser` and signed by the wallet through Wallet Standard (`solana:signTransaction`) |
| Season standings | `GET /season/standings` on the mission server |
| Public sale (supply, minted, minted by this wallet) | the Core Candy Machine account (`itemsAvailable`, `itemsRedeemed`) and the wallet's `MintCounter` account; the manifest `maxSupply` is not used |
| Mint | `POST /mint/prepare` on the mission server returns a transaction signed by everything but the buyer's wallet; the wallet signs and sends it (D-0061) |

Rules that keep this layer honest:

1. The browser bundle imports `@bas/chain-client/browser` (or `/stats`), never
   the package root, because the root reaches `node:fs` through `@bas/config`.
   `packages/chain-client/test/browser.test.ts` fails if that changes.
2. Every write goes through the wallet. A declined prompt answers `declined`;
   a transaction that fails after signing answers `transaction-failed` and the
   adapter re-reads the chain, so the screen never keeps a guess.
3. Environment variables: `NEXT_PUBLIC_BAS_DATA`, `NEXT_PUBLIC_MISSION_SERVER_URL`
   and `NEXT_PUBLIC_SOLANA_RPC_URL` (https only; plain http is accepted for
   localhost on devnet). `getProgramAccounts` is restricted on many public RPC
   endpoints, so a hosted RPC is recommended.
4. `mintCitizen()` asks the server for the mint transaction, has the wallet
   sign and send it, then re-reads the chain until the new citizen is visible.
   The transaction is `setComputeUnitLimit`, the Candy Guard `mintV1` (0.01 SOL
   to the treasury, one mint per wallet, `thirdPartySigner` = the server's mint
   key) and `register_citizen`, all in one packet, so a citizen never exists
   without its `CitizenState`. Only the Node-only `@bas/metaplex-client` builds
   it; the browser reads the sale through `@bas/chain-client/browser`.

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
| `public/characters/<id>.png`, `public/avatars/<id>.png`, `public/sprites/citizens/<id>.png`, `public/sprites/citizens/<id>-front.png`, `public/sprites/citizens/<id>-back.png` | `content/en/citizens.json` (no screen renders `avatar` yet; `spriteFront` and `spriteBack` are optional) |
| `public/images/city/*.png` | `apps/web/src/game/CityScene.ts`, produced by `scripts/mock-city/generate_city.py` |
| `public/images/district/courtyard_stage_bg.png` | `apps/web/src/components/training/TrainingScreen.tsx` |
| `public/icons/*.png` | `PixelIcon` call sites in `apps/web/src/components` |

Two guards keep this true:

- `packages/content/test/citizens.test.ts` fails when the roster points at a
  sprite (front or back) that does not exist in `apps/web/public`.
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

The shell never hardcodes cluster values. `app/layout.tsx` calls
`loadDistrictTelemetry()` (server-only), which reads the resolved cluster
through `@bas/config` and passes `DistrictTelemetry` down through
`DistrictTelemetryProvider`. Today the layout uses it to seed the store with the
base training cost and token decimals, so training costs come from the active
cluster's manifest. `useDistrictTelemetry()` has no consumer yet: the header
shows a mock-data badge, not a cluster label, program id or supply.

Measured values that do not exist yet — latency, sync state — are not displayed.

## 8. Continuous integration

`.github/workflows/verify.yml` runs two jobs on every push to `main` and every
pull request:

| Job | Steps | Notes |
| --- | --- | --- |
| `typescript` | install (runs `postinstall` → `build:packages`), `pnpm typecheck`, `pnpm test`, `pnpm lint`, `node scripts/check-assets.mjs`, `pnpm build` | The web build uses self-hosted `@fontsource` assets and does not require Google Fonts egress |
| `programs` | `cargo fmt --check`, `cargo check --all-targets`, `cargo test --lib`, then `cargo test --test integration -- --test-threads=1` | 31 unit tests (32 in the `cargo test` summary, which also counts the `test_id` that `declare_id!` generates; Core parser, template allowlist, state, roles, cost formula) and 63 instruction-level tests, including adversarial cases for forged assets, front-run initialization, cross-citizen claims and prefunded receipts (D-0012, D-0016). `RUSTFLAGS: -A unexpected_cfgs` and `RUST_LOG: error` keep macro warnings and runtime logs out of the summary. A real `anchor build` / `anchor test` against a validator must still run before deployment |

## 9. Known gaps

Tracked in [`DECISIONS.md`](./DECISIONS.md):

- `register_citizen`, `claim_training_credit` and `upgrade_score` verify
  collection membership by reading the Metaplex Core asset itself, and the
  asset account must be owned by the pinned Core program id (D-0011, D-0016).
  Compressed assets are rejected, because a
  `HashedAssetV1` account stores no readable owner or collection. Supporting
  them would need a Merkle tree and a separate decision.
- The wallet layer (`lib/wallet`, Wallet Standard through `@solana/kit`) is
  only used in chain mode. In mock mode the wallet is still a fixture and the
  connect button opens the wallet dialog without a real wallet.
- Nothing serves the NFT metadata at `/templates/<id>/` yet. The approved
  prefix is locked by `initialize_config` (D-0027), so a route or static folder
  for it has to exist before `scripts/devnet/setup.mjs` runs.
- `apps/worker`, `packages/ai`, `packages/db`,
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
- The city is a Phaser 3 scene (D-0021) fed with mock data through the
  `DistrictDataSource` adapter in `apps/web/src/lib/data`. The chain-backed data
  source exists (D-0060, section 3a); the mock stays the default.
- `packages/metaplex-client` exists (D-0061) and builds the public sale and the
  mint transaction. It has been checked against the Candy Machine and Candy
  Guard sources and unit-tested, but not yet run against the deployed
  programs: use `pnpm devnet:mint-simulate` first.
- The agents of SPEC §3.3 (owner-only conversational citizens, Phase E:
  OpenRouter gateway, Postgres, Redis, worker) are not started. They need
  `apps/worker`, `packages/ai` and `packages/db`, and come after the devnet
  end-to-end test and before the mainnet mint opens (D-0061).
