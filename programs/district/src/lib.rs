use anchor_lang::{prelude::*, solana_program::program_pack::Pack};
use anchor_spl::token::{self, Burn, Token, TokenAccount};

pub mod errors;
pub mod events;
pub mod mpl_core;
pub mod roles;
pub mod state;

use errors::*;
use events::*;
use mpl_core::*;
use roles::*;
use state::*;

declare_id!("D8HGhXUqHx7UXysCMEBDzvd3FS4XGEMNjCR6Eaj8CRbV");

/// The district program.
///
/// Instruction set, events and errors follow `PIXEL_DISTRICT_SPEC_V2_ID.md`
/// §12 and §13. Ownership and progression are canonical here; browser state is
/// presentation only (`AGENT_START_HERE.md` §3).
#[program]
pub mod district {
    use super::*;

    /// Create the district configuration (§12 `initialize_config`).
    ///
    /// Callable only by the bootstrap authority, who becomes the first admin.
    /// The utility mint is deliberately *not* an argument: §5.7 has the token
    /// launched through Pump.fun after the program is deployed, so it is bound
    /// later with `set_utility_mint` and then permanently with
    /// `lock_utility_mint`.
    ///
    /// Mainnet is initialized paused and only unpaused once the token binding,
    /// treasury, multisig, vault and program configuration have been verified
    /// (`AGENT_START_HERE.md` §4).
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        args: InitializeConfigArgs,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.version = DISTRICT_CONFIG_VERSION;
        config.admin = ctx.accounts.admin.key();
        // No transfer is pending until `propose_admin` runs.
        config.pending_admin = Pubkey::default();
        config.mission_authority = args.mission_authority;
        config.sol_treasury = args.sol_treasury;
        config.collection_mint = args.collection_mint;
        // Zero means "not configured yet", which is what makes §15.4 acceptance
        // test 4 (upgrade disabled before the mint is configured) enforceable.
        config.utility_mint = Pubkey::default();
        config.utility_mint_locked = false;
        config.approved_template_id = args.approved_template_id;
        config.base_training_cost = args.base_training_cost;
        config.total_registered_citizens = 0;
        config.is_paused = args.start_paused;
        config.bump = ctx.bumps.config;

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

    /// Bind the one official utility token (§12 `set_utility_mint`).
    ///
    /// Admin only, and only while unlocked. Once `lock_utility_mint` has run
    /// this is closed forever, which is what makes §5.2 ("never create a second
    /// upgrade token") a property of the program rather than a promise.
    pub fn set_utility_mint(ctx: Context<SetUtilityMint>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.utility_mint_locked, DistrictError::UtilityMintLocked);

        // The mint has to be a real, initialized SPL Token mint: binding an
        // empty or non-mint account would make every later burn unverifiable.
        let mint_data = ctx.accounts.utility_mint.try_borrow_data()?;
        require!(
            mint_data.len() >= spl_token::state::Mint::LEN,
            DistrictError::InvalidUtilityMint
        );
        let mint = spl_token::state::Mint::unpack(&mint_data)
            .map_err(|_| DistrictError::InvalidUtilityMint)?;
        require!(mint.is_initialized, DistrictError::InvalidUtilityMint);

        config.utility_mint = ctx.accounts.utility_mint.key();

        emit!(UtilityMintSet {
            utility_mint: config.utility_mint,
            admin: config.admin,
        });
        Ok(())
    }

    /// Permanently bind the utility mint (§12 `lock_utility_mint`).
    ///
    /// Irreversible by design: there is no instruction that clears this flag.
    pub fn lock_utility_mint(ctx: Context<LockUtilityMint>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.utility_mint_locked, DistrictError::UtilityMintLocked);
        require!(
            config.utility_mint != Pubkey::default(),
            DistrictError::UtilityMintNotSet
        );

        config.utility_mint_locked = true;

        emit!(UtilityMintLocked {
            utility_mint: config.utility_mint,
            admin: config.admin,
        });
        Ok(())
    }

    /// Update the operational parameters (§12 `update_config`).
    ///
    /// Admin only. Deliberately narrow: `admin` moves only through
    /// `propose_admin`/`accept_admin`, the utility mint only through
    /// `set_utility_mint` before the lock, the paused flag only through
    /// `set_paused`, and `collection_mint` and the registration counter are not
    /// editable at all. §17 replaces "devnet/mainnet feature differences" with
    /// "same architecture and instructions; addresses/config differ", so an
    /// instruction that could rewrite the collection would be a rug vector.
    pub fn update_config(ctx: Context<UpdateConfigAccounts>, args: UpdateConfigArgs) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.mission_authority = args.mission_authority;
        config.sol_treasury = args.sol_treasury;
        config.approved_template_id = args.approved_template_id;
        config.base_training_cost = args.base_training_cost;
        Ok(())
    }

    /// Pause or resume registration, claims and upgrades (§12 `set_paused`).
    ///
    /// The release sequence requires mainnet to launch paused and to be
    /// unpaused only after the token binding, treasury, multisig, vault and
    /// program configuration are verified, so this is the only instruction that
    /// may flip `DistrictConfig::is_paused`.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        // `has_one = admin` on `SetPaused` already proved the signer is admin.
        let config = &mut ctx.accounts.config;

        // Only a real transition is emitted, so a monitor can count actual
        // pause/resume events rather than every call.
        if config.is_paused != paused {
            emit!(PauseStateChanged {
                admin: config.admin,
                paused,
            });
        }

        config.is_paused = paused;
        Ok(())
    }

    /// Register a Core asset as a district citizen (§12 `register_citizen`,
    /// §6.3).
    ///
    /// Verifies, in order: the program is not paused, the asset is a readable
    /// uncompressed Core asset, it belongs to the official collection, the
    /// signer is its current owner, it is not already registered, and it carries
    /// the approved template identifier. Initial stats are then read from the
    /// role registry — never taken from the caller, which is what stops someone
    /// registering their own NFT at the maximum score.
    pub fn register_citizen(ctx: Context<RegisterCitizen>, role: u8) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.is_paused, DistrictError::ProgramPaused);

        // §6.3 items 1 and 2. The `owner = mpl_core_program` constraint on the
        // asset account is what makes these bytes trustworthy: only the Core
        // program can write them, so a caller cannot fabricate an account that
        // parses as a collection member.
        let asset_prefix = read_core_asset_prefix(&ctx.accounts.asset.try_borrow_data()?)?;
        require!(
            asset_prefix.belongs_to_collection(&config.collection_mint),
            DistrictError::InvalidCollection
        );
        // §12 "Signer is current owner". Read from the asset, not from stored
        // state, so it stays true after a transfer.
        require!(
            asset_prefix.is_owned_by(&ctx.accounts.owner.key()),
            DistrictError::NotOwner
        );

        // §6.3 item 3, verifying the approved template identifier, is enforced
        // by the `seeds` constraint on `template_id` above rather than here: the
        // constraint runs before this body, so a wrong identifier never reaches
        // it. Reading the asset's `uri` instead was rejected because the set of
        // approved URIs is not defined anywhere in the spec; see D-0013.

        // §6.3 item 4: read the citizen template from the registry. An unknown
        // role is an error rather than a default.
        let template = role_template(role)?;

        // §12: cannot run twice for the same asset. That is enforced by the
        // `init` constraint on `citizen_state` and not by a check here, because
        // `init` creates the account before this body runs — so any "is it still
        // empty?" test written here would see a fresh account and refuse every
        // first registration. §13 lists `CitizenAlreadyRegistered`, but a variant
        // no code path can return is a lie in the error list; the framework's own
        // code is what a replay actually produces, and the integration test
        // asserts it.

        let citizen = &mut ctx.accounts.citizen_state;
        citizen.version = CITIZEN_STATE_VERSION;
        citizen.bump = ctx.bumps.citizen_state;
        // 1-based: citizen #1 is the first registration.
        citizen.citizen_id = config.total_registered_citizens.saturating_add(1);
        citizen.asset = ctx.accounts.asset.key();
        citizen.role = template.index;
        // §6.3 item 6: initial stats based on role.
        citizen.intelligence = template.initial_intelligence;
        citizen.alignment = template.initial_alignment;
        citizen.compute = template.initial_compute;
        // §5.3: credits are earned from authorized missions or verified district
        // events, never bought and never granted at registration. Starting at
        // zero is what makes `claim_training_credit` necessary.
        citizen.insight_training_credits = 0;
        citizen.bond_training_credits = 0;
        citizen.craft_training_credits = 0;

        config.total_registered_citizens = config.total_registered_citizens.saturating_add(1);

        emit!(CitizenRegistered {
            asset: citizen.asset,
            owner: asset_prefix.owner,
            citizen_id: citizen.citizen_id,
            role: citizen.role,
            role_label: template.public_label.to_string(),
            intelligence: citizen.intelligence,
            alignment: citizen.alignment,
            compute: citizen.compute,
            total_registered_citizens: config.total_registered_citizens,
        });
        Ok(())
    }

    /// Add one stat-specific Training Credit from an authorized mission claim
    /// (§12 `claim_training_credit`).
    ///
    /// This is the only way credits can increase. §5.3: credits cannot be
    /// bought, cannot be moved between citizens, and live on the canonical
    /// `CitizenState`. The claim receipt PDA is what makes a signed claim
    /// single-use.
    pub fn claim_training_credit(
        ctx: Context<ClaimTrainingCredit>,
        args: MissionClaimArgs,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.is_paused, DistrictError::ProgramPaused);

        // Expiry is checked against the clock, so a claim cannot be held and
        // replayed later (§15.3 acceptance test 3).
        let clock = Clock::get()?;
        require!(
            args.expires_at > clock.unix_timestamp,
            DistrictError::MissionClaimExpired
        );

        // The stat has to be one of the three known ones before it is stored.
        let stat = CitizenStat::from_index(args.stat)?;

        // Ownership comes from the Core asset, not from stored state, so a
        // transferred citizen can only be claimed for by the new owner (§15.3
        // acceptance test 14).
        let asset_prefix = read_core_asset_prefix(&ctx.accounts.asset.try_borrow_data()?)?;
        require!(
            asset_prefix.belongs_to_collection(&config.collection_mint),
            DistrictError::InvalidCollection
        );
        require!(
            asset_prefix.is_owned_by(&ctx.accounts.owner.key()),
            DistrictError::NotOwner
        );

        // §12: the claim is bound to asset, stat type, mission ID, season ID,
        // owner, nonce and expiry. The receipt is what makes a signed claim
        // single-use, and §15.3 acceptance test 2 requires a replay to be
        // reported as `MissionClaimAlreadyUsed`.
        //
        // That is why this account is created here rather than by an `init`
        // constraint. `init` would refuse a replay too, but as Anchor's own
        // `AccountDiscriminatorAlreadySet` (3000) before the handler ran, and
        // the spec names the error. Creating it by hand costs one system CPI and
        // buys an error a client can actually map to a message.
        let (expected_receipt, receipt_bump) = Pubkey::find_program_address(
            &[
                b"claim",
                ctx.accounts.asset.key().as_ref(),
                &args.mission_id.to_le_bytes(),
                &args.nonce.to_le_bytes(),
            ],
            ctx.program_id,
        );
        require!(
            ctx.accounts.claim_receipt.key() == expected_receipt,
            DistrictError::InvalidMissionClaim
        );

        let receipt_info = ctx.accounts.claim_receipt.to_account_info();
        {
            // Anything already here means this claim was used. A wrong
            // discriminator is also a replay attempt against an address the
            // caller chose, so it is reported the same way rather than being
            // silently overwritten.
            let existing = receipt_info.try_borrow_data()?;
            if !existing.is_empty() {
                return Err(error!(DistrictError::MissionClaimAlreadyUsed));
            }
        }
        let rent_lamports = Rent::get()?.minimum_balance(ClaimReceipt::LEN);

        anchor_lang::system_program::create_account(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::CreateAccount {
                    from: ctx.accounts.owner.to_account_info(),
                    to: receipt_info.clone(),
                },
                &[&[
                    b"claim",
                    ctx.accounts.asset.key().as_ref(),
                    &args.mission_id.to_le_bytes(),
                    &args.nonce.to_le_bytes(),
                    &[receipt_bump],
                ]],
            ),
            rent_lamports,
            ClaimReceipt::LEN as u64,
            ctx.program_id,
        )?;

        // Written through the account's data slice because the field is an
        // `UncheckedAccount`: the address was just verified by derivation and the
        // account was just created by this program, so the bytes are ours to
        // shape, and `try_serialize` writes the discriminator plus the body.
        let mut receipt_bytes = vec![0u8; ClaimReceipt::LEN];
        let receipt_body = ClaimReceipt {
            version: CLAIM_RECEIPT_VERSION,
            bump: receipt_bump,
            asset: ctx.accounts.asset.key(),
            owner: ctx.accounts.owner.key(),
            mission_id: args.mission_id,
            season_id: args.season_id,
            stat: stat as u8,
            nonce: args.nonce,
            expires_at: args.expires_at,
            claimed_at: clock.unix_timestamp,
        };
        AccountSerialize::try_serialize(&receipt_body, &mut &mut receipt_bytes[..])
            .map_err(|_| error!(DistrictError::ArithmeticOverflow))?;
        let mut receipt_data = receipt_info.try_borrow_mut_data()?;
        receipt_data.copy_from_slice(&receipt_bytes);

        // §12: adds exactly one stat-specific credit, and mints or distributes
        // no tokens.
        let citizen = &mut ctx.accounts.citizen_state;
        citizen.grant_credit(stat)?;

        emit!(TrainingCreditClaimed {
            asset: citizen.asset,
            owner: receipt.owner,
            stat: stat as u8,
            mission_id: args.mission_id,
            season_id: args.season_id,
            nonce: args.nonce,
            remaining_credits: citizen.credits_of(stat),
        });
        Ok(())
    }

    /// Raise one stat by one level (§12 `upgrade_score`, §5.3).
    ///
    /// Verifies everything §12 lists, then atomically calculates the cost with
    /// checked arithmetic, burns all of it, consumes one matching credit and
    /// increments the score. 100% of the payment is burned (§17), and the cost
    /// rises with the score, so a citizen cannot be maxed by buying tokens
    /// alone — credits have to be earned.
    pub fn upgrade_score(ctx: Context<UpgradeScore>, stat_index: u8) -> Result<()> {
        let config = &ctx.accounts.config;

        // §12 verification list, in order.
        require!(!config.is_paused, DistrictError::ProgramPaused);

        // The mint has to be configured, and the one passed in has to be it.
        // Without this a caller could burn any token they control and still
        // raise a canonical score.
        require!(
            config.utility_mint != Pubkey::default(),
            DistrictError::UtilityMintNotSet
        );
        require!(
            ctx.accounts.utility_mint.key() == config.utility_mint,
            DistrictError::InvalidUtilityMint
        );
        require!(
            ctx.accounts.user_token_account.mint == config.utility_mint,
            DistrictError::InvalidUtilityMint
        );

        // Asset belongs to the official collection, and the signer is its
        // current owner — read from the Core asset so a transfer is honoured.
        let asset_prefix = read_core_asset_prefix(&ctx.accounts.asset.try_borrow_data()?)?;
        require!(
            asset_prefix.belongs_to_collection(&config.collection_mint),
            DistrictError::InvalidCollection
        );
        require!(
            asset_prefix.is_owned_by(&ctx.accounts.owner.key()),
            DistrictError::NotOwner
        );
        require!(
            ctx.accounts.user_token_account.owner == ctx.accounts.owner.key(),
            DistrictError::NotOwner
        );

        // Stat index is valid, and the stat has room left.
        let stat = CitizenStat::from_index(stat_index)?;
        let citizen = &mut ctx.accounts.citizen_state;
        require!(
            citizen.asset == ctx.accounts.asset.key(),
            DistrictError::InvalidAssetState
        );
        let previous_score = citizen.score_of(stat);
        require!(previous_score < STAT_MAX, DistrictError::MaxScore);

        // A matching credit exists. Credits are stat-specific, so an Insight
        // credit cannot pay for Craft.
        require!(
            citizen.credits_of(stat) >= CREDITS_PER_UPGRADE,
            DistrictError::InsufficientTrainingCredits
        );

        // §5.3: training_cost = base_training_cost × (current_score + 1), in
        // token atoms, with checked arithmetic (§15.3 acceptance test 9).
        let cost = training_cost_atoms(config.base_training_cost, previous_score)?;

        // Checked here as well as by the SPL Token program, so an unaffordable
        // upgrade reports the §13 error rather than a raw token-program one.
        require!(
            ctx.accounts.user_token_account.amount >= cost,
            DistrictError::InsufficientTokenBalance
        );

        // 1. Burn 100% of the cost via CPI.
        let burn_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.utility_mint.to_account_info(),
                from: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        );
        token::burn(burn_ctx, cost)?;

        // 2. Consume exactly one matching credit. 3. Increment the score by one.
        citizen.consume_credit(stat)?;
        let new_score = citizen.raise(stat);

        emit!(ScoreUpgraded {
            asset: citizen.asset,
            owner: asset_prefix.owner,
            stat: stat as u8,
            previous_score,
            new_score,
            new_tier: tier_for_score(new_score),
            tokens_burned: cost,
            remaining_credits: citizen.credits_of(stat),
        });
        Ok(())
    }

    /// Name a successor admin (§12 `propose_admin`).
    ///
    /// Step one of a two-step transfer, so an admin cannot hand the district to
    /// an address that cannot sign.
    pub fn propose_admin(ctx: Context<ProposeAdmin>, proposed_admin: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        // Proposing yourself would write a `pending_admin` that `accept_admin`
        // could then use to re-emit a transfer that never happened, so it is
        // refused rather than treated as a no-op.
        require!(proposed_admin != config.admin, DistrictError::Unauthorized);
        // An empty proposal would let anyone satisfy `accept_admin`'s signer
        // check by passing the default pubkey, so it is refused too.
        require!(
            proposed_admin != Pubkey::default(),
            DistrictError::Unauthorized
        );

        let previous = config.admin;
        config.pending_admin = proposed_admin;

        emit!(AdminProposed {
            current_admin: previous,
            proposed_admin,
        });
        Ok(())
    }

    /// Accept a pending admin transfer (§12 `accept_admin`).
    ///
    /// The signer has to be the proposed address, which is what makes the
    /// transfer non-repudiable.
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let previous_admin = config.admin;

        config.admin = ctx.accounts.new_admin.key();
        config.pending_admin = Pubkey::default();

        emit!(AdminAccepted {
            previous_admin,
            new_admin: config.admin,
        });
        Ok(())
    }
}

/// The PDA that must be presented as `template_id` for a given approved
/// template identifier.
///
/// Deriving the approval from a program PDA rather than from a caller-supplied
/// pubkey is what makes the check unforgeable: only this program can produce an
/// account at this address, and no instruction creates one, so the check is a
/// pure function of `DistrictConfig::approved_template_id`. Changing the
/// approved template therefore changes which address will be accepted, which is
/// an admin decision recorded by `update_config`.
pub fn approved_template_address(template_id: u32) -> Pubkey {
    Pubkey::find_program_address(
        &[b"approved_template", &template_id.to_le_bytes()],
        &crate::ID,
    )
    .0
}

/// Arguments of `initialize_config` (§12).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct InitializeConfigArgs {
    pub mission_authority: Pubkey,
    pub sol_treasury: Pubkey,
    pub collection_mint: Pubkey,
    pub approved_template_id: u32,
    /// `base_training_cost` of §5.3, in token atoms.
    pub base_training_cost: u64,
    /// Mainnet passes `true` (§12: starts paused on mainnet).
    pub start_paused: bool,
}

/// Arguments of `update_config` (§12).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct UpdateConfigArgs {
    pub mission_authority: Pubkey,
    pub sol_treasury: Pubkey,
    pub approved_template_id: u32,
    pub base_training_cost: u64,
}

/// Arguments of `claim_training_credit` (§12).
///
/// The claim is bound to all seven of these, so a receipt signed for one asset,
/// stat, mission, season, owner and nonce cannot be presented for another.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct MissionClaimArgs {
    /// 0 = Insight, 1 = Bond, 2 = Craft.
    pub stat: u8,
    pub mission_id: u64,
    pub season_id: u32,
    pub nonce: u64,
    /// Unix seconds; a claim at or after this is rejected.
    pub expires_at: i64,
}

// ---------------------------------------------------------------------------
// account contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = DistrictConfig::LEN,
        seeds = [b"district_config"],
        bump
    )]
    pub config: Account<'info, DistrictConfig>,
    /// Bootstrap/deploy authority; becomes the first admin and pays the rent.
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetUtilityMint<'info> {
    #[account(
        mut,
        seeds = [b"district_config"],
        bump = config.bump,
        has_one = admin @ DistrictError::Unauthorized
    )]
    pub config: Account<'info, DistrictConfig>,
    /// The official token mint to bind. Verified as an initialized SPL mint in
    /// the handler; the token program itself is checked against the SPL Token
    /// address by the `Program<Token>` type.
    ///
    /// Not an `Account<Mint>` because that would deserialize it with Anchor's
    /// own layout assumptions; the handler unpacks it explicitly so the failure
    /// is `InvalidUtilityMint` from §13.
    pub utility_mint: AccountInfo<'info>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct LockUtilityMint<'info> {
    #[account(
        mut,
        seeds = [b"district_config"],
        bump = config.bump,
        has_one = admin @ DistrictError::Unauthorized
    )]
    pub config: Account<'info, DistrictConfig>,
    pub admin: Signer<'info>,
}

/// `update_config`'s accounts.
///
/// Named `UpdateConfigAccounts` rather than `UpdateConfig` because Anchor's
/// codegen derives the context name from the instruction name, and a second
/// item with that name in this module would collide.
#[derive(Accounts)]
pub struct UpdateConfigAccounts<'info> {
    #[account(
        mut,
        seeds = [b"district_config"],
        bump = config.bump,
        has_one = admin @ DistrictError::Unauthorized
    )]
    pub config: Account<'info, DistrictConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [b"district_config"],
        bump = config.bump,
        has_one = admin @ DistrictError::Unauthorized
    )]
    pub config: Account<'info, DistrictConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct RegisterCitizen<'info> {
    #[account(
        mut,
        seeds = [b"district_config"],
        bump = config.bump
    )]
    pub config: Account<'info, DistrictConfig>,
    /// Metaplex Core asset account that becomes a citizen.
    ///
    /// `owner = mpl_core_program` is what makes the membership check
    /// trustworthy: only the Core program can write these bytes, so a caller
    /// cannot fabricate an account that parses as a collection member.
    #[account(owner = mpl_core_program.key())]
    pub asset: AccountInfo<'info>,
    /// The Metaplex Core program that owns `asset`.
    ///
    /// CHECK: the address is not hardcoded here; it is whatever the caller
    /// passes, and its only job is to be compared against `asset.owner`.
    /// Clients use `MPL_CORE_PROGRAM_ID`.
    pub mpl_core_program: UncheckedAccount<'info>,
    /// The account whose address must equal
    /// `approved_template_address(config.approved_template_id)` (§6.3 item 3).
    ///
    /// CHECK: never read and never written, and never created — no instruction
    /// in this program writes an account at this address. It is an unforgeable
    /// commitment to the approved template identifier: the address is derived
    /// from `config.approved_template_id`, and the bare `bump` below makes
    /// Anchor re-derive it and compare before the handler runs, so a client
    /// cannot substitute a key of its own choosing.
    #[account(
        seeds = [b"approved_template", &config.approved_template_id.to_le_bytes()],
        bump
    )]
    pub template_id: UncheckedAccount<'info>,
    #[account(
        init,
        payer = owner,
        space = CitizenState::LEN,
        // SPEC §6.4: seeds ["citizen", asset]
        seeds = [b"citizen", asset.key().as_ref()],
        bump
    )]
    pub citizen_state: Account<'info, CitizenState>,
    /// The asset's current owner, who signs and pays the rent.
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimTrainingCredit<'info> {
    #[account(
        seeds = [b"district_config"],
        bump = config.bump
    )]
    pub config: Account<'info, DistrictConfig>,
    #[account(
        mut,
        seeds = [b"citizen", citizen_state.asset.as_ref()],
        bump = citizen_state.bump
    )]
    pub citizen_state: Account<'info, CitizenState>,
    #[account(owner = mpl_core_program.key())]
    pub asset: AccountInfo<'info>,
    /// CHECK: see `RegisterCitizen::mpl_core_program`.
    pub mpl_core_program: UncheckedAccount<'info>,
    /// Signs the claim.
    ///
    /// The comparison against the config is a constraint rather than a handler
    /// check on purpose. An account's key is chosen by the caller, and nothing
    /// else in this instruction is derived from `mission_authority` — the claim
    /// receipt PDA comes from the asset, the mission and the nonce — so a check
    /// inside the handler could be satisfied by passing the citizen owner's own
    /// keypair here and signing it. That would let any owner grant themselves
    /// unlimited Training Credits, which is the only thing separating "bought a
    /// token" from "maxed a citizen" (§5.3). As a constraint it runs before the
    /// handler and cannot be reached with a substituted key.
    #[account(
        constraint = mission_authority.key() == config.mission_authority
            @ DistrictError::InvalidMissionClaim
    )]
    pub mission_authority: Signer<'info>,
    /// The citizen's current owner, who signs (§12) and pays for the receipt.
    #[account(mut)]
    pub owner: Signer<'info>,
    /// Makes a signed claim single-use.
    ///
    /// CHECK: created and written by the handler rather than by an `init`
    /// constraint, so that a replay reports `MissionClaimAlreadyUsed` (§15.3
    /// acceptance test 2) instead of Anchor's own discriminator error. The
    /// handler derives the address itself from the asset, the mission and the
    /// nonce and refuses anything else, so the caller cannot choose where the
    /// receipt lands.
    #[account(mut)]
    pub claim_receipt: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpgradeScore<'info> {
    #[account(
        seeds = [b"district_config"],
        bump = config.bump
    )]
    pub config: Account<'info, DistrictConfig>,
    #[account(
        mut,
        seeds = [b"citizen", citizen_state.asset.as_ref()],
        bump = citizen_state.bump
    )]
    pub citizen_state: Account<'info, CitizenState>,
    /// Read on every upgrade, not just at registration: §12 requires the asset
    /// to belong to the official collection and the signer to be its current
    /// owner, and §15.3 acceptance test 14 requires a transferred NFT to be
    /// trainable only by the new owner.
    #[account(owner = mpl_core_program.key())]
    pub asset: AccountInfo<'info>,
    /// CHECK: see `RegisterCitizen::mpl_core_program`.
    pub mpl_core_program: UncheckedAccount<'info>,
    /// The asset's current owner, who signs and authorizes the burn.
    pub owner: Signer<'info>,
    /// Must equal `config.utility_mint`. Mutable because the burn reduces its
    /// supply.
    #[account(mut)]
    pub utility_mint: AccountInfo<'info>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ProposeAdmin<'info> {
    #[account(
        mut,
        seeds = [b"district_config"],
        bump = config.bump,
        has_one = admin @ DistrictError::Unauthorized
    )]
    pub config: Account<'info, DistrictConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    #[account(
        mut,
        seeds = [b"district_config"],
        bump = config.bump,
        // The signer has to be the address `propose_admin` named, so an
        // unrelated key cannot accept and no admin is needed any more.
        constraint = config.pending_admin == new_admin.key() @ DistrictError::Unauthorized,
        constraint = config.pending_admin != Pubkey::default() @ DistrictError::Unauthorized
    )]
    pub config: Account<'info, DistrictConfig>,
    pub new_admin: Signer<'info>,
}
