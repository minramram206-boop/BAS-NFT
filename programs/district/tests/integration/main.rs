//! Instruction tests for the district program, run inside
//! `solana-program-test` (D-0012). Account constraints, PDA derivation, the
//! clock and the CPIs into the system and token programs all really execute.
//!
//! `emit!` output is not visible in this harness, so every test asserts
//! committed account state instead. Event payloads and BPF compute limits
//! still need `anchor test` against a validator before deployment.
//!
//! Run with `pnpm program:test` or `cargo test --test integration`.

mod harness;

mod admin;
mod claim;
mod config;
mod parity;
mod pause;
mod register;
mod upgrade;
mod utility_mint;
