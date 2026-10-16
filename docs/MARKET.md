# BAS market (Phase F)

Status: the F1 program is deployed on devnet at
`EVjdJiuyVfKUoQFirJDbCauvkHcVKZ38y9i2XAP1ypyP` (D-0085), and `/market` reads
and trades through it when the app runs with `NEXT_PUBLIC_BAS_DATA=chain`
(D-0086). The config is set up by `pnpm devnet:market-setup`; until that has
run, the page says the market is not open. Mock mode is unchanged (D-0083).
The decision records are D-0082 to D-0086 in `DECISIONS.md`.

## Goal

Owners can sell a citizen for SOL without moving anything by hand. A wallet
such as Solflare offers no Send for an unverified collection, so today the only
way to move a citizen is the devnet transfer script. D-0055 also expects
players who want more than one citizen to buy them on a secondary market.

The market trades this collection only. It is not a generic agent market
(SPEC 2.3), pays no points or tokens for trading, and promises no yield.

## Phases

| Phase | Scope | Holds funds or assets |
|---|---|---|
| F1 | Fixed-price listings: list, update price, cancel, buy | No |
| F2 | Offers: a buyer names a price, the owner accepts | SOL, until accepted or withdrawn |
| F3 | Auctions | SOL (bids), plus settlement by the worker |

F1 ships first. F2 and F3 hold other people's SOL, so they wait until F1 has
been exercised on devnet. Until an external audit, every phase stays on devnet.

## F1 design

A new Anchor program, `programs/market`, next to `district`, with program id
`EVjdJiuyVfKUoQFirJDbCauvkHcVKZ38y9i2XAP1ypyP` (keypair in
`programs/market/keypair.json`, gitignored). It has its own Core reader
(`core_asset.rs`) rather than the `district` one, because it also reads the
plugin registry to find the TransferDelegate's authority.

### Listing without custody

The asset never leaves the seller's wallet. To list, the seller adds the Core
`TransferDelegate` plugin to the asset with the market program's authority PDA
(`["market-authority"]`) as delegate, and creates a `Listing` account. Both
happen in one wallet-signed transaction. To buy, the program transfers the
asset as that delegate. If the seller moves the asset elsewhere first, Core
resets the delegate and the purchase fails, atomically, with nothing paid.

While listed the seller is still the owner, so chat, training and missions
keep working.

### Accounts

- `MarketConfig` (`["market-config"]`): admin, pending admin, collection,
  royalty bps (at most 2,500), royalty recipient, fee bps (at most 1,000),
  fee recipient, paused, and the bumps of the config and of the authority
  PDA. Royalty values must equal the collection's Royalties plugin (500 bps);
  the program does not read collection plugins, so the setup script has to
  check that they match.
- `Listing` (`["listing", asset]`): seller, asset, price in lamports, listing
  time, bump. One listing per asset.
- The authority PDA `["market-authority"]` holds no data. It signs only the
  Core transfer in `buy`.

### Instructions

- `initialize_config`, `set_paused`, `update_config`, `propose_admin` and
  `accept_admin`, following the pattern of `district`. Only the upgrade
  authority may initialize, the collection account must be a Core collection,
  and the market starts paused. Both recipients must already hold the rent
  minimum: 5% of the 0.01 SOL minimum price is 0.0005 SOL, less than an empty
  account's rent, so a payment to an empty recipient would fail the sale.
- `create_listing(price)`: seller signs. The asset must belong to the
  collection, be owned by the seller, and name the authority PDA as its
  TransferDelegate. The client sends Core's `AddPluginV1` (or
  `ApprovePluginAuthorityV1` when the plugin exists) earlier in the same
  transaction. Price from 0.01 to 1,000 SOL. Refused while paused.
- `update_price(price)`: seller signs; the asset must still be theirs with the
  delegate in place; the price must change. Refused while paused.
- `cancel_listing`: seller signs, also while paused. The client bundles Core's
  `RevokePluginAuthorityV1` in the same transaction. The rent goes back to
  the seller.
- `close_stale_listing`: anyone may call it once the asset is burned, owned by
  someone else, or no longer delegated to the market. The rent goes to the
  seller. A new owner sends it in front of their own `create_listing`.
- `buy(max_price)`: buyer signs. The program checks that it is not paused, that
  the asset is in the collection, that its owner equals `listing.seller` and
  the delegate is still the market, that the buyer is not the seller, and that
  `listing.price <= max_price` (so a seller cannot raise the price after the
  buyer signed). Then, in one instruction: SOL to the seller, royalty to the
  royalty recipient, fee to the fee recipient (skipped when zero), a Core
  `TransferV1` CPI signed by the authority PDA, a check that the buyer now owns
  the asset, and the listing closed to the seller. Royalty and fee are each
  rounded down and the seller keeps the remainder.

### Why the royalty is enforced here only

The collection's Royalties plugin uses `ruleSet: None`, so other marketplaces
choose whether to honour it. This program always pays it. Whether to restrict
transfers on-chain with a rule set is a separate decision, because it can also
affect plain wallet transfers.

## Tests

| Command | What runs |
|---|---|
| `pnpm market:test` | Unit tests: price limits, sale split, the Core reader on hand-built bytes, the `TransferV1` encoding |
| `pnpm market:test-core` | 45 instruction tests in `programs/market/integration`, in `solana-program-test`, with the Metaplex Core program itself |
| `pnpm market:build`, then `pnpm market:test-sbf` | The same tests with the market's SBF binary (WSL) |
| `pnpm --filter @bas/chain-client test` | The TypeScript client against the Rust sources: discriminators, seeds, layouts, account order and flags of every instruction, error codes |
| `pnpm --filter @bas/metaplex-client test` | The Core plugin instructions byte for byte against Core's own client, and `market.e2e.test.ts`: list, change price, buy, relist, cancel, a stale listing and a frozen citizen, all through `@bas/chain-client` against `target/deploy/market.so` and the dumped `mpl_core.so` in LiteSVM |
| `pnpm --filter @bas/web test` | The chain data source against an in-memory cluster that applies the market's rules |

LiteSVM has no Windows build, so `market.e2e.test.ts` runs on Linux or macOS
(WSL with its own `pnpm install`) and is skipped elsewhere, as it is when
either `.so` file is missing.

`programs/market/integration` is a separate Cargo workspace with its own
lockfile, so Core's dependencies never change the versions the SBF build
resolves. Core runs in one of two ways:

- From `programs/market/integration/tests/fixtures/mpl_core.so`, when that
  file exists. This is the deployed program. Dump it in WSL with
  `solana program dump -u devnet CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d programs/market/integration/tests/fixtures/mpl_core.so`.
  The file is gitignored.
- Otherwise natively from the source of Core release 0.9.8, the last one on
  Solana 1.x. `BAS_CORE=so` or `BAS_CORE=native` forces one of the two.

The tests check, among others: the delegate and listing in one transaction;
exact balances after a sale (0.65 SOL gives 0.0325 to the royalty and 0.6175
plus the listing rent to the seller); Core resetting the delegate to the owner
on every transfer; a sale refused, with nothing moved, after the seller moved
the citizen, sent it away and back, revoked the delegate, froze it, or raised
the price; substituted accounts; a second buyer of the same listing; reselling
with the royalty paid again; and the reader agreeing with Core's own client on
assets with several plugins.

## Risks still open

- The run with the dumped `mpl_core.so` (2026-10-15, all 45 passed) proves
  the market against the Core binary deployed on devnet that day. If Metaplex
  upgrades Core, dump it again and rerun `pnpm market:test-core`. Core's own
  instructions in these tests used at most about 15,500 compute units.
- The SBF build reported no stack frame warnings. In the SBF test run a whole
  `buy`, including Core's transfer, used at most about 36,000 compute units,
  and `create_listing` about 24,000, both well under the 200,000 default.
- `emit!` events are not visible in `solana-program-test` or read by the web
  app; they are untested until a validator run.
- Royalty and fee recipients are checked for the rent minimum only when the
  config is written. If one is emptied later, small sales fail until it is
  funded again.

## Web and worker

- `/market` reads the config and every `Listing` with `getProgramAccounts`
  (the supply is 100, so no indexer is needed). The citizen read that already
  fetches every asset of the collection also reads each asset's
  TransferDelegate and FreezeDelegate plugins, so no extra request is made. A
  listing is shown only while the asset's owner is still the seller, the
  market is still its delegate, and it is not frozen.
- Each action is one wallet signature and one transaction, built by
  `@bas/chain-client`:
  - list: `close_stale_listing` when a previous owner left a listing on the
    asset, `AddPluginV1` or `ApprovePluginAuthorityV1` when the market is not
    the delegate yet, then `create_listing`;
  - change price: `update_price`; the same price sends nothing;
  - cancel: `cancel_listing`, then `RevokePluginAuthorityV1` while the market
    holds the delegate; this works while the market is paused;
  - buy: `buy` with the price on screen as `max_price`. A price raised in the
    meantime is refused by the program and shown as `price-changed`.
- Program errors are read from the preflight logs and shown as the matching
  screen error (`listing-gone`, `market-closed`, `invalid-price`,
  `own-listing`, `price-changed`); anything else is `transaction-failed`.
- Not built yet: a `sale` line in the public history for chain sales, and a
  notice for the seller when a citizen sells. Buying gives no credit, points
  or tokens.

## Devnet setup

`pnpm devnet:market-setup` (or `node scripts/devnet/market-setup.mjs` in WSL)
runs after the deploy, with the deployer key in `.keys/devnet-deployer.json`:

1. checks that the market program is deployed and that the key is its
   upgrade authority, the only key that may initialize the config;
2. reads the collection's Royalties plugin and stops unless it is 500 basis
   points paid in full to `royaltyRecipient` in `config/devnet.json`;
3. stops unless that account holds at least the rent minimum;
4. sends `initialize_config` (500 bps royalty, no fee, both to
   `royaltyRecipient`), or checks an existing config field by field;
5. unpauses the market. `--pause` pauses it instead.

It skips what is already done, so running it again is safe. Its instructions
come from `@bas/chain-client`, so `pnpm install` (or `pnpm build:packages`)
must have run first.

## Order of work

1. Screens on mock data: `/market`, the buy and sell dialogs, and the sell and
   buy actions on the citizen profile. Done (D-0083). On a cluster the page says
   the market is not open, and every action is refused with `market-closed`.
2. Program crate and pure-logic unit tests. Done (D-0084).
3. Integration tests with Core. Done, against the Core source and against the
   `mpl_core.so` dumped from devnet, also with the market's own SBF binary
   (D-0084, D-0085). Deployed to devnet (D-0085).
4. Client, setup script and chain data source. Done (D-0086). To redeploy,
   in WSL (where `pnpm` is not installed):
   `cargo build-sbf --manifest-path programs/market/Cargo.toml`, then
   `PROGRAM=market bash scripts/devnet/deploy.sh`.
5. Devnet end-to-end with wallet A and wallet B.
