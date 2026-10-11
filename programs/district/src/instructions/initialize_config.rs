use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;

use crate::constants::{
    APPROVED_TEMPLATE_SEED, APPROVED_TEMPLATE_VERSION, CONFIG_SEED, DISTRICT_CONFIG_VERSION,
};
use crate::errors::DistrictError;
use crate::events::ConfigInitialized;
use crate::state::{ApprovedTemplate, DistrictConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeConfigArgs {
    pub mission_authority: Pubkey,
    pub sol_treasury: Pubkey,
    pub collection_mint: Pubkey,
    pub approved_template_id: u32,
    /// HTTPS prefix ending in `/templates/{approved_template_id}/`.
    pub approved_template_uri_prefix: String,
    /// Token atoms.
    pub base_training_cost: u64,
}

#[derive(Accounts)]
#[instruction(args: InitializeConfigArgs)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = DistrictConfig::LEN,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, DistrictConfig>,

    #[account(
        init,
        payer = admin,
        space = ApprovedTemplate::space(args.approved_template_uri_prefix.len()),
        seeds = [APPROVED_TEMPLATE_SEED, args.approved_template_id.to_le_bytes().as_ref()],
        bump
    )]
    pub approved_template: Account<'info, ApprovedTemplate>,

    /// This program's ProgramData. Only its upgrade authority may initialize,
    /// so nobody can claim the admin seat between deploy and setup.
    #[account(
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = bpf_loader_upgradeable::ID,
        constraint = program_data.upgrade_authority_address == Some(admin.key())
            @ DistrictError::Unauthorized
    )]
    pub program_data: Account<'info, ProgramData>,

    /// Upgrade authority; becomes the first admin and pays rent.
    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> InitializeConfig<'info> {
    /// The district always starts paused. It can only be unpaused after the
    /// utility mint is bound and locked (SPEC §5.2, §5.7).
    pub fn process(ctx: Context<Self>, args: InitializeConfigArgs) -> Result<()> {
        DistrictConfig::require_valid_parameters(
            &args.mission_authority,
            &args.sol_treasury,
            args.base_training_cost,
        )?;
        require!(
            args.collection_mint != Pubkey::default(),
            DistrictError::InvalidConfig
        );
        require!(
            ApprovedTemplate::is_valid_uri_prefix(
                &args.approved_template_uri_prefix,
                args.approved_template_id,
            ),
            DistrictError::InvalidAssetState
        );

        let template = &mut ctx.accounts.approved_template;
        template.version = APPROVED_TEMPLATE_VERSION;
        template.bump = ctx.bumps.approved_template;
        template.template_id = args.approved_template_id;
        template.uri_prefix = args.approved_template_uri_prefix;

        let config = &mut ctx.accounts.config;
        config.set_inner(DistrictConfig {
            version: DISTRICT_CONFIG_VERSION,
            admin: ctx.accounts.admin.key(),
            pending_admin: Pubkey::default(),
            mission_authority: args.mission_authority,
            sol_treasury: args.sol_treasury,
            collection_mint: args.collection_mint,
            utility_mint: Pubkey::default(),
            utility_mint_locked: false,
            approved_template_id: args.approved_template_id,
            base_training_cost: args.base_training_cost,
            total_registered_citizens: 0,
            is_paused: true,
            bump: ctx.bumps.config,
        });

        emit!(ConfigInitialized {
            admin: config.admin,
            mission_authority: config.mission_authority,
            sol_treasury: config.sol_treasury,
            collection_mint: config.collection_mint,
            approved_template_id: config.approved_template_id,
            base_training_cost: config.base_training_cost,
            is_paused: config.is_paused,
        });
        Ok(())
    }
}
