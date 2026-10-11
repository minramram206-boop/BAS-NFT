//! PDA addresses and program-owned account creation.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Allocate, Assign, CreateAccount, Transfer};

use crate::constants::{APPROVED_TEMPLATE_SEED, CITIZEN_SEED, CLAIM_SEED, CONFIG_SEED};

pub fn config_address() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], &crate::ID)
}

pub fn approved_template_address(template_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[APPROVED_TEMPLATE_SEED, template_id.to_le_bytes().as_ref()],
        &crate::ID,
    )
}

pub fn citizen_address(asset: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CITIZEN_SEED, asset.as_ref()], &crate::ID)
}

pub fn claim_receipt_address(asset: &Pubkey, mission_id: u64, nonce: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CLAIM_SEED,
            asset.as_ref(),
            mission_id.to_le_bytes().as_ref(),
            nonce.to_le_bytes().as_ref(),
        ],
        &crate::ID,
    )
}

/// Creates a program-owned PDA of `space` bytes, paid by `payer`.
///
/// Works even when someone has already sent lamports to the address:
/// `create_account` refuses a funded account, which would otherwise let anyone
/// block a predictable PDA for one lamport. In that case the balance is topped
/// up to rent exemption and the account is allocated and assigned instead.
pub fn create_pda_account<'info>(
    payer: &AccountInfo<'info>,
    target: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    space: usize,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    let rent = Rent::get()?.minimum_balance(space);
    let current = target.lamports();
    let signer = &[signer_seeds];

    if current == 0 {
        return system_program::create_account(
            CpiContext::new_with_signer(
                system_program.clone(),
                CreateAccount {
                    from: payer.clone(),
                    to: target.clone(),
                },
                signer,
            ),
            rent,
            space as u64,
            &crate::ID,
        );
    }

    let top_up = rent.saturating_sub(current);
    if top_up > 0 {
        system_program::transfer(
            CpiContext::new(
                system_program.clone(),
                Transfer {
                    from: payer.clone(),
                    to: target.clone(),
                },
            ),
            top_up,
        )?;
    }
    system_program::allocate(
        CpiContext::new_with_signer(
            system_program.clone(),
            Allocate {
                account_to_allocate: target.clone(),
            },
            signer,
        ),
        space as u64,
    )?;
    system_program::assign(
        CpiContext::new_with_signer(
            system_program.clone(),
            Assign {
                account_to_assign: target.clone(),
            },
            signer,
        ),
        &crate::ID,
    )
}
