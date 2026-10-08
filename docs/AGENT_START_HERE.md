# Pixel District — Agent Start Here

Status: Mandatory implementation handoff. This document is agent-facing and written in English. Internal owner-facing product documents remain in Indonesian.

## 1. Required reading order

Read these files before proposing architecture or writing code:

1. `docs/specs/PIXEL_DISTRICT_SPEC_V2_ID.md`
   - Primary source of truth for product behavior, architecture boundaries, economics, security constraints, language rules, network parity, release order, and acceptance tests.
2. `docs/id/TECH_STACK_ID.md`
   - Required implementation languages, frameworks, infrastructure, monorepo structure, tests, and staged build order.
3. `docs/id/PRIZE_POOL_MODEL.md`
   - Specialized source of truth for competitions, funded prize pools, bracket allocation, winner limits, payout rules, rollover, anti-cheat, and payout integrity.
4. `docs/DECISIONS.md`
   - Append-only implementation decision log for omissions or ambiguities. It cannot override a `[FINAL]` requirement.
5. `docs/id/OWNER_VALUE_FLOW_ID.html`
   - Explanatory owner-flow reference. It helps explain the intended product journey and economics, but it is not a UI design reference and does not override written requirements.

The owner controls the visual direction and will provide approved design assets separately.

## 2. Authority order

If two artifacts appear inconsistent, use this order:

1. Requirements marked `[FINAL]` in `docs/specs/PIXEL_DISTRICT_SPEC_V2_ID.md`.
2. Other explicit requirements in `docs/specs/PIXEL_DISTRICT_SPEC_V2_ID.md`.
3. Specialized competition rules in `docs/id/PRIZE_POOL_MODEL.md`.
4. Technology decisions in `docs/id/TECH_STACK_ID.md`.
5. Approved entries in `docs/DECISIONS.md`.
6. Owner value-flow HTML.
7. Owner-approved visual design assets, for presentation only.
8. Agent assumptions.

An agent assumption must never override an explicit requirement.

## 3. Non-negotiable implementation rules

- Use Rust and Anchor for security-critical Solana programs.
- Use strict TypeScript for the web app, server routes, worker, clients, scripts, and tests.
- Use Next.js/React for the application shell and Phaser 3 for the interactive pixel district.
- Use `@solana/kit` and Wallet Standard for new Solana frontend work.
- Isolate Metaplex Umi/Core/Candy Machine integration behind a dedicated adapter package.
- Use Metaplex Core Candy Machine on devnet and mainnet.
- Preserve equivalent product architecture and behavior across devnet and mainnet. Only unavoidable cluster configuration, addresses, endpoints, treasuries, and secrets may differ.
- Mainnet has exactly one official Pump.fun utility token. Devnet uses a behaviorally equivalent mirror token.
- Bind the official token mint permanently. Never create a second upgrade token.
- Training is atomic: verify ownership and state, consume one matching non-tradable Training Credit, burn 100% of the required official token amount, and increase the correct score in one transaction.
- Training Credits cannot be transferred or purchased.
- The AI layer must never hold wallet keys, sign transactions, trade tokens, or autonomously change canonical scores.
- Canonical ownership, progression, burns, credits, and prize claims must be verified by trusted server logic and/or Solana programs as specified. Never trust browser state.
- Missions must lead to meaningful progression, achievements, access, or competition objectives. Do not add purposeless engagement tasks.
- Prize pools may use only creator fees actually received and explicitly allocated to a funded season.
- NFT ownership alone never earns a prize. Rarity and level never automatically multiply cash payouts.
- Seasonal performance determines competition winners. Progression only unlocks eligibility for harder brackets.
- The maximum number of cash winners per season is 35: Open 10, Rookie 10, Skilled 7, Elite 5, Master 3. Apply the dynamic limits in the prize-pool model.
- Keep cash winners separate from non-cash title, badge, cosmetic, and recognition recipients.
- All source code, comments, identifiers, tests, events, errors, logs, database identifiers, API fields, technical schemas, commits, and public UI/content must be in English.
- Owner-facing internal product documentation is in Indonesian.
- Do not add a new feature when a requirement is missing. Choose the simplest non-feature-expanding option and record it in `docs/DECISIONS.md`.

## 4. Required delivery sequence

Follow the staged order in `docs/id/TECH_STACK_ID.md`. The network release sequence is mandatory:

1. Complete and test the product on devnet.
2. Deploy behaviorally equivalent mainnet infrastructure in a paused state.
3. Launch the one official token through Pump.fun.
4. Bind and permanently lock its mint in the mainnet configuration.
5. Verify the binding, treasury, multisig, vault, and program configuration.
6. Unpause utility.
7. Open the mainnet NFT mint only after the preceding checks pass.

Do not launch the NFT mint first and attempt to retrofit token utility later.

## 5. Required working method

Before coding, each implementation agent must:

1. State which milestone and files it owns.
2. List the specification sections that govern its work.
3. Identify any unresolved blocker without inventing a feature.
4. Propose the smallest implementation plan and test plan.
5. Confirm that devnet/mainnet behavior remains equivalent.

For every pull request or deliverable:

- Link the governing specification sections.
- Include or update automated tests.
- Include negative/adversarial tests for security-sensitive logic.
- Update `docs/DECISIONS.md` only for genuine omissions or ambiguities.
- Do not silently alter economics or product behavior.
- Do not claim completion unless relevant acceptance tests pass.

## 6. Responsibility packets

### Solana/Anchor agent

Mandatory:

- `docs/AGENT_START_HERE.md`
- `docs/specs/PIXEL_DISTRICT_SPEC_V2_ID.md`
- `docs/id/TECH_STACK_ID.md`
- `docs/DECISIONS.md`

Add `docs/id/PRIZE_POOL_MODEL.md` when working on competition programs, prize vaults, winner finalization, or claims.

### Web/Phaser agent

Mandatory:

- `docs/AGENT_START_HERE.md`
- `docs/specs/PIXEL_DISTRICT_SPEC_V2_ID.md`
- `docs/id/TECH_STACK_ID.md`
- `docs/id/OWNER_VALUE_FLOW_ID.html`
- `docs/DECISIONS.md`

Implement the application in Next.js/React/Phaser using only visual direction and design assets approved by the owner. Do not invent or finalize a visual identity without owner approval. Regardless of presentation, browser state must never be treated as canonical blockchain state.

### Backend/AI agent

Mandatory:

- `docs/AGENT_START_HERE.md`
- `docs/specs/PIXEL_DISTRICT_SPEC_V2_ID.md`
- `docs/id/TECH_STACK_ID.md`
- `docs/id/OWNER_VALUE_FLOW_ID.html`
- `docs/DECISIONS.md`

The AI response is untrusted presentation data. Validate structured output and never grant the model signing, trading, mission-authority, score-authority, or payout-authority capabilities.

### Competition/prize agent

Mandatory:

- `docs/AGENT_START_HERE.md`
- `docs/specs/PIXEL_DISTRICT_SPEC_V2_ID.md`
- `docs/id/PRIZE_POOL_MODEL.md`
- `docs/id/TECH_STACK_ID.md`
- `docs/id/OWNER_VALUE_FLOW_ID.html`
- `docs/DECISIONS.md`

### QA/security/DevOps agent

Mandatory:

- `docs/AGENT_START_HERE.md`
- `docs/specs/PIXEL_DISTRICT_SPEC_V2_ID.md`
- `docs/id/TECH_STACK_ID.md`
- `docs/id/PRIZE_POOL_MODEL.md`
- `docs/DECISIONS.md`

Validate network parity, authority boundaries, mint locking, transaction atomicity, replay protection, idempotency, funded-vault constraints, payout integrity, and release gates.

## 7. Forbidden shortcuts

Do not:

- Replace Core Candy Machine with an unrelated mint architecture.
- Use a different devnet product architecture and promise to rewrite it for mainnet.
- Create an additional progression or upgrade token.
- Credit a score before both token burn and Training Credit consumption succeed.
- Store canonical progression only in PostgreSQL, Redis, local storage, or React state.
- Trust a webhook without chain reconciliation for security-sensitive state.
- Let the LLM choose winners, approve mission completion by itself, or control payouts.
- Pay holders passively or distribute prizes automatically based on rarity or holdings.
- Treat browser-only wallet, mint, ownership, score, or mission simulations as production logic.
- Invent or approve a visual identity on behalf of the owner.
- Introduce a language, framework, database, token, microservice, or feature merely because an agent prefers it.

## 8. Initial completion gate

The first implementation milestone is complete only when the repository structure, configuration validation, CI, language policy, devnet/mainnet parity rules, program/app test scaffolding, and decision-log process exist and pass their checks. No economic or security-sensitive feature should be rushed before this foundation is reviewable.
