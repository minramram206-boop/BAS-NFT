# Season prize vault

Status: deployed on devnet on 2026-10-17 at 03:30 WIB (slot 511831825,
program data 379,152 bytes, fast devnet clock) at
`5A2vzRDhfPfzpZrtvmhx6HFLLD2xmdcHStDwzPcNuXUP`. The vault is
`7HuPcx5kGfCWXhzqnKR9QXFbSANHbfYgYC5cp2MpPj3n`; it was opened, took a 1 SOL
deposit the way fee sharing will pay, and set 0.5 SOL aside for test season 2
(03:20 to 04:20 WIB, days of 10 minutes). `finalize` before the end was
refused, then succeeded at 04:22 WIB (0 winners, claims open 04:30:01 WIB after
the 8-minute devnet dispute window); `rollover` after 04:30 WIB returned the
0.5 SOL to the unallocated pool, and `fund_season` set 0.5 SOL aside for
running season 1 (ends 2026-11-11 00:00 WIB). Mainnet gets a new keypair, a
multisig authority and an audit first.

The vault is the program `programs/prize_vault`, decided in D-0019: the prize
share of Pump.fun's creator fees (5000 bps under fee sharing) is paid straight
to a PDA this program owns, and nothing but a winner's own claim can take SOL
out of it. There is no `withdraw`.

## Accounts

| Account | Address | Holds |
| --- | --- | --- |
| `PrizeConfig` | `["prize-config"]` | authority, pending authority, `reserved_lamports` (funding seasons still owe), `paid_lamports` (all prizes ever paid) |
| `PrizeVault` | `["prize-vault"]` | the SOL. Ten bytes of data; its balance above rent is the pool |
| `Season` | `["season", id u32 LE]` | funding, end, winners root, number of winners, sum of prizes, when claims open, claimed lamports, a bitmap of who claimed, whether the leftover was released |

Unallocated SOL is `vault balance − vault rent − reserved_lamports`; only
that can be set aside for a season.

## Instructions

| Instruction | Who | What |
| --- | --- | --- |
| `initialize` | the upgrade authority | opens the config and the vault, so the vault address exists before it goes into Pump.fun's `sharing_config` |
| `fund_season(id, amount, ends_at)` | authority | sets `amount` of unallocated SOL aside. The first call opens the season with its end; later calls add while it runs. Nothing lowers a season's funding |
| `finalize_winners(id, root, winners, prizes)` | authority, after `ends_at` | publishes the winners root. Claims open after the 48 hour dispute window; until then the authority may publish a corrected list, which starts the window again. A season where no pool reached five entries is published with no winners |
| `claim(id, index, amount, proof)` | the winner, signing | pays row `index` of the list to its winner once, any time after the dispute window. There is no deadline: a prize waits for its winner for as many years as it takes (D-0102) |
| `rollover(id)` | anyone | once claims are open: the part of the season's funding that no published winner holds (pools with fewer than five entries, rounding) goes back to the pool. The prizes stay reserved for their winners; the SOL never leaves the vault |
| `propose_authority`, `accept_authority` | authority, then the new one | moves the authority, to the Squads multisig before launch |

A claim is refused when the proof does not match, the row was claimed, the
index is past the list, a single prize is above 30% of the season's funding
(the open pool paid to one winner), or the claims would pass the published
total. At most 35 winners, and a proof of at most 8 hashes.

Errors, from 6000: `Unauthorized`, `InvalidAmount`, `NotEnoughUnallocated`,
`InvalidSeasonEnd`, `SeasonEndChanged`, `SeasonEnded`, `SeasonNotEnded`,
`ClaimsAlreadyOpen`, `InvalidWinnerCount`, `PrizesOverFunding`,
`NotFinalized`, `ClaimsNotOpen`, `InvalidIndex`,
`InvalidProof`, `AlreadyClaimed`, `PrizeTooLarge`, `ClaimsOverPrizes`,
`RolloverNotReady`, `AlreadyRolledOver`, `NoPendingAuthority`,
`ProofTooLong`, `MathOverflow`.

## The clock

`--features devnet-clock` runs the dispute window 360 times faster, as the market's
auction clock does: the dispute window lasts 8 minutes. That build writes `BAS devnet prize clock` to the log of
`finalize_winners`; `scripts/devnet/deploy.sh` refuses it anywhere but
devnet, and refuses either build when `config/devnet.json` says otherwise
(`"prizeClock": "devnet-fast"`).

The season itself runs on the mission server's clock. On devnet
`SEASON_DAY_SECONDS` shortens a season day (for example 600 seconds), so a
whole season can be played, published and claimed in one sitting.

## Winners

`seasonPrizeRows` in `@bas/chain-client` turns the standings into prizes with
the rules of PRIZE_POOL_MODEL §7: every citizen with points competes in the
open pool and in its bracket (from its highest stat), each pool pays one rank
per five valid entries up to its cap (10 / 10 / 7 / 5 / 3), split 100%, 65/35,
50/30/20, or 40/25/15 and the rest shared. A pool with fewer than five entries
pays nothing. Rows are numbered pool by pool (open, rookie, skilled, elite,
master). The citizen's owner when the list is drawn up is paid; for a citizen
held by the market in an auction, its seller.

The tree: a leaf is `sha256(0x00 ‖ season u32 LE ‖ index u8 ‖ winner ‖ amount u64 LE)`,
a node `sha256(0x01 ‖ lower ‖ higher)` with the pair sorted, and an odd hash
at the end of a level moves up unchanged. The Rust tests, the TypeScript
tests and an independent Python check agree on the same vector.

The Season screen uses the same rules for the prize column of the board, so
it shows what the vault will pay.

## Flow on devnet

In WSL, from the repository root:

```bash
cargo build-sbf --manifest-path programs/prize_vault/Cargo.toml --features devnet-clock
PROGRAM=prize_vault bash scripts/devnet/deploy.sh
```

In PowerShell, with the mission server's season in `.env`:

```powershell
pnpm devnet:prize setup --deposit 1 --fund 0.5   # open the vault, send 1 SOL in as fee sharing would, set 0.5 aside
pnpm devnet:prize                                # status
# ... play the season; after it ends:
pnpm devnet:prize finalize --dry-run             # the winners, without sending anything
pnpm devnet:prize finalize                       # publish the root, write the list for the mission server
# 8 minutes later the winners claim on /season
pnpm devnet:prize rollover                       # after the 8 minutes: the leftover no winner holds
```

`finalize` reads the standings from the mission server, who holds each
citizen and its stats from the cluster, publishes the root, and writes
`apps/mission-server/data/prizes/season-<id>.json` (`PRIZES_DIR`), which the
server serves at `GET /season/prizes`. The web app rebuilds the tree from that
list and offers a claim only when its root is the one in the vault, so a
wrong or stale list can hide a prize but never pay the wrong wallet. One claim
transaction carries up to three prizes.

## Web

`/season` reads the vault and the season account (`reads.prize`), shows the
vault balance, what the season holds, what is free for the next seasons and
what was paid, the stage with a countdown (running, counting, winners posted,
claims open with no deadline, every prize paid), and a "Your prizes" card with CLAIM while claims are
open. The explorer link opens the vault on Solana Explorer.

## Tests

| Command | Covers |
| --- | --- |
| `pnpm prize:test` | 4 unit tests (the tree for 1 to 35 leaves, the shared vector) and 19 instruction tests in solana-program-test: opening, funding only from unallocated SOL, top-ups, the season end, publishing and correcting a list, every claim refusal, the 30% cap, the published total, the dispute window, a claim ten years later, a rollover that releases only the leftover and keeps the prizes, a season with no winners, and the authority handover |
| `pnpm prize:test` with `--features devnet-clock` | the same on the fast clock |
| `pnpm prize:test-sbf-devnet` | the same against the built `prize_vault.so` |
| `pnpm --filter @bas/chain-client test` | layouts, seeds, errors, discriminators and account orders read from the Rust sources; the tree and the payout rules |
| `pnpm --filter @bas/mission-server test` | the published list (refused when its rows do not hash to its root), `/season/prizes`, the short devnet day |
| `pnpm --filter @bas/web test` | reading the vault, claiming one and several prizes in one signature, refusals before the window and after a claim, and a list that does not match the root |

## Before mainnet

- A new program keypair; mainnet never takes a devnet key (D-0094).
- `propose_authority` to the Squads multisig, `accept_authority` from it.
- The upgrade authority to the multisig with a timelock, revoked after the audit.
- A mainnet fork test: `distribute_creator_fees_v2` paying into the vault PDA.
- The winners list published somewhere public with its scoring evidence (PRIZE_POOL_MODEL §13).
- Not checked yet: one citizen per wallet per competition, the Master
  achievements, a minimum prize, and manual review of the top winners.
