use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::constants::{AUTHORITY_SEED, CONFIG_SEED, OFFER_SEED, OFFER_VERSION};
use crate::core_asset;
use crate::errors::MarketError;
use crate::events::OfferMade;
use crate::sale::{offer_seconds, price_in_range};
use crate::state::{move_lamports, MarketConfig, Offer};

#[derive(Accounts)]
pub struct MakeOffer<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MarketConfig>,

    /// New, or the buyer's earlier offer on this citizen, which is replaced.
    #[account(
        init_if_needed,
        payer = buyer,
        space = Offer::LEN,
        seeds = [OFFER_SEED, asset.key().as_ref(), buyer.key().as_ref()],
        bump
    )]
    pub offer: Account<'info, Offer>,

    /// CHECK: read as a Core asset in the handler.
    pub asset: UncheckedAccount<'info>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: PDA with no data; holds the asset while it is auctioned.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub market_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> MakeOffer<'info> {
    /// Moves `amount_lamports` from the buyer into the offer, open for `days`.
    /// When the buyer already has an offer on this citizen, its SOL goes back
    /// in the same instruction and the new amount and end replace the old.
    ///
    /// The citizen may be listed or not, but not at auction (the market holds
    /// it, and a bid is the way to buy it) nor frozen, and not the buyer's own.
    pub fn process(ctx: Context<Self>, amount_lamports: u64, days: u8) -> Result<()> {
        let accounts = &ctx.accounts;
        let config = &accounts.config;
        let buyer = accounts.buyer.key();
        let now = Clock::get()?.unix_timestamp;

        require!(!config.is_paused, MarketError::MarketPaused);
        require!(
            price_in_range(amount_lamports),
            MarketError::PriceOutOfRange
        );
        let open_for =
            offer_seconds(days).ok_or_else(|| error!(MarketError::InvalidOfferLength))?;

        let asset = core_asset::load_core_asset(&accounts.asset)?;
        require_keys_eq!(
            asset.collection,
            config.collection,
            MarketError::WrongCollection
        );
        require_keys_neq!(
            asset.owner,
            *accounts.market_authority.key,
            MarketError::AssetInAuction
        );
        require_keys_neq!(asset.owner, buyer, MarketError::BuyerIsSeller);
        require!(!asset.is_frozen(), MarketError::AssetFrozen);

        // A fresh account is all zeros, so its version tells a replacement from a new offer.
        let previous = if accounts.offer.version == OFFER_VERSION {
            accounts.offer.amount_lamports
        } else {
            0
        };

        system_program::transfer(
            CpiContext::new(
                accounts.system_program.to_account_info(),
                Transfer {
                    from: accounts.buyer.to_account_info(),
                    to: accounts.offer.to_account_info(),
                },
            ),
            amount_lamports,
        )?;
        move_lamports(
            &accounts.offer.to_account_info(),
            &accounts.buyer.to_account_info(),
            previous,
        )?;

        let expires_at = now
            .checked_add(open_for)
            .ok_or_else(|| error!(MarketError::Overflow))?;
        let asset_key = accounts.asset.key();
        let bump = ctx.bumps.offer;
        ctx.accounts.offer.set_inner(Offer {
            version: OFFER_VERSION,
            asset: asset_key,
            buyer,
            amount_lamports,
            made_at: now,
            expires_at,
            bump,
        });

        emit!(OfferMade {
            asset: asset_key,
            buyer,
            amount_lamports,
            previous_amount_lamports: previous,
            expires_at,
        });
        Ok(())
    }
}
