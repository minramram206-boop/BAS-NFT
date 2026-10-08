# BAS Pixel District — documentation index

| Document | Language | Purpose |
| --- | --- | --- |
| [`AGENT_START_HERE.md`](./AGENT_START_HERE.md) | English | Mandatory agent handoff: reading order, authority order, non-negotiable rules, responsibility packets |
| [`specs/PIXEL_DISTRICT_SPEC_V2_ID.md`](./specs/PIXEL_DISTRICT_SPEC_V2_ID.md) | Indonesian | Primary source of truth for product behaviour, economics, security and release order |
| [`id/TECH_STACK_ID.md`](./id/TECH_STACK_ID.md) | Indonesian | Required languages, frameworks, infrastructure, monorepo structure and staged build order |
| [`id/PRIZE_POOL_MODEL.md`](./id/PRIZE_POOL_MODEL.md) | Indonesian | Competitions, funded prize pools, brackets, winner caps, payout integrity |
| [`id/OWNER_VALUE_FLOW_ID.html`](./id/OWNER_VALUE_FLOW_ID.html) | Indonesian | Explanatory owner value-flow reference |
| [`DECISIONS.md`](./DECISIONS.md) | Indonesian | Append-only implementation decision log |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | English | How this repository is organised and why |

## Authority order

When two artifacts disagree, the order defined in
[`AGENT_START_HERE.md`](./AGENT_START_HERE.md#2-authority-order) wins:

1. `[FINAL]` requirements in the product spec
2. other explicit requirements in the product spec
3. `id/PRIZE_POOL_MODEL.md`
4. `id/TECH_STACK_ID.md`
5. approved entries in `DECISIONS.md`
6. the owner value-flow HTML
7. owner-approved visual assets, for presentation only
8. agent assumptions — never allowed to override an explicit requirement

## Repository data sources

| Path | Owner | Read by |
| --- | --- | --- |
| `config/devnet.json`, `config/mainnet.json` | Engineering | `@bas/config` at runtime, validated on load |
| `content/en/citizens.json` | Content | `@bas/content/server` at request time, validated on load |
| `apps/web/public/**` | Owner-approved art | the web app at runtime |

No value from those files is re-typed in TypeScript. `packages/config` and
`packages/content` read them and validate them instead, and
`packages/*/test/*.test.ts` fails when they drift or when a referenced sprite
is missing.
