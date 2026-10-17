# BAS market (Phase F)

Status: the F1 program is deployed on devnet at
`EVjdJiuyVfKUoQFirJDbCauvkHcVKZ38y9i2XAP1ypyP` (D-0085), and `/market` reads
and trades through it when the app runs with `NEXT_PUBLIC_BAS_DATA=chain`
(D-0086). `pnpm devnet:market-setup` set the devnet config up and opened the
market on 2026-10-15: config `Da5LKDu5FB77SUJ1YJPUoWQcAFYxZU9AJoFteaCG6nX5`,
500 bps royalty and no fee to `9DfhjiWco7mDjyiwwSZo9UtyAYqYhjxSw3GyfTmCGEuK`,
transfer delegate `86CzjeSfC3P7Wa8Dk3D1rKG11f9PLTWB1ThQtpBxAYhR`. The first
sale between two wallets went through from the web app the same day: Ivy
(#019) listed by `5WjX…Wo4y` at 0.10 SOL and bought by `CJkc…t2AK`. On chain
the seller received 0.095 SOL plus the 0.00110744 SOL listing rent, the
royalty recipient 0.005 SOL, the buyer paid 0.10 SOL plus fees, the listing
was closed, and Core handed the delegate back to the new owner. The `buy`
used 30,427 compute units, the listing 31,271. Mock mode is unchanged (D-0083).

Auctions (F3, D-0087) are on devnet since the upgrade of 2026-10-16: the
program data on chain matches the owner's build byte for byte (sha256
`225148b5…`). The first auction ran from the web app the same night: Ivy
(#019) put up by `CJkc…t2AK` from 0.10 SOL for 24 hours, a bid of 0.10 SOL
from `5WjX…Wo4y`, then 0.105 SOL from `CJLT…ZaY1`, and the first bid paid back
in full inside that second `place_bid`. The auction account held exactly the
highest bid plus its rent throughout. That auction ran on the real clock,
ended on 2026-10-17 at 02:58 WIB, and settled cleanly after the D-0092
upgrade: `CJLT…ZaY1` received Ivy (#019), unfrozen, and seller `CJkc…t2AK`
received 0.09975 SOL after the 0.00525 SOL royalty. Every bid of an auction is
listed beside the cards and in its dialog (D-0088).

Since 05:13 WIB the same day devnet runs the fast test clock, where an auction
hour lasts 10 seconds (D-0089): the program data matches the owner's
`devnet-clock` build byte for byte (sha256 `74a1b781…`) and holds the
clock's marker. Ivy's auction kept its own end. The first fast auction ran
right after: Baker Mabel (#013) put up by `5WjX…Wo4y` from 0.03 SOL for "24
hours", which lasted exactly 240 seconds (05:17:25 to 05:21:25). `CJLT…ZaY1`
bid 0.034 SOL, `CJkc…t2AK` 0.04 SOL (the 0.034 went back in the same
transaction), and `CJLT…ZaY1` 0.045 SOL at 05:20:42, inside the last minute,
which moved the end to 05:21:42, one minute after that bid, and paid the 0.04
back. `CJkc…t2AK` finished it at 05:24:07 with the old FINISH button although
it had been outbid: Baker Mabel went to `CJLT…ZaY1`, unfrozen, the seller got
0.04275 SOL plus the auction rent, the royalty 0.00225 SOL. An ended auction
is now finished by the side that gains from it (D-0090): the winner claims the
citizen or the seller collects the payment. The second fast auction of Baker
Mabel (`CJLT…ZaY1` selling, won by `CJkc…t2AK` at 0.03 SOL) was finished with
COLLECT PAYMENT at 06:58:35: the seller got 0.0285 SOL plus the rent, the
royalty 0.0015 SOL, and the winner the citizen, in that one transaction.
Finished auctions and sales are listed in the FINISHED tab (D-0091). Sales on
chain appear in each citizen's public history, and a seller is told when a
citizen sold. Since the upgrade of 2026-10-16 at about 09:00 WIB (slot
511552165, after the owner's SBF run of all 61 integration tests on the
`devnet-clock` build) the market holds an auctioned citizen itself (D-0092),
so a seller can stop an auction only before the first bid; Ivy's auction,
started before that, finished the old way after 02:58 WIB on 2026-10-17. The
decision records are D-0082 to D-0092 in `DECISIONS.md`.

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
| F3 | Auctions | SOL (the highest bid only), settled by anyone |

F1 shipped first and was exercised on devnet. F3 came next at the owner's
request (D-0087), then F2: its screens in mock mode (D-0097), then its
program (D-0098). Until an external audit, every phase stays on devnet.

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

## F3 design: auctions

The market's authority PDA holds the citizen from the start of the auction
until it is cancelled or finished (D-0092). Settings chosen by the owner
(D-0087): the seller picks 24, 48 or 72 hours, a bid in the last 10 minutes
moves the end to 10 minutes after it, and the seller may cancel only before
the first bid. D-0087 first kept the citizen frozen in the seller's wallet;
that left the seller a way to stop an auction with bids (see "Auctions
started before D-0092"), so the market now takes it.

### Accounts

- `Auction` (`["auction", asset]`, 142 bytes): asset, seller, start price,
  highest bid, highest bidder, start and end time, bid count, bump. It holds
  the highest bid in its own lamports and nothing else; there is no vault.
- One citizen is either listed or auctioned. `create_auction` needs the
  asset's listing address to be empty, and a citizen held by the market has
  no owner who could list it.

### Instructions

- `create_auction(start_price, duration_hours)`: seller signs. The asset must
  be in the collection, owned by the seller and unfrozen. The program moves
  it to the authority PDA with Core's `TransferV1`, signed by the seller, and
  checks that the PDA owns it afterwards. No plugin is needed, and Core hands
  any delegate the seller had set back to the new owner, the PDA. From here
  until the end only this program can move it. Refused while paused.
- `place_bid(amount)`: bidder signs. Refused while paused, after the end, for
  the seller, for the current highest bidder, below the minimum (the start
  price, then 5% over the highest bid rounded up, at least one lamport), or
  when the auction can no longer deliver. The bid moves into the auction
  account and the previous highest bid goes back to its bidder in the same
  instruction, so the auction never holds more than one bid.
  `ends_at = max(ends_at, now + 600)`.
- `cancel_auction`: seller signs, only with no bids, also while paused. The
  PDA transfers the asset back to the seller and the rent is returned.
- `settle_auction`: anyone signs, after the end. With bids, the PDA transfers
  the asset to the highest bidder and the bid is split as in `buy` (royalty,
  fee, seller); without bids it goes back to the seller. The account closes
  to the seller.

Once someone has bid, nothing stops the auction: the seller owns nothing they
could revoke, and `cancel_auction` refuses with `AuctionHasBids`.

### Auctions started before D-0092

Until the upgrade after 2026-10-16 the citizen stayed in the seller's wallet,
frozen, with the PDA as its TransferDelegate and FreezeDelegate. While
frozen, Core still lets the owner revoke the TransferDelegate, and the
auction then cannot deliver: `place_bid` refuses with `AuctionUndeliverable`
and `settle_auction` may run at once, paying the highest bid back in full.
Nobody lost SOL, but a seller could stop an auction with bids this way.

The program no longer creates such auctions, but finishes the ones still
open: `cancel_auction` thaws the citizen (the client revokes the market's
delegates in the same transaction), and `settle_auction` thaws it and
transfers it as the delegate, or pays the bid back when it cannot. Ivy's
auction on devnet, ending 2026-10-17 at 02:58 WIB, is one of these.
`Auction::can_deliver` accepts either kind, and the integration tests build
the older state directly to keep that path tested.

## F2 design: offers

A buyer names a price for any citizen, listed or not, except one at auction
(that one is bought by bidding). Settings chosen in D-0097, program in
D-0098:

- The SOL leaves the buyer's wallet when the offer is made and is held by the
  market until the owner accepts or the buyer takes it back, in full, at any
  time. One offer per buyer and citizen: a new one replaces the old one, and
  the old SOL comes back in the same step.
- An offer is open for 1, 3 or 7 days (on the devnet test clock a day is 24
  of its hours, so 4, 12 or 28 minutes). After that the owner can no longer
  accept it; the buyer takes the SOL back.
- The owner sees every offer on a citizen, the highest open one first, and
  accepts one: the citizen goes to that buyer and the owner is paid less the
  royalty, as in `buy`, in one step. A listing of that citizen goes with it.
  The other offers stay open for the new owner, and their buyers can still
  take them back.
- Same price limits as listings. Accepted offers are listed under FINISHED,
  in their own part, ACCEPTED OFFERS.

### Accounts

- `Offer` (`["offer", asset, buyer]`, 98 bytes): asset, buyer, amount, made
  at, expires at, bump. It holds the offered SOL in its own lamports on top
  of its rent, which the buyer pays on a first offer and gets back when the
  offer closes. The owner is not recorded: whoever holds the citizen when the
  offer is accepted is paid.

### Instructions

- `make_offer(amount, days)`: buyer signs. `init_if_needed`, so the first
  call opens the account and a later one replaces the amount and the end;
  the old amount goes back to the buyer in the same instruction. Refused
  while paused, outside the price limits, for a length other than 1, 3 or 7
  days, for a citizen outside the collection, held by the market
  (`AssetInAuction`), frozen, or the buyer's own. A day is 24 auction hours,
  so the devnet clock shortens offers too.
- `withdraw_offer`: buyer signs, open or expired, also while paused. The
  account closes to the buyer: the offer and the rent come back.
- `close_expired_offer`: anyone signs, from `expires_at` on. Pays everything
  back to the buyer, so SOL is never held by an offer nobody can accept.
- `accept_offer(amount)`: the owner signs, so Core's `TransferV1` runs with
  the owner as its authority and no delegate is needed. `amount` is the offer
  the owner saw; a different one is refused with `OfferChanged`, so a buyer
  cannot lower the offer between the owner's read and signature. Refused
  while paused, at or after `expires_at` (`OfferExpired`), for a frozen
  citizen or one the signer does not own (a citizen at auction belongs to the
  market). The offer is split as in `buy` (royalty, fee, owner) and the
  account closes to the buyer. The owner's listing of the citizen, passed as
  an optional account, closes in the same instruction with its rent to the
  owner; a listing of anyone else is refused there, and one left out turns
  stale (Core resets the delegate on the transfer) and anyone can close it.

### Offer events

`OfferMade` (with the replaced amount), `OfferWithdrawn` (and whether it had
expired) and `OfferAccepted` (with the split). The mission server records an
`OfferAccepted` as a sale of kind `offer` (`market_sales`, migration
`0004-market-offer-sales`), so it is in FINISHED, in the citizen's public
history and in the notices. Open offers are read from the `Offer` accounts
themselves.

### Auction events

`AuctionCreated`, `BidPlaced` (with the bidder paid back and the new end),
`AuctionCancelled` and `AuctionSettled` (winner, split, and whether the
citizen was delivered), next to F1's `Sold`. The mission server reads them.

## Tests

| Command | What runs |
|---|---|
| `pnpm market:test` | Unit tests: price limits, sale split, the Core reader on hand-built bytes, the `TransferV1` encoding |
| `pnpm market:test-core` | 72 instruction tests in `programs/market/integration` (15 of them auctions, 3 of those for auctions started before D-0092, and 11 offers), in `solana-program-test`, with the Metaplex Core program itself |
| `pnpm market:build`, then `pnpm market:test-sbf` | The same tests with the market's SBF binary (WSL) |
| `pnpm --filter @bas/chain-client test` | The TypeScript client against the Rust sources: discriminators, seeds, layouts, account order and flags of every instruction, error codes |
| `pnpm --filter @bas/metaplex-client test` | The Core plugin instructions (TransferDelegate and FreezeDelegate) byte for byte against Core's own client, and `market.e2e.test.ts`: list, change price, buy, relist, cancel, a stale listing, a frozen citizen, a delegate held elsewhere, and an auction from start to settlement (with the seller's cancel refused after a bid) and to cancel, and offers made, replaced, accepted (closing a listing), withdrawn and closed after expiry, all through `@bas/chain-client` against `target/deploy/market.so` and the dumped `mpl_core.so` in LiteSVM |
| `pnpm --filter @bas/mission-server test` | Reading sales and bids out of the market's transaction logs, and the public history line of a sale |
| `pnpm --filter @bas/web test` | The chain data source against an in-memory cluster that applies the market's rules, auctions and offers included, and the mock auctions and offers |

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
assets with several plugins. For auctions: the market holding the citizen
(the seller can no longer move, burn, list or revoke anything), a frozen
citizen or a stranger refused, held bids paid back when outbid, the 5% step,
the extension, settlement with exact balances, cancel only before a bid and
the citizen back with the seller, no way for the seller to stop it after a
bid, an auction without bids, the refund going only to the recorded bidder,
and a paused market that takes no bids but still cancels and settles. Three
more build an auction of the older kind and check that it still delivers,
cancels, and pays the bid back when its seller revoked the delegate. For
offers: the SOL held and the rent paid on top, exact balances on acceptance,
a replacement paying the old amount back, withdrawal also while paused,
expiry (no acceptance, anyone closes it, everything back to the buyer), the
price and length limits, no offer on a citizen at auction, frozen or the
buyer's own, an offer made before an auction waiting through it, only the
owner accepting and only at the amount shown, the owner's listing closed
with the sale, the other offers left for the new owner, and a listing of
someone else refused.

## Risks still open

- The run with the dumped `mpl_core.so` (2026-10-15, all 45 passed) proves
  the market against the Core binary deployed on devnet that day. If Metaplex
  upgrades Core, dump it again and rerun `pnpm market:test-core`. Core's own
  instructions in these tests used at most about 15,500 compute units.
- The SBF build reported no stack frame warnings. In the SBF test run a whole
  `buy`, including Core's transfer, used at most about 36,000 compute units,
  and `create_listing` about 24,000, both well under the 200,000 default.
  With the market holding the citizen (SBF run of 2026-10-16, 61 passed),
  `create_auction` with Core's transfer used at most about 41,700,
  `place_bid` about 16,400, `cancel_auction` about 33,100 and
  `settle_auction` about 48,300 (the older kind, with Core's thaw and
  transfer). Offers (SBF run of 2026-10-16, 72 passed): `make_offer` about
  24,600, `accept_offer` with Core's transfer about 30,900,
  `close_expired_offer` about 6,500 and `withdraw_offer` about 4,400.
- `emit!` events are decoded by `@bas/chain-client` and checked in the LiteSVM
  run (`Sold`); the mission server reads them from devnet logs. A busy program
  may need more than one page of `getSignaturesForAddress`, which the reader
  follows. With `DATABASE_URL` set the history is kept whole in Postgres
  (D-0093); without it the server keeps the newest 500 sales and bids in
  memory and reads them again on every start.
- `/market/activity` sends the whole history on every poll. That is small
  for 100 citizens, but a busy market will need paging there.
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
- Auctions: `getProgramAccounts` also reads every `Auction`. An auction is
  shown with its citizen, the bid to beat, the time left, whether the wallet
  leads, and whether it can still deliver. Starting one is one signature
  (close a stale listing if a previous owner left one, then
  `create_auction`); bidding, cancelling and finishing are one each. While
  the market holds a citizen it is not among the seller's own citizens, so
  it cannot be trained, chatted with or sent on missions; YOUR CITIZENS in
  the market still lists it with its auction, and its profile reads "Your
  auction · held by the market until it ends". Whose auction it is comes
  from the auction account (`sellerIsMe`), not from who owns the citizen.
- The mission server reads the market program's transactions
  (`getSignaturesForAddress`, then `getTransaction`) every 15 seconds when
  `marketProgramId` is set, keeps the sales and bids, and serves them at
  `GET /market/activity` without sign-in. With `DATABASE_URL` set they go to
  Postgres (D-0093, tables `market_sales`, `market_bids` and
  `market_cursor` of migration `0002-market`): each transaction's records and
  the cursor are written in one database transaction before they are
  served, nothing is dropped, and a restart serves the kept history at once
  and reads only the transactions after the cursor. The first start against
  an empty database reads the program's whole history once. Without the
  variable, or when Postgres does not answer at start, the history lives in
  the process as before (newest 500 of each). Each sale is also written to the
  citizen's public history ("Bought in the market for 0.10 SOL on day 5 of
  season 1, and moved to a new owner." or "Won at auction …"), naming no
  wallet. The web app shows the sales in every citizen's history, and tells
  the connected wallet once about a citizen it sold, an auction it won, or a
  bid of its that was beaten (remembered per wallet in this browser). Buying
  gives no credit, points or tokens.
- Bid history (D-0088): every auction carries its bids, newest first, from
  `/market/activity`, keeping only bids made after the auction's
  `started_at`. A bid on chain that the server has not read yet (it reads
  every 15 seconds) is put on top from the auction account's highest bidder,
  without a time. The AUCTIONS tab shows all bids beside the cards, each with
  the citizen, the bidder, the time, the amount and whether it leads or was
  outbid; a row opens its auction, and the dialog lists that auction's bids.
- Finishing an auction (D-0090): an auction stops taking bids by itself at
  `ends_at`; only handing the citizen over takes a transaction
  (`settle_auction`), which the program lets anyone send. The screens offer it
  to the side that gains from it (`auctionStage` in `lib/data/market.ts`): the
  winner sees YOU WON and CLAIM CITIZEN, the seller COLLECT PAYMENT, a seller
  nobody bid for TAKE BACK, and, for an auction started before D-0092 that its
  seller stopped, the highest bidder TAKE BID BACK and that seller END AUCTION. Anyone else sees "Waiting for the
  winner to claim" and no button; the program would still take a
  `settle_auction` from them, but the screens leave it to the two sides. Whichever side
  presses first completes it for both, in one transaction. When an auction the
  wallet won or sold ends, the wallet gets an AUCTION ENDED notice, with OPEN
  MARKET on any other screen; the leading bid of an ended auction reads WON.
- Finished (D-0091): the FINISHED tab holds what has ended, in two parts
  that never mix: AUCTION RESULTS (the default) and FIXED-PRICE SALES, each
  newest first and under the role filter. Each card is laid out like the
  market's receipts: the citizen and the time, then Winner (or Buyer), Seller,
  Bids and Final price (or Price); an auction result opens its bids under a
  button across the card. "You" stands for the wallet.
  A citizen that is on the market again is marked "At auction again" or "For
  sale again", so an old result is not taken for the one running now. An
  auction's bids are rebuilt from `/market/activity` by following each bid's
  `previousBidder` back from the winning bid to the first one, which beat
  nobody, so bids of an earlier auction of the same citizen never mix in. The
  list holds what the mission server keeps: everything with Postgres, the
  newest 500 sales without it.
- Offers (D-0097 for the screens, D-0098 on chain): an OFFERS tab
  next to AUCTIONS with two parts, RECEIVED (one card per citizen of the
  wallet with offers: how many, the best one and its buyer, REVIEW OFFERS)
  and MADE (each offer of the wallet with the best offer, the listed price
  and the time left, CHANGE OFFER). YOUR CITIZENS shows "3 offers · best
  0.30 SOL" under a citizen, which opens the review; offers that ran out
  are counted apart ("2 offers · best 0.30 SOL · 1 expired"). A profile has MAKE OFFER
  (or CHANGE OFFER with the wallet's offer and its time left) for a citizen of
  someone else, and REVIEW OFFERS for one of the wallet's. The review lists
  every offer, the best open one marked BEST, expired ones struck through;
  ACCEPT on one shows the offer, the royalty and what the owner receives
  before ACCEPT OFFER. The wallet is told of a new offer on its citizen and
  of its own offer accepted, like the other market notices. Mock previews:
  another player offers, the owner accepts. On chain the offers are the
  `Offer` accounts, read with `getProgramAccounts` next to the listings and
  auctions; a first offer shows its account deposit ("Deposit, comes
  back"), the cluster's rent for 98 bytes, read with
  `getMinimumBalanceForRentExemption` rather than assumed. A new or changed
  offer on the wallet's citizen is a notice (its id carries the time it was
  made); an accepted one is the buyer's notice and the seller's "sold".
  An offer needs no citizen of the wallet's own. A wallet without one sees
  the welcome steps in the city; a citizen it taps there gets a card above
  them with PROFILE and MAKE OFFER (MARKET for one at auction). A wallet with
  citizens that taps someone else's gets MAKE OFFER in place of MISSIONS.
  The owner's review offers CLEAR EXPIRED OFFERS once offers have run out:
  one transaction of `close_expired_offer` (up to eight), each buyer's SOL
  and deposit going back to that buyer, the owner paying only the fee.
- Digits: Pixelify Sans draws 5 almost as S and 2 almost as Z, so text in
  that font takes its digits from Silkscreen, scaled to 88%
  (`BAS Digits` in `globals.css`, `unicode-range` 0-9 only).
- Network fee: the buy, bid and offer dialogs on chain show "Network fee
  (about) 0.000005 SOL", Solana's base fee for one signature, and count it in
  "SOL after" and in the check that the wallet holds enough (D-0096). A
  wallet may add a priority fee, hence "about". Mock mode charges none.
- Notices seen in another browser (D-0096): when a notice is dismissed, the
  ids go to the mission server (`POST /market/seen`, with the wallet's
  sign-in token) as well as to this browser. On load the page reads them
  back (`GET /market/seen?wallet=…`, public: the ids only name sales and
  bids that are public on chain) and waits for that list before showing
  anything. Saving never opens the wallet: without a token held the ids stay
  in this browser and go to the server with the next dismissal or page load
  while signed in. The server keeps the newest 200 per wallet, in Postgres
  (`market_seen`, migration `0003-market-seen`) or in memory without it.

## Devnet setup

`pnpm devnet:market-setup` (or `node scripts/devnet/market-setup.mjs` in WSL)
runs after the deploy, with the deployer key in `.keys/devnet-deployer.json`:

1. checks that the market program is deployed and that the key is its
   upgrade authority, the only key that may initialize the config;
2. reads the collection's Royalties plugin and stops unless it is 500 basis
   points paid in full to `royaltyRecipient` in `config/devnet.json`;
3. stops unless that account holds at least the rent minimum;
4. sends the market authority PDA the rent minimum for an empty account
   (0.00089 SOL) when it holds less (D-0095). The PDA receives every
   auctioned citizen, and Solflare refuses to sign a transaction that sends
   a citizen to an address its network has never seen, calling it a
   mainnet transaction. The program never writes to the account;
5. sends `initialize_config` (500 bps royalty, no fee, both to
   `royaltyRecipient`), or checks an existing config field by field;
6. unpauses the market. `--pause` pauses it instead.

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
5. Devnet end-to-end with wallet A and wallet B. Done for a fixed-price sale
   (Ivy, 2026-10-15).
6. Auctions, sale history and seller notices. Written and tested (D-0087),
   upgraded on devnet and bid on from three wallets (2026-10-16).
7. Bid history in the market (D-0088), and the fast devnet auction clock
   (D-0089) so an auction can be finished on devnet within minutes. Deployed
   and tried with Baker Mabel on 2026-10-16.
8. Claim and collect instead of one FINISH button (D-0090). Collected on
   devnet on 2026-10-16.
9. FINISHED tab: auction results and fixed-price sales apart, with an
   auction's bids (D-0091).
10. The market holds an auctioned citizen, so an auction with bids cannot be
    stopped (D-0092). Deployed on devnet on 2026-10-16 (slot 511552165).
11. The market history in Postgres (D-0093). Running on the owner's machine
    since 2026-10-16.
12. The market authority funded on devnet, so Solflare signs an auction
    start (D-0095). The first auction of the new kind opened the same day:
    Baker Mabel from 0.03 SOL for 4 minutes.
13. Escrowed auctions tried end to end on devnet on 2026-10-16 (D-0092):
    Baker Mabel's 4-minute auction cancelled before a bid went straight
    back to `CJkc…t2AK`; the next one, 12 minutes from 0.02 SOL, took
    0.023 SOL from `CJLT…ZaY1` and 0.04 SOL from `9fd6…WBD8`, held the
    citizen at the market authority, refused the seller's cancel on chain
    (`AuctionHasBids`, simulated), and was claimed by `9fd6…WBD8` at
    09:48:30 WIB: the seller got 0.038 SOL plus the rent, the royalty
    0.002 SOL. After a restart of `pnpm dev:all` the FINISHED tab still
    listed all four sales, read from Postgres (D-0093).
14. The network fee in the buy and bid dialogs, and dismissed notices kept
    per wallet on the mission server (D-0096).
15. Offers (F2): screens and rules in mock mode (D-0097).
16. Offers on chain (D-0098): the program, its client, the indexer and the
    chain data source. Devnet upgraded on 2026-10-16 (slot 511630123, the
    program data extended by 65,496 bytes to 583,640). First offer on devnet:
    `CJkc…t2AK` offered 0.02 SOL for Baker Mabel at 14:27:06 WIB, open for
    one day of the test clock (4 minutes); the offer account held 0.02114808
    SOL, the offer plus its rent. `9fd6…WBD8` accepted at 14:29:39: the
    citizen went to `CJkc…t2AK`, the owner got 0.019 SOL, the royalty 0.001
    SOL, and the account closed.

## The auction clock

On the real clock an auction runs for 24, 48 or 72 hours, and a bid in the
last 10 minutes moves the end to 10 minutes after it. A build of the program
with the Cargo feature `devnet-clock` keeps every rule but runs the clock 360
times faster: an auction hour lasts 10 seconds, so the three lengths are 4, 8
and 12 minutes, and the late-bid window is one minute. Instructions and
accounts are the same in both builds; the seller still picks 24, 48 or 72.

- The values live in `programs/market/src/constants.rs` (`AUCTION_HOUR_SECONDS`,
  `AUCTION_EXTENSION_SECONDS`, one line per build) and in `AUCTION_CLOCKS` of
  `@bas/chain-client`, whose tests read `constants.rs` to keep the two equal.
- `config/devnet.json` says `"auctionClock": "devnet-fast"` while devnet runs
  the fast build. `@bas/config` refuses that field on mainnet, without a
  market, or with any other value. The web app takes the lengths, the late-bid
  window and a "Test clock" note from it; every time left still comes from the
  auction's `ends_at` on chain.
- The fast build writes "BAS devnet auction clock" to the log of every
  `create_auction`. `scripts/devnet/deploy.sh` looks for that text in the
  binary: it refuses a fast binary on any cluster whose genesis hash is not
  devnet's, and refuses a binary whose clock disagrees with the manifest.
- The integration tests take the clock from the program crate, so all 72 run
  on either build: `pnpm market:test-core` and `pnpm market:test-sbf` on the
  real one, the same with `--features devnet-clock` (or
  `pnpm market:test-sbf-devnet`) on the fast one.
- An auction keeps the `ends_at` it was given. One started on the real clock
  still ends on the real clock after an upgrade to the fast build.

## Upgrading the devnet program

`deploy.sh` grows the program account by itself (`solana program extend`) when
the new `.so` is larger. The loader takes at least 10,240 bytes per extension,
so the fast build (508,032 bytes, 128 more than the deployed one) grew the
account from 507,904 to 518,144 bytes on 2026-10-16, which keeps 0.052 SOL more
rent in it for good. The D-0092 build (514,784 bytes) fits in that account,
so it needs no extension.
The upgrade buffer needs about 2.58 SOL while the deploy runs and is refunded
afterwards; the deployer held 3.53 SOL after the upgrade of 2026-10-16. The
offers build (D-0098, 583,624 bytes with the devnet clock) needs 65,480 bytes
more: the extension keeps about 0.33 SOL more rent for good and the buffer
needs about 2.97 SOL during the deploy, at devnet's rate of 2026-10-16
(5,080 lamports a byte, down from 6,960). The deployer held 3.48 SOL that
day. In WSL:

1. `cargo build-sbf --manifest-path programs/market/Cargo.toml --features devnet-clock`
   (the fast devnet build; without `--features devnet-clock` for the real one,
   and then remove `auctionClock` from `config/devnet.json`).
2. `BAS_MARKET=sbf SBF_OUT_DIR="$PWD/target/deploy" CARGO_TARGET_DIR="$HOME/bas-market-test" cargo test --manifest-path programs/market/integration/Cargo.toml --features devnet-clock`
   (the same features as the build).
3. `PROGRAM=market bash scripts/devnet/deploy.sh`. It prints which clock the
   binary runs before it deploys.
4. Restart `pnpm dev:all`, so the web app and the mission server read the new
   manifest.

The config, the listings, the auctions and the market authority stay as they
are; an upgrade changes only the program's code.
