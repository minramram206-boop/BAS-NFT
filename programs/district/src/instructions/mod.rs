//! One module per instruction: the accounts it takes and its handler.

pub mod accept_admin;
pub mod claim_training_credit;
pub mod initialize_config;
pub mod lock_utility_mint;
pub mod propose_admin;
pub mod register_citizen;
pub mod set_paused;
pub mod set_utility_mint;
pub mod update_config;
pub mod upgrade_score;

pub use accept_admin::*;
pub use claim_training_credit::*;
pub use initialize_config::*;
pub use lock_utility_mint::*;
pub use propose_admin::*;
pub use register_citizen::*;
pub use set_paused::*;
pub use set_utility_mint::*;
pub use update_config::*;
pub use upgrade_score::*;
