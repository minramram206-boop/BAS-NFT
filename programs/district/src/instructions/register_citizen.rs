use anchor_lang::prelude::*;

use crate::constants::{
    APPROVED_TEMPLATE_SEED, APPROVED_TEMPLATE_VERSION, CITIZEN_SEED, CITIZEN_STATE_VERSION,
    CONFIG_SEED,
};
use crate::errors::DistrictError;
use crate::events::CitizenRegistered;
use crate::mpl_core::{load_collection_member, read_core_asset_uri, MPL_CORE_PROGRAM_ID};
use crate::roles::role_from_metadata_file;
use crate::state::{ApprovedTemplate, CitizenState, DistrictConfig};

#[derive(Accounts)]
pub struct RegisterCitizen<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = !config.is_paused @ DistrictError::ProgramPaused
    )]
    pub config: Account<'info, DistrictConfig>,

    /// CHECK: must be owned by Metaplex Core; parsed by `load_collection_member`.
    #[account(owner = MPL_CORE_PROGRAM_ID @ DistrictError::InvalidAssetState)]
    pub asset: UncheckedAccount<'info>,

    #[account(
        seeds = [APPROVED_TEMPLATE_SEED, config.approved_template_id.to_le_bytes().as_ref()],
        bump = approved_template.bump,
        constraint = approved_template.version == APPROVED_TEMPLATE_VERSION
            @ DistrictError::InvalidAssetState,
        constraint = approved_template.template_id == config.approved_template_id
            @ DistrictError::InvalidAssetState
    )]
    pub approved_template: Account<'info, ApprovedTemplate>,

    /// `init` is what stops a second registration of the same asset.
    #[account(
        init,
        payer = owner,
        space = CitizenState::LEN,
        seeds = [CITIZEN_SEED, asset.key().as_ref()],
        bump
    )]
    pub citizen_state: Account<'info, CitizenState>,

    /// Current holder of the asset; pays rent.
    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> RegisterCitizen<'info> {
    /// Turns an official Core asset into a citizen (SPEC §6.3). The role is
    /// the one named by the asset's metadata file (D-0022) and the initial
    /// stats come from the role registry; the caller chooses neither.
    pub fn process(ctx: Context<Self>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let asset = ctx.accounts.asset.to_account_info();

        let holder =
            load_collection_member(&asset, &config.collection_mint, &ctx.accounts.owner.key())?;
        let template = {
            let data = asset.try_borrow_data()?;
            let file_name = ctx
                .accounts
                .approved_template
                .approved_file_name(read_core_asset_uri(&data)?)
                .ok_or(DistrictError::InvalidMetadataUri)?;
            role_from_metadata_file(file_name)?
        };

        let citizen_id = config
            .total_registered_citizens
            .checked_add(1)
            .ok_or(DistrictError::ArithmeticOverflow)?;
        config.total_registered_citizens = citizen_id;

        let citizen = &mut ctx.accounts.citizen_state;
        citizen.set_inner(CitizenState {
            version: CITIZEN_STATE_VERSION,
            bump: ctx.bumps.citizen_state,
            citizen_id,
            asset: asset.key(),
            role: template.index,
            intelligence: template.initial_intelligence,
            alignment: template.initial_alignment,
            compute: template.initial_compute,
            // Credits are only earned through missions (SPEC §5.3).
            insight_training_credits: 0,
            bond_training_credits: 0,
            craft_training_credits: 0,
        });

        emit!(CitizenRegistered {
            asset: citizen.asset,
            owner: holder.owner,
            citizen_id,
            role: citizen.role,
            role_label: template.public_label.to_string(),
            intelligence: citizen.intelligence,
            alignment: citizen.alignment,
            compute: citizen.compute,
            total_registered_citizens: config.total_registered_citizens,
        });
        Ok(())
    }
}
