//! Instruction builders. Account order and discriminators come from the code
//! Anchor generates, never from hand-written metas.

use anchor_lang::{
    solana_program::{instruction::Instruction, pubkey::Pubkey, system_program},
    InstructionData, ToAccountMetas,
};
use district::{accounts, instruction, InitializeConfigArgs, MissionClaimArgs, UpdateConfigArgs};
use solana_sdk::signer::Signer;

use super::bank::Harness;
use super::{
    APPROVED_TEMPLATE_ID, APPROVED_TEMPLATE_URI_PREFIX, BASE_TRAINING_COST, TOKEN_DECIMALS,
};

fn build(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction {
        program_id: district::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
}

pub fn default_init_args(harness: &Harness) -> InitializeConfigArgs {
    InitializeConfigArgs {
        mission_authority: harness.mission_authority.pubkey(),
        sol_treasury: harness.sol_treasury,
        collection_mint: harness.collection_mint,
        approved_template_id: APPROVED_TEMPLATE_ID,
        approved_template_uri_prefix: APPROVED_TEMPLATE_URI_PREFIX.to_string(),
        base_training_cost: BASE_TRAINING_COST,
    }
}

pub fn initialize_config_ix(
    harness: &Harness,
    admin: Pubkey,
    args: InitializeConfigArgs,
) -> Instruction {
    let template = district::pda::approved_template_address(args.approved_template_id).0;
    build(
        accounts::InitializeConfig {
            config: harness.config_key(),
            approved_template: template,
            program_data: harness.program_data_key(),
            admin,
            system_program: system_program::ID,
        },
        instruction::InitializeConfig { args },
    )
}

pub fn set_utility_mint_ix(harness: &Harness, admin: Pubkey, utility_mint: Pubkey) -> Instruction {
    set_utility_mint_with_decimals_ix(harness, admin, utility_mint, TOKEN_DECIMALS)
}

pub fn set_utility_mint_with_decimals_ix(
    harness: &Harness,
    admin: Pubkey,
    utility_mint: Pubkey,
    expected_decimals: u8,
) -> Instruction {
    build(
        accounts::SetUtilityMint {
            config: harness.config_key(),
            utility_mint,
            admin,
        },
        instruction::SetUtilityMint { expected_decimals },
    )
}

pub fn lock_utility_mint_ix(harness: &Harness, admin: Pubkey) -> Instruction {
    build(
        accounts::LockUtilityMint {
            config: harness.config_key(),
            admin,
        },
        instruction::LockUtilityMint {},
    )
}

pub fn update_config_ix(harness: &Harness, admin: Pubkey, args: UpdateConfigArgs) -> Instruction {
    build(
        accounts::UpdateConfigAccounts {
            config: harness.config_key(),
            admin,
        },
        instruction::UpdateConfig { args },
    )
}

pub fn set_paused_ix(harness: &Harness, admin: Pubkey, paused: bool) -> Instruction {
    build(
        accounts::SetPaused {
            config: harness.config_key(),
            admin,
        },
        instruction::SetPaused { paused },
    )
}

pub fn register_ix(harness: &Harness, asset: Pubkey, owner: Pubkey) -> Instruction {
    build(
        accounts::RegisterCitizen {
            config: harness.config_key(),
            asset,
            approved_template: harness.template_key(),
            citizen_state: harness.citizen_pda(&asset),
            owner,
            system_program: system_program::ID,
        },
        instruction::RegisterCitizen {},
    )
}

/// Accounts of one claim, so tests can swap a single field.
pub struct ClaimAccounts {
    pub asset: Pubkey,
    pub citizen_state: Pubkey,
    pub owner: Pubkey,
    pub mission_authority: Pubkey,
    pub receipt: Pubkey,
}

impl ClaimAccounts {
    /// The honest accounts for `args` on `asset`, held by the harness holder.
    pub fn for_holder(harness: &Harness, asset: Pubkey, args: &MissionClaimArgs) -> Self {
        Self {
            asset,
            citizen_state: harness.citizen_pda(&asset),
            owner: harness.holder.pubkey(),
            mission_authority: harness.mission_authority.pubkey(),
            receipt: harness.claim_receipt_pda(&asset, args.mission_id, args.nonce),
        }
    }
}

pub fn claim_ix(harness: &Harness, claim: &ClaimAccounts, args: MissionClaimArgs) -> Instruction {
    build(
        accounts::ClaimTrainingCredit {
            config: harness.config_key(),
            asset: claim.asset,
            citizen_state: claim.citizen_state,
            mission_authority: claim.mission_authority,
            owner: claim.owner,
            claim_receipt: claim.receipt,
            system_program: system_program::ID,
        },
        instruction::ClaimTrainingCredit { args },
    )
}

/// Accounts of one upgrade, so tests can swap a single field.
#[derive(Clone, Copy)]
pub struct UpgradeAccounts {
    pub asset: Pubkey,
    pub citizen_state: Pubkey,
    pub owner: Pubkey,
    pub utility_mint: Pubkey,
    pub user_token_account: Pubkey,
    pub token_program: Pubkey,
}

pub fn upgrade_ix(harness: &Harness, upgrade: &UpgradeAccounts, stat_index: u8) -> Instruction {
    build(
        accounts::UpgradeScore {
            config: harness.config_key(),
            asset: upgrade.asset,
            citizen_state: upgrade.citizen_state,
            owner: upgrade.owner,
            utility_mint: upgrade.utility_mint,
            user_token_account: upgrade.user_token_account,
            token_program: upgrade.token_program,
        },
        instruction::UpgradeScore { stat_index },
    )
}

pub fn propose_admin_ix(harness: &Harness, admin: Pubkey, proposed_admin: Pubkey) -> Instruction {
    build(
        accounts::ProposeAdmin {
            config: harness.config_key(),
            admin,
        },
        instruction::ProposeAdmin { proposed_admin },
    )
}

pub fn accept_admin_ix(harness: &Harness, new_admin: Pubkey) -> Instruction {
    build(
        accounts::AcceptAdmin {
            config: harness.config_key(),
            new_admin,
        },
        instruction::AcceptAdmin {},
    )
}
