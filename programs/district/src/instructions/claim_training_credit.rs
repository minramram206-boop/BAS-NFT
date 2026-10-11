use anchor_lang::prelude::*;

use crate::constants::{CITIZEN_SEED, CLAIM_RECEIPT_VERSION, CLAIM_SEED, CONFIG_SEED};
use crate::errors::DistrictError;
use crate::events::TrainingCreditClaimed;
use crate::mpl_core::{load_collection_member, MPL_CORE_PROGRAM_ID};
use crate::pda::create_pda_account;
use crate::state::{CitizenStat, CitizenState, ClaimReceipt, DistrictConfig};

/// A mission reward. The mission authority co-signs the whole transaction,
/// which binds every field here plus the accounts to its approval.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct MissionClaimArgs {
    /// 0 = Insight, 1 = Bond, 2 = Craft.
    pub stat: u8,
    pub mission_id: u64,
    pub season_id: u32,
    pub nonce: u64,
    /// Unix seconds; the claim is rejected at or after this time.
    pub expires_at: i64,
}

#[derive(Accounts)]
#[instruction(args: MissionClaimArgs)]
pub struct ClaimTrainingCredit<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = !config.is_paused @ DistrictError::ProgramPaused
    )]
    pub config: Account<'info, DistrictConfig>,

    /// CHECK: must be owned by Metaplex Core; parsed by `load_collection_member`.
    #[account(owner = MPL_CORE_PROGRAM_ID @ DistrictError::InvalidAssetState)]
    pub asset: UncheckedAccount<'info>,

    /// Derived from `asset`, so a credit can only land on that asset's citizen.
    #[account(
        mut,
        seeds = [CITIZEN_SEED, asset.key().as_ref()],
        bump = citizen_state.bump
    )]
    pub citizen_state: Account<'info, CitizenState>,

    /// Checked as a constraint so the owner cannot pass their own key here.
    #[account(
        constraint = mission_authority.key() == config.mission_authority
            @ DistrictError::InvalidMissionClaim
    )]
    pub mission_authority: Signer<'info>,

    /// Current holder of the asset; pays for the receipt.
    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: address is fixed by the seeds below; the handler creates it.
    /// Not an `init` account so a replay reports `MissionClaimAlreadyUsed`.
    #[account(
        mut,
        seeds = [
            CLAIM_SEED,
            asset.key().as_ref(),
            args.mission_id.to_le_bytes().as_ref(),
            args.nonce.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub claim_receipt: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> ClaimTrainingCredit<'info> {
    /// Adds exactly one stat-specific Training Credit (SPEC §12). This is the
    /// only way credits increase.
    pub fn process(ctx: Context<Self>, args: MissionClaimArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(args.expires_at > now, DistrictError::MissionClaimExpired);
        let stat = CitizenStat::from_index(args.stat)?;

        let asset = ctx.accounts.asset.to_account_info();
        let owner = ctx.accounts.owner.key();
        load_collection_member(&asset, &ctx.accounts.config.collection_mint, &owner)?;

        let receipt_info = ctx.accounts.claim_receipt.to_account_info();
        require!(
            receipt_info.owner == &System::id() && receipt_info.data_is_empty(),
            DistrictError::MissionClaimAlreadyUsed
        );

        let asset_key = asset.key();
        let mission_bytes = args.mission_id.to_le_bytes();
        let nonce_bytes = args.nonce.to_le_bytes();
        let bump = [ctx.bumps.claim_receipt];
        create_pda_account(
            &ctx.accounts.owner.to_account_info(),
            &receipt_info,
            &ctx.accounts.system_program.to_account_info(),
            ClaimReceipt::LEN,
            &[
                CLAIM_SEED,
                asset_key.as_ref(),
                &mission_bytes,
                &nonce_bytes,
                &bump,
            ],
        )?;

        let receipt = ClaimReceipt {
            version: CLAIM_RECEIPT_VERSION,
            bump: ctx.bumps.claim_receipt,
            asset: asset_key,
            owner,
            mission_id: args.mission_id,
            season_id: args.season_id,
            stat: stat as u8,
            nonce: args.nonce,
            expires_at: args.expires_at,
            claimed_at: now,
        };
        receipt.try_serialize(&mut &mut receipt_info.try_borrow_mut_data()?[..])?;

        let citizen = &mut ctx.accounts.citizen_state;
        citizen.grant_credit(stat)?;

        emit!(TrainingCreditClaimed {
            asset: asset_key,
            owner,
            stat: stat as u8,
            mission_id: args.mission_id,
            season_id: args.season_id,
            nonce: args.nonce,
            remaining_credits: citizen.credits_of(stat),
        });
        Ok(())
    }
}
