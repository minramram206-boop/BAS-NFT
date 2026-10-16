use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;

use crate::constants::{CONFIG_SEED, CONFIG_VERSION, VAULT_SEED, VAULT_VERSION};
use crate::errors::PrizeError;
use crate::events::VaultInitialized;
use crate::state::{PrizeConfig, PrizeVault};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = PrizeConfig::LEN,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, PrizeConfig>,

    #[account(
        init,
        payer = authority,
        space = PrizeVault::LEN,
        seeds = [VAULT_SEED],
        bump
    )]
    pub vault: Account<'info, PrizeVault>,

    /// This program's ProgramData. Only its upgrade authority may initialize,
    /// so nobody can take the authority seat between deploy and setup.
    #[account(
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = bpf_loader_upgradeable::ID,
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ PrizeError::Unauthorized
    )]
    pub program_data: Account<'info, ProgramData>,

    /// Upgrade authority; becomes the first prize authority and pays rent.
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> Initialize<'info> {
    /// Opens the vault, which must exist before its address goes into
    /// Pump.fun's fee sharing config.
    pub fn process(ctx: Context<Self>) -> Result<()> {
        ctx.accounts.config.set_inner(PrizeConfig {
            version: CONFIG_VERSION,
            authority: ctx.accounts.authority.key(),
            pending_authority: Pubkey::default(),
            reserved_lamports: 0,
            paid_lamports: 0,
            bump: ctx.bumps.config,
            vault_bump: ctx.bumps.vault,
        });
        ctx.accounts.vault.set_inner(PrizeVault {
            version: VAULT_VERSION,
            bump: ctx.bumps.vault,
        });
        emit!(VaultInitialized {
            authority: ctx.accounts.authority.key(),
            vault: ctx.accounts.vault.key(),
        });
        Ok(())
    }
}
