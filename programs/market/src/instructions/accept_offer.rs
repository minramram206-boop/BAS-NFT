use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, LISTING_SEED, OFFER_SEED};
use crate::core_asset::{self, TransferAccounts, MPL_CORE_PROGRAM_ID};
use crate::errors::MarketError;
use crate::events::OfferAccepted;
use crate::sale::split_sale;
use crate::state::{move_lamports, Listing, MarketConfig, Offer};

#[derive(Accounts)]
pub struct AcceptOffer<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MarketConfig>,

    #[account(
        mut,
        seeds = [OFFER_SEED, asset.key().as_ref(), buyer.key().as_ref()],
        bump = offer.bump,
        has_one = buyer @ MarketError::Unauthorized,
        has_one = asset @ MarketError::InvalidAsset,
        close = buyer
    )]
    pub offer: Account<'info, Offer>,

    /// CHECK: tied to the offer by `has_one`; read as a Core asset in the
    /// handler and written by Core.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,

    /// CHECK: Core requires the asset's collection on every transfer.
    #[account(address = config.collection @ MarketError::WrongCollection)]
    pub collection: UncheckedAccount<'info>,

    /// The citizen's owner. Signs the Core transfer itself, so no delegate is needed.
    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: the offer's buyer; receives the citizen and the offer's rent.
    #[account(mut)]
    pub buyer: UncheckedAccount<'info>,

    /// The owner's fixed-price listing of this citizen, closed in the same
    /// step. Absent when it is not listed.
    #[account(
        mut,
        seeds = [LISTING_SEED, asset.key().as_ref()],
        bump = listing.bump,
        constraint = listing.seller == owner.key() @ MarketError::Unauthorized,
        close = owner
    )]
    pub listing: Option<Account<'info, Listing>>,

    /// CHECK: fixed by the config.
    #[account(mut, address = config.royalty_recipient @ MarketError::InvalidConfig)]
    pub royalty_recipient: UncheckedAccount<'info>,

    /// CHECK: fixed by the config. Receives nothing while `fee_bps` is 0.
    #[account(mut, address = config.fee_recipient @ MarketError::InvalidConfig)]
    pub fee_recipient: UncheckedAccount<'info>,

    /// CHECK: address checked.
    #[account(address = MPL_CORE_PROGRAM_ID @ MarketError::InvalidAsset)]
    pub core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> AcceptOffer<'info> {
    /// The owner sells the citizen to the offer's buyer: Core moves it, the
    /// offered SOL is split between owner, royalty and fee, the offer closes
    /// with its rent going back to the buyer, and a listing of the citizen
    /// closes too. One instruction, so all of it happens or none.
    ///
    /// `amount_lamports` is the offer the owner saw. If the buyer changed it
    /// in the meantime the sale fails instead of going through at another price.
    pub fn process(ctx: Context<Self>, amount_lamports: u64) -> Result<()> {
        let accounts = &ctx.accounts;
        let config = &accounts.config;
        let offer = &accounts.offer;
        let owner = accounts.owner.key();

        require!(!config.is_paused, MarketError::MarketPaused);
        require!(
            offer.amount_lamports == amount_lamports,
            MarketError::OfferChanged
        );
        require!(
            offer.is_open(Clock::get()?.unix_timestamp),
            MarketError::OfferExpired
        );
        require_keys_neq!(owner, offer.buyer, MarketError::BuyerIsSeller);

        let asset = core_asset::load_core_asset(&accounts.asset)?;
        require_keys_eq!(
            asset.collection,
            config.collection,
            MarketError::WrongCollection
        );
        require_keys_eq!(asset.owner, owner, MarketError::NotOwner);
        require!(!asset.is_frozen(), MarketError::AssetFrozen);

        core_asset::transfer_by_signer(TransferAccounts {
            core_program: &accounts.core_program,
            asset: &accounts.asset,
            collection: &accounts.collection,
            payer: &accounts.owner,
            authority: &accounts.owner,
            new_owner: &accounts.buyer,
            system_program: &accounts.system_program,
        })?;
        let moved = core_asset::load_core_asset(&accounts.asset)?;
        require_keys_eq!(moved.owner, offer.buyer, MarketError::NotOwner);

        let split = split_sale(amount_lamports, config.royalty_bps, config.fee_bps)
            .ok_or_else(|| error!(MarketError::Overflow))?;
        let offer_info = accounts.offer.to_account_info();
        move_lamports(
            &offer_info,
            &accounts.owner.to_account_info(),
            split.seller_lamports,
        )?;
        move_lamports(
            &offer_info,
            &accounts.royalty_recipient,
            split.royalty_lamports,
        )?;
        move_lamports(&offer_info, &accounts.fee_recipient, split.fee_lamports)?;

        emit!(OfferAccepted {
            asset: offer.asset,
            seller: owner,
            buyer: offer.buyer,
            price_lamports: amount_lamports,
            royalty_lamports: split.royalty_lamports,
            fee_lamports: split.fee_lamports,
            seller_lamports: split.seller_lamports,
        });
        Ok(())
    }
}
