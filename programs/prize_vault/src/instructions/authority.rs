use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::PrizeError;
use crate::events::{AuthorityAccepted, AuthorityProposed};
use crate::state::PrizeConfig;

#[derive(Accounts)]
pub struct ProposeAuthority<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ PrizeError::Unauthorized
    )]
    pub config: Account<'info, PrizeConfig>,

    pub authority: Signer<'info>,
}

impl<'info> ProposeAuthority<'info> {
    /// Names the next authority, a multisig before launch. It takes over only
    /// once it signs `accept_authority`, so a typo cannot lock the vault.
    pub fn process(ctx: Context<Self>, proposed: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.pending_authority = proposed;
        emit!(AuthorityProposed {
            authority: config.authority,
            proposed,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, PrizeConfig>,

    pub pending_authority: Signer<'info>,
}

impl<'info> AcceptAuthority<'info> {
    pub fn process(ctx: Context<Self>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require_keys_neq!(
            config.pending_authority,
            Pubkey::default(),
            PrizeError::NoPendingAuthority
        );
        require_keys_eq!(
            config.pending_authority,
            ctx.accounts.pending_authority.key(),
            PrizeError::Unauthorized
        );
        let previous = config.authority;
        config.authority = config.pending_authority;
        config.pending_authority = Pubkey::default();
        emit!(AuthorityAccepted {
            previous,
            authority: config.authority,
        });
        Ok(())
    }
}
