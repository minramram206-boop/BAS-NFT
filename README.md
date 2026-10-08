# BAS — Pixel District

Living pixel-art world and citizen progression on Solana. Citizens register in
District 01, train three attributes, and burn the one official utility token to
raise a canonical score.

> **Status:** Stage 1–4 of the build order in
> [`docs/id/TECH_STACK_ID.md`](docs/id/TECH_STACK_ID.md) are partially in place.
> The web app runs end to end against authored content. The Anchor program is a
> draft that has not been compiled, deployed, or audited, and every address in
> `config/*.json` is still a placeholder. Nothing here is launch ready — see
> [Launch gate](#launch-gate).

## Quick start

Requires Node.js 22.6+ and pnpm 9+.

```bash
pnpm install     # also builds the workspace packages (postinstall)
pnpm dev         # http://localhost:3000
```

Two routes:

| Route | Screen |
| --- | --- |
| `/` | District 01 plaza — 2.5D courtyard, dialogue panel, registry, agent profile |
| `/training` | Agent Training Dojo — hero stage, attributes, drills, avatar strip |

Useful commands:

```bash
pnpm build            # packages, then the Next.js production build
pnpm verify           # typecheck + test + lint + build
pnpm test             # node:test suites of every package
pnpm dev:packages     # tsc --watch for packages/* (run beside pnpm dev)
pnpm program:check    # cargo check (requires the Solana/Anchor toolchain)
pnpm clean            # remove dist/, .next/ and tsbuildinfo files
```

## Repository layout

```text
apps/web            Next.js 15 App Router application
packages/config     typed cluster configuration, read from config/*.json
packages/content    content schema, validation, and server-only loaders
packages/chain-client  typed client for the District program
programs/district   Anchor program (registration + token-burn training)
config/             devnet.json, mainnet.json — the canonical addresses
content/en/         citizens.json — the authored English roster
docs/               product spec, tech stack, prize model, decisions, architecture
```

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) explains the module boundaries,
the server/client data flow, the build order and the asset rules.

## Documentation

Start with [`docs/AGENT_START_HERE.md`](docs/AGENT_START_HERE.md); it defines the
reading order and the authority order for every other document.

| Document | Purpose |
| --- | --- |
| [`docs/AGENT_START_HERE.md`](docs/AGENT_START_HERE.md) | Agent handoff and non-negotiable implementation rules |
| [`docs/specs/PIXEL_DISTRICT_SPEC_V2_ID.md`](docs/specs/PIXEL_DISTRICT_SPEC_V2_ID.md) | Product source of truth (Indonesian) |
| [`docs/id/TECH_STACK_ID.md`](docs/id/TECH_STACK_ID.md) | Mandated stack, monorepo structure, staged build order |
| [`docs/id/PRIZE_POOL_MODEL.md`](docs/id/PRIZE_POOL_MODEL.md) | Competitions, prize pools, winner caps, payout integrity |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Append-only implementation decision log |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Repository layout and engineering rationale |

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

## Launch gate

`config/*.json` ships placeholder addresses — `programId` is 42 characters,
which is not a valid Solana public key. `@bas/config` validates structure at
load time and exposes a separate gate for launch:

```ts
import { DEVNET_CONFIG, findPlaceholderAddresses, validateProductionReadiness } from '@bas/config';

findPlaceholderAddresses(DEVNET_CONFIG);   // what still has to be replaced
validateProductionReadiness(DEVNET_CONFIG); // throws until every address is real
```

Generate the program keypair, deploy, then write the same 43–44 character
base58 public key into `config/devnet.json`, `config/mainnet.json` and
`programs/Anchor.toml`. The mandatory release sequence is in
[`docs/AGENT_START_HERE.md`](docs/AGENT_START_HERE.md#4-required-delivery-sequence):
devnet first, mainnet deployed paused, token launched and mint bound, then
unpause, and only then open the NFT mint.

## Known gaps

- No wallet integration: `LOGIN` toggles local state and the address shown is a
  placeholder. `@solana/kit` plus Wallet Standard is the mandated integration.
- Scores in the browser are presentation state. Only `programs/district` and
  trusted server logic may write canonical progression.
- `register_citizen` does not verify collection membership yet; it needs the
  `packages/metaplex-client` adapter.
- `programs/district` has no `pause`/`unpause` instruction and has never been
  compiled in CI (no Rust toolchain in the current environment).
- `apps/worker` and the remaining packages listed in `TECH_STACK_ID.md` §11 do
  not exist yet.

Details and the reasoning behind each omission are recorded in
[`docs/DECISIONS.md`](docs/DECISIONS.md).

## License

UNLICENSED — private repository. All product documentation is written for the
project owner; source code, identifiers, tests and public UI copy are English
only, as required by the spec.
