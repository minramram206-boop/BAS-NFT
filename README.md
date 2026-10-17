# BAS — BAS District

Living pixel-art world and citizen progression on Solana. Citizens register in
District 01, train three attributes, and burn the one official utility token to
raise a canonical score.

> **Status:** everything runs on devnet and is for testing only. The
> `district` program (registration, mission credits, token-burn training),
> the `market` program (fixed-price sales, offers and auctions) and the
> `prize_vault` program (season prize vault and Merkle claims) are deployed
> there; citizens are minted through a Core Candy Machine, missions are
> checked and signed by `apps/mission-server`, and citizens talk through
> `apps/chat-server`. No program is audited, clans are not built yet, and
> mainnet has no addresses of its own. Nothing here is launch ready — see
> [Launch gate](#launch-gate) and [Known gaps](#known-gaps).

## Quick start

Requires Node.js 22.6+ and pnpm 9+.

```bash
pnpm install     # also builds the workspace packages (postinstall)
pnpm dev         # http://localhost:3000
```

Routes:

| Route | Screen |
| --- | --- |
| `/` | District 01 city (Phaser), the selected citizen and the next step |
| `/missions` | Mission board and the mission being played |
| `/training` | Training: a credit and `$BAS` raise one stat |
| `/season` | Season standings by bracket and the prize pool |
| `/market` | Fixed-price sales, offers, auctions and finished sales |
| `/studio` | BAS Studio: the district's music and videos (tap the studio in the city) |
| `/mint` | The public sale: one citizen per wallet |
| `/citizen/[id]` | A citizen's profile, history, chat and market actions |

`pnpm dev` runs the web app on mock data. `pnpm dev:all` starts Postgres and
Redis in Docker, then the mission server, the chat server, the worker and the
web app; set `NEXT_PUBLIC_BAS_DATA=chain` in `.env` to play against devnet
(see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) section 3a).

Useful commands:

```bash
pnpm build            # packages, then the Next.js production build
pnpm verify           # typecheck + test + lint + build
pnpm test             # node:test suites + the asset guard
pnpm assets           # asset guard only: no orphan and no duplicate public file
pnpm dev:packages     # tsc --watch for packages/* (run beside pnpm dev)
pnpm program:check    # cargo check --all-targets (requires the Rust toolchain)
pnpm program:test     # cargo test: 31 unit tests + 63 instruction-level tests
pnpm program:build    # cargo build-sbf: the deployable target/deploy/district.so
pnpm program:test-sbf # the same tests against the built SBF binary
pnpm clean            # remove dist/, .next/ and tsbuildinfo files
```

Do not run `pnpm build` while `pnpm dev` is running: both write to
`apps/web/.next` and the dev server then fails on a stale chunk. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## BAS Studio playlist

The studio plays what `apps/web/src/config/studio.json` lists:

```json
{
  "tracks": [
    { "src": "/studio/night-market.mp3", "title": "Night Market", "artist": "BAS House Band", "cover": "/studio/night-market.jpg" },
    { "src": "/studio/district-live.mp4", "title": "District Live" }
  ]
}
```

Files go in `apps/web/public/studio/`, and `src` starts with `/studio/`. A
long video is better kept on a CDN or any `https://` address, since GitHub
refuses files over 100 MB. Audio: mp3, m4a, aac, ogg, opus, wav, flac.
Video: mp4 (H.264), webm, mov. `title` defaults to the file name; `artist`
and `cover` are optional. `pnpm --filter @bas/web test` fails when a listed
local file is missing. Music keeps playing while the player moves between
screens; videos play on the studio page only.

## Building the program

The SBF build needs the Solana 1.18.26 release (`cargo-build-sbf`,
`cargo-test-sbf`, `solana-test-validator`), which brings platform-tools v1.41
and its rustc 1.75. `rust-version = "1.75.0"` in `Cargo.toml` keeps
`Cargo.lock` on dependency versions that compiler accepts, and the lock file
stays at format version 3, the newest its cargo reads. Anchor CLI 0.30.1 is
only needed for `anchor deploy` and `anchor keys sync`: `anchor build` rewrites
`declare_id!` from a fresh `target/deploy` keypair, so it is not used here.

Measured on 9 October 2026 with those versions:

| What | Result |
| --- | --- |
| `district.so` | 469,304 bytes |
| Deploy to a local validator | 3.27 SOL of rent for the program data account |
| Unit tests | 31 passed |
| Instruction tests on the SBF binary | 63 passed |
| Largest compute use | `initialize_config` 29,589 CU, `register_citizen` 24,804, `claim_training_credit` 24,943, `upgrade_score` 20,499 (limit 200,000) |
| `initialize_config` on `solana-test-validator` | succeeded, 29,129 CU |

## Continuous integration

`.github/workflows/verify.yml` runs on every push to `main` and every pull
request:

- **typescript** — install (builds the packages), typecheck, unit tests, lint,
  the asset guard, and a Next.js production build using self-hosted fonts.
- **programs** — `cargo fmt --check`, `cargo check --all-targets`, then
  `cargo test --lib` (unit tests for the Core parser, template allowlist,
  state, roles and cost formula), then `cargo test --test integration`
  (instruction-level tests that run the real program logic inside
  `solana-program-test`, including attacks such as forged Core assets and
  front-run initialization). No validator, no BPF build and no Anchor CLI are
  involved; see D-0012 for what that can and cannot prove.

The Silkscreen and Pixelify Sans fonts are bundled from pinned `@fontsource`
packages, so the production build does not need access to Google Fonts. Their
copyright notices and OFL license texts are served from
`/licenses/silkscreen-OFL.txt` and `/licenses/pixelify-sans-OFL.txt`.

## Repository layout

```text
apps/web            Next.js 15 App Router application and the Phaser city
apps/mission-server mission rules, claim signing, mint offers and the market index (docs/MISSION_SERVER.md)
apps/chat-server    citizen chat through @bas/ai
apps/worker         background upkeep for chat: summaries and public history lines
packages/ai         owner-only citizen chat: prompt, reply checks, quota and budget
packages/chat-store Postgres and Redis storage for chat and the market history, with migrations
packages/server-kit what the servers share: the wallet bearer token, asset reads, HTTP helpers
packages/config     typed cluster configuration, read from config/*.json, and the launch gate
packages/content    content schema, validation, and server-only loaders
packages/chain-client  typed clients for the district, market and prize vault programs
packages/metaplex-client  Node-only builders for the Candy Machine sale and the mint transaction
programs/district   Anchor program (registration, mission credits, token-burn training)
programs/market     Anchor program (listings, offers, auctions; docs/MARKET.md)
programs/prize_vault  Anchor program (season prize vault, Merkle claims; docs/PRIZE_VAULT.md)
config/             devnet.json, mainnet.json — the canonical addresses
content/en/         citizens.json — the authored English roster
scripts/            asset, metadata and launch checks; scripts/devnet — deploy and setup
docs/               product spec, tech stack, prize model, decisions, architecture, market
.github/workflows/  verify.yml — CI
```

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) explains the module boundaries,
the server/client data flow, the build order and the asset rules.

## Documentation

Start with [`docs/AGENT_START_HERE.md`](docs/AGENT_START_HERE.md); it defines the
reading order and the authority order for every other document.

| Document | Purpose |
| --- | --- |
| [`docs/AGENT_START_HERE.md`](docs/AGENT_START_HERE.md) | Agent handoff and non-negotiable implementation rules |
| [`docs/specs/BAS_DISTRICT_SPEC_V2_ID.md`](docs/specs/BAS_DISTRICT_SPEC_V2_ID.md) | Product source of truth (Indonesian) |
| [`docs/id/TECH_STACK_ID.md`](docs/id/TECH_STACK_ID.md) | Mandated stack, monorepo structure, staged build order |
| [`docs/id/PRIZE_POOL_MODEL.md`](docs/id/PRIZE_POOL_MODEL.md) | Competitions, prize pools, winner caps, payout integrity |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Append-only implementation decision log |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Repository layout and engineering rationale |
| [`docs/PRIZE_VAULT.md`](docs/PRIZE_VAULT.md) | The season prize vault: accounts, claims, the devnet flow |

## Single sources of truth

No configuration or content value is re-typed in TypeScript.

| Data | File | Read by |
| --- | --- | --- |
| Cluster addresses and parameters | `config/devnet.json`, `config/mainnet.json` | `@bas/config`, validated on load |
| Citizen roster | `content/en/citizens.json` | `@bas/content/server`, validated per request |
| Sprites | `apps/web/public/{avatars,characters,icons,images}` | referenced only from the roster or `apps/web/src/config/constants.ts` |

Tests fail when a config field is malformed, when the roster references a
sprite that does not exist, or when the stat model diverges between
`@bas/content`, `@bas/chain-client` and `programs/district`.

The header and status bar read their cluster label, program id and supply from
`config/<network>.json` through `apps/web/src/config/telemetry.ts`, so the UI
can never advertise a cluster the deployment is not running on. Values that are
not measured — latency, sync state — are not displayed at all.

## Launch gate

`config/devnet.json` holds the devnet test deployment; `config/mainnet.json`
still ships placeholder addresses and an example metadata host. Every address
is a well-formed 32 byte base58 public key — `@bas/config` rejects anything
else at load time, because `declare_id!` parses the program id at compile
time. Readiness for launch is a separate check:

```ts
import {
  DEVNET_CONFIG,
  findPlaceholderAddresses,
  findPlaceholderConfiguration,
  validateProductionReadiness,
} from '@bas/config';

findPlaceholderAddresses(DEVNET_CONFIG);      // unresolved public keys
findPlaceholderConfiguration(DEVNET_CONFIG); // public keys and metadata origin
validateProductionReadiness(DEVNET_CONFIG);   // throws until both are production-ready
```

The program id is the devnet program (D-0027), whose keypair lives in the
gitignored `programs/district/keypair.json`. Devnet is deployed and set up
from the owner's machine with
[`docs/id/DEVNET_DEPLOY_ID.md`](docs/id/DEVNET_DEPLOY_ID.md):

```bash
bash scripts/devnet/deploy.sh   # WSL or Linux: solana program deploy
pnpm devnet:setup                # token mirror, Core collection, initialize, lock, unpause
```

`pnpm devnet:setup` writes the new addresses into `config/devnet.json`.
`pnpm test` fails if `declare_id!`, `Anchor.toml` and the two config files
disagree. `validateProductionReadiness` keeps throwing for mainnet while any
critical address is a shipped placeholder (`REPO_PLACEHOLDER_ADDRESSES`) or the
devnet program id (`DEVNET_ONLY_ADDRESSES`), while any address, the RPC or the
metadata origin is copied from `config/devnet.json` (D-0094), or while the
approved-template URI points at a reserved example host. Everything on devnet
is for testing only, so mainnet gets its own program keypairs, wallets,
collection and metadata origin. The mission server, the chat server and the
web build refuse to start on mainnet until the gate passes, and
`pnpm mainnet:check` lists what is still missing.

The mandatory release sequence is in
[`docs/AGENT_START_HERE.md`](docs/AGENT_START_HERE.md#4-required-delivery-sequence):
devnet first, mainnet deployed paused, token launched and mint bound, then
unpause, and only then open the NFT mint.

The program enforces that order on chain (D-0016):

1. `initialize_config` only succeeds when signed by the program's upgrade
   authority, so run it right after the deploy with the deploy key and
   before transferring the upgrade authority to the multisig. The district
   always starts paused.
2. `set_utility_mint(expected_decimals)` accepts an initialized SPL Token or
   Token-2022 mint whose decimals match `tokenDecimals` (D-0017).
3. `lock_utility_mint` makes the binding permanent.
4. Only then does `set_paused(false)` succeed.

## Known gaps

- Devnet only. Every address, wallet and key in use is a test value;
  mainnet gets its own (D-0094), and `pnpm mainnet:check` lists what is
  missing.
- No program is audited (SPEC §16). The market holds SOL for auction
  bids and open offers, so its audit comes before any mainnet use.
- The season prize vault (D-0019, D-0101, D-0102, `docs/PRIZE_VAULT.md`) is
  deployed on devnet (`5A2vzRDhfPfzpZrtvmhx6HFLLD2xmdcHStDwzPcNuXUP`). One
  citizen per wallet per competition, the Master achievements and a minimum
  prize are not checked yet.
- Clans (D-0023) and the Squads multisig that will hold the program
  authorities (D-0024) are not built or tried yet.
- `pnpm dev` without `NEXT_PUBLIC_BAS_DATA=chain` runs on mock data with a
  mock wallet (D-0020); scores there are presentation only. On chain, only
  `programs/district` and the mission server write progression.
- Solflare is the wallet tried on devnet; Phantom and Backpack are not tried
  yet.
- The roster covers the citizens minted on devnet so far; every metadata file
  must still be named `<serial>-<role>.json` under the approved template
  prefix (D-0022) before the mainnet mint.
- `/market/activity` sends the whole market history on every poll; it needs
  paging once the market is busy.

Details and the reasoning behind each omission are recorded in
[`docs/DECISIONS.md`](docs/DECISIONS.md).

## License

UNLICENSED — private repository. All product documentation is written for the
project owner; source code, identifiers, tests and public UI copy are English
only, as required by the spec.
