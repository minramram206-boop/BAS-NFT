//! Price limits and how a sale price divides. Kept free of account types so
//! the rules are tested without a bank.

use crate::constants::{
    AUCTION_DURATIONS_HOURS, AUCTION_EXTENSION_SECONDS, AUCTION_HOUR_SECONDS, BPS_DENOMINATOR,
    MAX_PRICE_LAMPORTS, MIN_BID_INCREMENT_BPS, MIN_PRICE_LAMPORTS,
};

/// Where the lamports of one sale go. The three parts always add up to the price.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SaleSplit {
    pub royalty_lamports: u64,
    pub fee_lamports: u64,
    pub seller_lamports: u64,
}

pub fn price_in_range(price_lamports: u64) -> bool {
    (MIN_PRICE_LAMPORTS..=MAX_PRICE_LAMPORTS).contains(&price_lamports)
}

/// `price * bps / 10_000`, rounded down. `None` only when `bps` exceeds 100%.
pub fn share_of(price_lamports: u64, bps: u16) -> Option<u64> {
    let bps = u64::from(bps);
    if bps > BPS_DENOMINATOR {
        return None;
    }
    let share = u128::from(price_lamports) * u128::from(bps) / u128::from(BPS_DENOMINATOR);
    u64::try_from(share).ok()
}

/// Royalty and fee are each rounded down and the seller keeps the remainder,
/// so no lamport is lost or invented. `None` when the two rates together
/// exceed the price, which `MarketConfig` validation rules out.
pub fn split_sale(price_lamports: u64, royalty_bps: u16, fee_bps: u16) -> Option<SaleSplit> {
    let royalty_lamports = share_of(price_lamports, royalty_bps)?;
    let fee_lamports = share_of(price_lamports, fee_bps)?;
    let seller_lamports = price_lamports
        .checked_sub(royalty_lamports)?
        .checked_sub(fee_lamports)?;
    Some(SaleSplit {
        royalty_lamports,
        fee_lamports,
        seller_lamports,
    })
}

/// The lowest bid an auction takes next: the start price while there is no
/// bid, then the current bid plus `MIN_BID_INCREMENT_BPS`, rounded up so the
/// step is never zero. `None` on overflow.
pub fn min_next_bid(start_price: u64, highest_bid: u64, has_bids: bool) -> Option<u64> {
    if !has_bids {
        return Some(start_price);
    }
    let step = (u128::from(highest_bid) * u128::from(MIN_BID_INCREMENT_BPS))
        .div_ceil(u128::from(BPS_DENOMINATOR));
    highest_bid.checked_add(u64::try_from(step).ok()?.max(1))
}

/// When an auction ends after a bid at `now`: unchanged, unless the bid came
/// in the last `AUCTION_EXTENSION_SECONDS`, in which case that long after it.
pub fn end_after_bid(ends_at: i64, now: i64) -> i64 {
    ends_at.max(now.saturating_add(AUCTION_EXTENSION_SECONDS))
}

/// Seconds of an auction lasting `hours`, if that is one of the allowed lengths.
pub fn auction_seconds(hours: u8) -> Option<i64> {
    AUCTION_DURATIONS_HOURS
        .contains(&hours)
        .then(|| i64::from(hours) * AUCTION_HOUR_SECONDS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{MAX_FEE_BPS, MAX_ROYALTY_BPS};

    const SOL: u64 = 1_000_000_000;

    #[test]
    fn price_limits_are_inclusive() {
        assert!(!price_in_range(0));
        assert!(!price_in_range(MIN_PRICE_LAMPORTS - 1));
        assert!(price_in_range(MIN_PRICE_LAMPORTS));
        assert!(price_in_range(SOL));
        assert!(price_in_range(MAX_PRICE_LAMPORTS));
        assert!(!price_in_range(MAX_PRICE_LAMPORTS + 1));
        assert!(!price_in_range(u64::MAX));
        assert_eq!(MIN_PRICE_LAMPORTS, 10_000_000);
        assert_eq!(MAX_PRICE_LAMPORTS, 1_000 * SOL);
    }

    #[test]
    fn five_percent_royalty_matches_the_web_preview() {
        // The same example as `splitSale` in apps/web/test/market.test.ts.
        let split = split_sale(650_000_000, 500, 0).unwrap();
        assert_eq!(split.royalty_lamports, 32_500_000);
        assert_eq!(split.fee_lamports, 0);
        assert_eq!(split.seller_lamports, 617_500_000);
    }

    #[test]
    fn rounding_goes_to_the_seller() {
        // 5% of 10_000_019 is 500_000.95; the 0.95 stays with the seller.
        let split = split_sale(10_000_019, 500, 0).unwrap();
        assert_eq!(split.royalty_lamports, 500_000);
        assert_eq!(split.seller_lamports, 9_500_019);

        let split = split_sale(10_000_019, 500, 250).unwrap();
        assert_eq!(split.royalty_lamports, 500_000);
        assert_eq!(split.fee_lamports, 250_000);
        assert_eq!(split.seller_lamports, 9_250_019);
    }

    #[test]
    fn parts_always_add_up_to_the_price() {
        let prices = [
            MIN_PRICE_LAMPORTS,
            MIN_PRICE_LAMPORTS + 1,
            123_456_789,
            SOL - 1,
            7 * SOL + 3,
            MAX_PRICE_LAMPORTS,
        ];
        for price in prices {
            for royalty in [0u16, 1, 333, 500, MAX_ROYALTY_BPS] {
                for fee in [0u16, 1, 99, MAX_FEE_BPS] {
                    let split = split_sale(price, royalty, fee).unwrap();
                    assert_eq!(
                        split.royalty_lamports + split.fee_lamports + split.seller_lamports,
                        price,
                        "price {price}, royalty {royalty}, fee {fee}"
                    );
                    assert!(split.seller_lamports >= price / 2);
                }
            }
        }
    }

    #[test]
    fn no_overflow_at_the_extremes() {
        let split = split_sale(u64::MAX, 10_000, 0).unwrap();
        assert_eq!(split.royalty_lamports, u64::MAX);
        assert_eq!(split.seller_lamports, 0);
        assert_eq!(share_of(u64::MAX, 5_000), Some(u64::MAX / 2));
    }

    #[test]
    fn rates_above_the_price_are_refused() {
        assert_eq!(share_of(SOL, 10_001), None);
        assert_eq!(split_sale(SOL, 6_000, 5_000), None);
        assert!(split_sale(SOL, 5_000, 5_000).is_some());
    }
    #[test]
    fn the_first_bid_needs_the_start_price_and_later_ones_five_percent_more() {
        assert_eq!(min_next_bid(10_000_000, 0, false), Some(10_000_000));
        assert_eq!(min_next_bid(10_000_000, 100_000_000, true), Some(105_000_000));
        // Rounded up: 5% of 10_000_001 is 500_000.05.
        assert_eq!(min_next_bid(1, 10_000_001, true), Some(10_500_002));
        // Never a zero step, even for a tiny bid.
        assert_eq!(min_next_bid(1, 1, true), Some(2));
        assert_eq!(min_next_bid(1, u64::MAX, true), None);
    }

    #[test]
    fn a_late_bid_pushes_the_end_past_it_by_the_window() {
        let end = 1_000_000;
        let window = AUCTION_EXTENSION_SECONDS;
        assert_eq!(end_after_bid(end, end - 3_600), end, "an early bid changes nothing");
        assert_eq!(end_after_bid(end, end - window), end, "exactly at the start of the window");
        assert_eq!(end_after_bid(end, end - window + 1), end + 1);
        assert_eq!(end_after_bid(end, end - 1), end + window - 1);
    }

    #[test]
    fn only_the_three_lengths_are_taken() {
        for hours in [0, 1, 12, 23, 25, 71, 73, 255] {
            assert_eq!(auction_seconds(hours), None, "{hours}");
        }
    }

    #[cfg(not(feature = "devnet-clock"))]
    #[test]
    fn auctions_run_for_one_two_or_three_days() {
        assert_eq!(auction_seconds(24), Some(86_400));
        assert_eq!(auction_seconds(48), Some(172_800));
        assert_eq!(auction_seconds(72), Some(259_200));
        assert_eq!(AUCTION_EXTENSION_SECONDS, 600);
    }

    #[cfg(feature = "devnet-clock")]
    #[test]
    fn the_devnet_clock_runs_auctions_in_minutes() {
        assert_eq!(auction_seconds(24), Some(240));
        assert_eq!(auction_seconds(48), Some(480));
        assert_eq!(auction_seconds(72), Some(720));
        assert_eq!(AUCTION_EXTENSION_SECONDS, 60);
    }
}
