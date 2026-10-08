# Pixel District — Technology Stack

_Status: RECOMMENDED. Dokumen internal berbahasa Indonesia. Seluruh source code, comments, identifiers, logs, errors, tests, API schemas, dan public UI menggunakan bahasa Inggris._

## 1. Ringkasan stack

| Layer | Language | Framework/tool | Purpose |
| --- | --- | --- | --- |
| On-chain programs | Rust | Anchor | Citizen state, Training Credits, token burn, score upgrade |
| NFT mint | TypeScript + existing on-chain programs | Metaplex Core + Core Candy Machine + Candy Guards | Collection, mint, limits, payments, royalties |
| Solana client | TypeScript | `@solana/kit` + Wallet Standard | RPC, transactions, wallet connection |
| Metaplex client | TypeScript | Umi + `mpl-core` + `mpl-core-candy-machine` | Core assets and Candy Machine interaction |
| Web application | TypeScript | Next.js App Router + React | Public website, owner dashboard, chat, profiles |
| Pixel district | TypeScript | Phaser 3 | Sprite rendering, scene, animation, input, district events |
| UI styling | CSS/TypeScript | Tailwind CSS + CSS variables + Radix primitives | Responsive global English UI |
| Client state | TypeScript | Zustand + TanStack Query | UI state and server/on-chain query cache |
| Backend API | TypeScript | Next.js Route Handlers | Authentication, ownership checks, chat, mission claims |
| Background worker | TypeScript | Node.js + BullMQ | Webhooks, memory summaries, competition finalization |
| Database | SQL | PostgreSQL + Drizzle ORM | Sessions, memory, missions, seasons, leaderboards |
| Cache/rate limit | — | Redis | Nonces, quotas, idempotency, queues, locks |
| AI gateway | TypeScript | OpenRouter API + Zod | Character dialogue and strict JSON validation |
| Solana RPC/indexing | JSON-RPC | Helius RPC + DAS + Webhooks | Ownership reads, assets, transaction/event monitoring |
| Immutable assets | JSON/images | Arweave through an uploader such as Irys | NFT art and metadata |
| Unit/integration tests | Rust + TypeScript | LiteSVM/Surfpool, Vitest | Program and application tests |
| Browser tests | TypeScript | Playwright | Full mint, training, chat, and transfer flows |
| Monitoring | TypeScript | Sentry + OpenTelemetry-compatible logs | Errors, traces, alerting |
| CI/CD | YAML/shell | GitHub Actions | Build, test, deploy gates |
| Package manager | — | pnpm workspaces | Monorepo dependency management |

Python, Solidity, and a separate microservice framework are not required for the first production release.

## 2. Languages

### 2.1 Rust

Rust digunakan hanya untuk Solana programs:

```text
programs/district
programs/competition
```

`district` responsibilities:

- Config and admin state.
- Utility-token binding and lock.
- Citizen registration.
- Canonical CitizenState.
- Training Credit claims.
- Official-token burn.
- Score upgrade.
- Events and errors.

`competition` responsibilities, when real-value seasons are enabled:

- Season and competition accounts.
- Funded prize vault state.
- Finalized winner root/list.
- Prize claims.
- Duplicate-claim protection.

Use Anchor with:

```text
anchor-lang
anchor-spl
mpl-core
```

All arithmetic uses checked integer operations. No floating point.

### 2.2 TypeScript

TypeScript is the main off-chain language:

- Next.js web app.
- Backend route handlers.
- Worker.
- Metaplex scripts.
- Deployment scripts.
- Solana clients.
- OpenRouter integration.
- Mission engine.
- Competition scoring.
- Tests.

Required compiler settings:

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitOverride": true,
  "useUnknownInCatchVariables": true
}
```

Do not use untyped `any` at API, database, or blockchain boundaries.

### 2.3 SQL

PostgreSQL stores durable off-chain data:

- Wallet sessions.
- Login nonces and audit records.
- Private relationship summaries.
- Public-history index/cache.
- Mission definitions and completions.
- Mission claim status.
- Seasons and competitions.
- Entries and leaderboard scores.
- Prize allocation records.
- AI usage and cost records.

On-chain state remains canonical for ownership, scores, Training Credits, and paid claims.

### 2.4 JSON

JSON stores authored content and configuration:

```text
content/en/citizens.json
content/en/roles.json
content/en/dialog/*.json
content/en/missions/*.json
app/messages/en.json
config/devnet.json
config/mainnet.json
```

Validate every JSON file with Zod during build and CI.

## 3. Solana on-chain stack

### 3.1 Anchor

Use the latest stable Anchor release selected at project initialization, then pin it exactly for the release candidate.

Do not use floating version ranges for:

```text
anchor-lang
anchor-spl
Solana/Agave toolchain
mpl-core
```

The generated IDL is committed and used to generate a typed TypeScript client.

### 3.2 Metaplex Core

Use Metaplex Core for Citizen NFTs.

Required plugins/patterns:

- Collection-level Royalties plugin.
- AppData or CitizenState PDA as canonical mutable state.
- Optional Attributes plugin as public display mirror.
- Collection verification on every citizen operation.

### 3.3 Core Candy Machine

Use Core Candy Machine on both devnet and mainnet.

Required Candy Guards:

```text
solPayment
mintLimit
thirdPartySigner
startDate
botTax
```

Optional groups:

```text
allowlist
public
```

Do not implement a custom devnet mint path that is replaced for mainnet.

### 3.4 SPL token

The official Pump.fun token is the only mainnet utility token.

On devnet, create a mirror SPL token with matching decimals and authority behavior.

District program verifies:

- Exact configured mint.
- Expected token program.
- User token account ownership.
- Sufficient balance.
- 100% burn amount.

No second upgrade token.

## 4. Frontend stack

### 4.1 Next.js and React

Use Next.js App Router with React and TypeScript strict mode.

Routes:

```text
/                       district landing
/citizens               citizen registry
/citizens/[asset]       public citizen profile
/citizens/[asset]/chat  owner chat
/missions               mission board
/competitions           current and previous seasons
/leaderboard            season leaderboards
/treasury               prize-pool transparency
/settings               memory and session controls
```

Use server components for read-heavy public pages and client components only for wallet, Phaser, chat streaming, and transaction signing.

### 4.2 Wallet integration

Use `@solana/kit` and Wallet Standard discovery for new frontend code.

Target wallets:

- Phantom.
- Solflare.
- Backpack.
- Other Wallet Standard-compatible wallets.

Authentication uses Sign-In with Solana-style domain-bound messages, one-time nonce, expiry, and an HTTP-only session cookie.

### 4.3 Metaplex/Umi adapter

Metaplex Core Candy Machine uses Umi. Keep all Umi-specific conversion and transaction construction inside one package:

```text
packages/metaplex-client
```

Do not scatter Umi and Solana Kit conversions throughout React components.

Recommended package boundary:

```typescript
export interface MintCitizenResult {
  assetAddress: string;
  signature: string;
}

export interface CitizenChainState {
  assetAddress: string;
  owner: string;
  role: CitizenRole;
  insight: number;
  bond: number;
  craft: number;
}
```

### 4.4 UI styling

Use:

- Tailwind CSS for layout and responsive utilities.
- CSS variables for the Pixel District palette.
- Radix UI primitives for accessible dialogs, menus, tabs, and tooltips.
- Custom components for the visual identity.

Avoid generic dashboard component kits that make the project look like a normal SaaS application.

### 4.5 Pixel district renderer

Use Phaser 3 as an isolated client-only canvas component.

Phaser handles:

- Pixel-perfect rendering.
- Integer sprite scaling.
- Sprite sheets and animations.
- Click/tap interaction.
- Camera and scene transitions.
- District event markers.
- NPC placement.

React handles:

- Wallet controls.
- Dialogue UI.
- Scores.
- Mint and training modals.
- Mission and competition screens.

Art workflow:

```text
Aseprite → sprite sheet export → Phaser asset manifest
Tiled → district map JSON → Phaser tilemap
```

Do not place wallet or blockchain logic inside Phaser scenes.

### 4.6 Client state

Use Zustand for local UI state:

- Selected citizen.
- Open panel/modal.
- Dialogue display state.
- Phaser-to-React events.

Use TanStack Query for asynchronous state:

- Citizen ownership.
- Scores.
- Token balance.
- Mission status.
- Competition entries.
- Leaderboards.
- Prize-pool data.

Always invalidate and refetch on-chain state after a confirmed transaction.

## 5. Backend stack

### 5.1 Next.js Route Handlers

Use route handlers for request/response work:

```text
/api/auth/nonce
/api/auth/verify
/api/citizens/[asset]
/api/citizens/[asset]/chat
/api/missions/[mission]/submit
/api/missions/[mission]/claim
/api/competitions/[id]/enter
/api/competitions/[id]/submit
/api/leaderboard/[season]
/api/treasury
/api/webhooks/helius
```

Every write endpoint validates:

- Session.
- Wallet.
- Official collection.
- Current ownership when required.
- Idempotency key.
- Rate limit.
- Request schema.

### 5.2 Worker

Long-running and retryable tasks must not depend on serverless request lifetime.

Use Node.js worker + BullMQ for:

- Webhook processing.
- AI memory summarization.
- Public-history indexing.
- Mission result processing.
- Competition score calculation.
- Leaderboard finalization.
- Prize allocation preparation.
- Reconciliation against chain data.

Jobs must be idempotent.

### 5.3 PostgreSQL and Drizzle

Use PostgreSQL with Drizzle ORM and SQL migrations committed to the repository.

Core tables:

```text
wallet_sessions
login_nonces
citizen_index
private_relationship_memories
public_history_index
missions
mission_attempts
mission_claims
seasons
competitions
competition_entries
leaderboard_scores
prize_allocations
ai_usage
webhook_events
idempotency_keys
```

Use unique constraints for claim receipts and webhook transaction signatures.

### 5.4 Redis

Use Redis for:

- Login nonce expiry.
- Chat daily quota.
- IP/wallet/asset rate limits.
- Distributed locks.
- Short-lived ownership cache.
- BullMQ queues.
- Idempotency reservation.

PostgreSQL remains the durable record. Redis is not the only copy of critical prize or mission data.

## 6. AI stack

### 6.1 OpenRouter

Use OpenRouter only from the server.

```text
OPENROUTER_API_KEY
CHAT_MODEL_PRIMARY
CHAT_MODEL_FALLBACK
CHAT_MAX_OUTPUT_TOKENS
CHAT_REQUEST_TIMEOUT_MS
CHAT_DAILY_BUDGET_USD
CHAT_ENABLED
```

Model selection is configuration, not hardcoded source code.

### 6.2 Validation

Use Zod for strict structured output:

```typescript
const CitizenReplySchema = z.object({
  reply: z.string().min(1).max(400),
  emotion: z.enum(["neutral", "curious", "happy", "worried", "thinking"]),
  animation: z.enum(["idle", "blink", "look_left", "look_right", "happy", "worried", "thinking"]),
  memoryCandidate: z.string().max(240).nullable(),
  safety: z.enum(["ok", "blocked"]),
}).strict();
```

Tool calling remains disabled.

### 6.3 Memory

PostgreSQL stores:

```text
public_character_memory:{asset}
private_relationship_memory:{asset}:{owner}
```

Store summaries, not raw transcripts by default.

## 7. Solana RPC and indexing

Use a production RPC provider with:

- Standard RPC.
- DAS API.
- Webhooks.
- Enhanced transaction parsing.
- Priority-fee estimates.

Recommended primary provider: Helius.

Use a separate fallback RPC for transaction reads and submission resilience.

DAS/API use cases:

- Fetch assets by owner.
- Verify collection membership.
- Fetch Core Asset ownership.
- Display NFT metadata.
- Monitor transfers.

Webhook use cases:

- Citizen transfer.
- Score upgrade event.
- Training Credit claim.
- Competition prize claim.

Webhooks are hints, not the final source of truth. Worker re-reads canonical chain state before important updates.

## 8. Prize-pool stack

### 8.1 Initial release

Use:

- Separate `PrizePoolVault` wallet/account.
- Squads multisig for treasury control.
- PostgreSQL competition ledger.
- Server-authoritative scoring.
- Public treasury dashboard.
- Multisig-approved SOL/USDC payouts.

### 8.2 Automation phase

Add a separate Anchor `competition` program after the zero-value test season succeeds.

Recommended claim model:

```text
finalized winner list
→ Merkle root stored on-chain
→ winner submits proof
→ program verifies proof
→ winner claims once
```

Never make the LLM the only judge or payout authority.

## 9. Infrastructure

Recommended deployment:

| Component | Recommended hosting |
| --- | --- |
| Next.js web/API | Vercel or equivalent Node-compatible platform |
| Background worker | Railway, Fly.io, or equivalent long-running container |
| PostgreSQL | Supabase, Neon, or managed PostgreSQL |
| Redis | Upstash or managed Redis |
| RPC/DAS/Webhooks | Helius primary + fallback provider |
| Immutable NFT files | Arweave/Irys |
| Temporary public files | Cloudflare R2 |
| Monitoring | Sentry |
| Admin/treasury | Squads multisig |

Do not store private keys in GitHub, `.env.example`, frontend bundles, database rows, or logs.

Mission authority is a restricted automated signer with no treasury access. Store it in a production secret manager and support rotation.

## 10. Testing stack

### 10.1 Program tests

Use:

- Rust unit tests.
- Anchor integration tests.
- LiteSVM or Surfpool for fast deterministic testing.
- Devnet integration tests before release.

Required cases:

- Invalid collection.
- Wrong owner.
- Wrong utility mint.
- Replayed mission claim.
- Expired mission claim.
- Missing Training Credit.
- Insufficient token balance.
- Arithmetic overflow.
- Max score.
- Transfer then upgrade.
- Paused program.
- Locked utility mint.

### 10.2 Application tests

Use Vitest for:

- Schemas.
- Cost formulas.
- Content selection.
- Competition formulas.
- Payout splits.
- Memory separation.

Use Playwright for:

- Wallet connection.
- Mint flow.
- Training flow.
- Chat fallback.
- Mission claim.
- Competition entry.
- Citizen transfer UI refresh.

### 10.3 CI gates

GitHub Actions runs:

```text
cargo fmt --check
cargo clippy
anchor build
program tests
pnpm lint
pnpm typecheck
pnpm test
pnpm build
Playwright smoke tests
config parity validation
```

No mainnet deployment if any gate fails.

## 11. Monorepo structure

```text
apps/
  web/                       Next.js + React + Phaser
  worker/                    Node.js background worker

programs/
  district/                  Anchor citizen/training program
  competition/               Anchor prize claim program, later phase

packages/
  ai/                        OpenRouter adapter and Zod schemas
  chain-client/              Typed District program client
  metaplex-client/           Umi/Core/Candy Machine adapter
  db/                        Drizzle schema and migrations
  content/                   English content schemas/loaders
  config/                    Shared typed config
  mission-engine/            Mission validation and claims
  competition-engine/        Scoring and payout formulas
  ui/                        Shared React UI components

content/
  en/
    citizens.json
    roles.json
    dialog/
    missions/

config/
  devnet.json
  mainnet.json

docs/
  id/

tests/
  e2e/
  integration/
```

Use pnpm workspaces. Turborepo is optional; add it only when parallel builds become useful.

## 12. Recommended development order

### Stage 1 — Repository foundation

- pnpm workspace.
- Next.js app.
- Anchor workspace.
- Shared config schema.
- PostgreSQL and Redis local services.
- CI.

### Stage 2 — Core mint

- Core Collection.
- Core Candy Machine.
- Candy Guards.
- Mint + register transaction.
- Public citizen profile.

### Stage 3 — Training

- Devnet mirror token.
- Mission authority.
- Training Credit claim.
- Token burn.
- Score upgrade.
- Visible content unlock.

### Stage 4 — Character experience

- Phaser district scene.
- English dialogue JSON.
- Role interactions.
- One complete authored mission.

### Stage 5 — AI chat

- Wallet authentication.
- Ownership gate.
- OpenRouter structured output.
- Quota.
- Public/private memory split.
- JSON fallback.

### Stage 6 — Competition simulation

- Seasons and brackets.
- Entries and scoring.
- Leaderboard.
- Zero-value test season.
- 35-winner cap formula.

### Stage 7 — Prize operations

- PrizePoolVault.
- Treasury dashboard.
- Multisig payout flow.
- Payout simulation.
- Competition program if automation is approved.

### Stage 8 — Mainnet release candidate

- Pin all versions.
- Run config parity checks.
- Run full devnet acceptance suite.
- Deploy the exact reviewed commit to mainnet.
- Bind and lock the official Pump.fun token mint.
- Unpause in the documented order.

## 13. Minimum skills/team

A minimal team can overlap roles, but the required skills are:

1. **Solana/Rust engineer** — Anchor, CPI, accounts, token burn, Core validation.
2. **Full-stack TypeScript engineer** — Next.js, wallet flow, APIs, PostgreSQL, Redis.
3. **Game/frontend engineer** — Phaser, React integration, pixel-perfect responsive UI.
4. **Backend/AI engineer** — OpenRouter, worker, mission claims, memory, competition scoring.
5. **Pixel artist/content designer** — Aseprite, roles, dialogue, missions, animations.
6. **QA/security reviewer** — transaction edge cases, replay protection, payout testing.

For the first devnet prototype, one strong Rust engineer and one strong full-stack TypeScript engineer can build the technical core while the owner/art team supplies content.

## 14. Stack decisions that should not change between networks

The following are identical in devnet and mainnet:

```text
Rust + Anchor programs
Next.js + TypeScript frontend
Phaser scene
Core Candy Machine mint path
District instruction set
Training Credit model
100% official-token burn
OpenRouter adapter
PostgreSQL schema
Redis quota model
Competition formula
Test suite
```

Only network addresses, RPC URLs, treasury addresses, and official/mirror token mints differ.

## 15. Version policy

During initial development, evaluate current stable releases. Before release candidate:

1. Pin every direct dependency to an exact version.
2. Commit `pnpm-lock.yaml` and `Cargo.lock`.
3. Record Rust, Solana/Agave, Anchor, Node.js, pnpm, and SDK versions.
4. Do not run automatic major-version upgrades.
5. Upgrade only in a separate branch with the full test suite.

This is important because Solana, Anchor, Kit, and Metaplex SDK interfaces evolve quickly.
