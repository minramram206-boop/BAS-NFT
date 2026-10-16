//! Seeds, price limits and layout versions shared by every instruction.
//!
//! `apps/web/src/lib/data/market.ts` repeats the price limits so the sell form
//! refuses what the program would refuse, and its tests read this file to
//! check that the two agree.

/// PDA seed of the single `MarketConfig` account.
pub const CONFIG_SEED: &[u8] = b"market-config";

/// PDA seed prefix of a `Listing`, followed by the Core asset address.
pub const LISTING_SEED: &[u8] = b"listing";

/// PDA seed prefix of an `Auction`, followed by the Core asset address.
pub const AUCTION_SEED: &[u8] = b"auction";

/// PDA seed prefix of an `Offer`, followed by the Core asset and the buyer.
pub const OFFER_SEED: &[u8] = b"offer";

/// PDA seed of the authority that sellers name as their asset's transfer
/// delegate, and that holds an asset while it is auctioned. It holds no data
/// and signs only Core instructions.
pub const AUTHORITY_SEED: &[u8] = b"market-authority";

pub const MARKET_CONFIG_VERSION: u8 = 1;
pub const LISTING_VERSION: u8 = 1;
pub const AUCTION_VERSION: u8 = 1;
pub const OFFER_VERSION: u8 = 1;

/// How long an auction may run, in hours. The seller picks one.
pub const AUCTION_DURATIONS_HOURS: [u8; 3] = [24, 48, 72];

/// How long an offer stays open, in days of 24 auction hours, so the devnet
/// clock shortens offers too (a day is 4 minutes there). The buyer picks one.
pub const OFFER_DAYS: [u8; 3] = [1, 3, 7];

// The auction clock. A build with `--features devnet-clock` runs it 360 times
// faster, so an auction on devnet can be followed to its end in minutes: an
// hour lasts 10 seconds (24 hours is 4 minutes) and the late-bid window is one
// minute. Only that build turns it on (`pnpm market:build-devnet`, or
// `cargo build-sbf` with `--features devnet-clock` in WSL), and
// `scripts/devnet/deploy.sh` refuses such a binary anywhere but devnet.

/// Seconds that one hour of an auction lasts.
#[cfg(not(feature = "devnet-clock"))]
pub const AUCTION_HOUR_SECONDS: i64 = 3_600;
#[cfg(feature = "devnet-clock")]
pub const AUCTION_HOUR_SECONDS: i64 = 10;

/// A bid this close to the end pushes the end to this long after the bid,
/// so a last-second bid always leaves time to answer it.
#[cfg(not(feature = "devnet-clock"))]
pub const AUCTION_EXTENSION_SECONDS: i64 = 600;
#[cfg(feature = "devnet-clock")]
pub const AUCTION_EXTENSION_SECONDS: i64 = 60;

/// Each bid must beat the current one by at least this share, rounded up.
pub const MIN_BID_INCREMENT_BPS: u64 = 500;

/// Lowest asking price, 0.01 SOL. Below this a sale is mostly network fees.
pub const MIN_PRICE_LAMPORTS: u64 = 10_000_000;

/// Highest asking price, 1,000 SOL. Far above anything a citizen is worth,
/// and low enough to catch a price typed with the decimal point in the wrong place.
pub const MAX_PRICE_LAMPORTS: u64 = 1_000_000_000_000;

pub const BPS_DENOMINATOR: u64 = 10_000;

/// Upper bound on the royalty the config may set. The collection itself pays 500.
pub const MAX_ROYALTY_BPS: u16 = 2_500;

/// Upper bound on the market fee the config may set. Devnet runs with 0.
pub const MAX_FEE_BPS: u16 = 1_000;
