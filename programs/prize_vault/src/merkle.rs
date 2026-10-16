//! The winners tree.
//!
//! A leaf is `sha256(0x00 || season_id u32 LE || index u8 || winner || amount u64 LE)`.
//! A node is `sha256(0x01 || min(a, b) || max(a, b))`: the pair is sorted, so
//! a proof is just the list of sibling hashes from the leaf up. An odd hash
//! at the end of a level moves up unchanged. `packages/chain-client` builds
//! the same tree.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use crate::constants::{LEAF_PREFIX, NODE_PREFIX};

pub fn leaf(season_id: u32, index: u8, winner: &Pubkey, amount_lamports: u64) -> [u8; 32] {
    hashv(&[
        LEAF_PREFIX,
        &season_id.to_le_bytes(),
        &[index],
        winner.as_ref(),
        &amount_lamports.to_le_bytes(),
    ])
    .to_bytes()
}

pub fn node(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let (low, high) = if a <= b { (a, b) } else { (b, a) };
    hashv(&[NODE_PREFIX, low, high]).to_bytes()
}

pub fn verify(proof: &[[u8; 32]], root: &[u8; 32], leaf: [u8; 32]) -> bool {
    let computed = proof
        .iter()
        .fold(leaf, |hash, sibling| node(&hash, sibling));
    &computed == root
}

/// Root of a whole list of leaves. Only tests and tools use it; the program
/// only ever verifies.
pub fn root(leaves: &[[u8; 32]]) -> [u8; 32] {
    let mut level = leaves.to_vec();
    if level.is_empty() {
        return [0; 32];
    }
    while level.len() > 1 {
        level = level
            .chunks(2)
            .map(|pair| match pair {
                [a, b] => node(a, b),
                [a] => *a,
                _ => unreachable!(),
            })
            .collect();
    }
    level[0]
}

/// Proof of the leaf at `index`, from the leaf up.
pub fn proof(leaves: &[[u8; 32]], mut index: usize) -> Vec<[u8; 32]> {
    let mut level = leaves.to_vec();
    let mut out = Vec::new();
    while level.len() > 1 {
        let sibling = index ^ 1;
        if sibling < level.len() {
            out.push(level[sibling]);
        }
        level = level
            .chunks(2)
            .map(|pair| match pair {
                [a, b] => node(a, b),
                [a] => *a,
                _ => unreachable!(),
            })
            .collect();
        index /= 2;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaves(count: u8) -> Vec<[u8; 32]> {
        (0..count)
            .map(|i| {
                leaf(
                    1,
                    i,
                    &Pubkey::new_from_array([i + 1; 32]),
                    1_000 * (i as u64 + 1),
                )
            })
            .collect()
    }

    #[test]
    fn every_leaf_proves_against_the_root() {
        for count in 1..=35u8 {
            let all = leaves(count);
            let top = root(&all);
            for (index, item) in all.iter().enumerate() {
                assert!(
                    verify(&proof(&all, index), &top, *item),
                    "{count} leaves, index {index}"
                );
            }
        }
    }

    #[test]
    fn a_changed_amount_or_winner_does_not_prove() {
        let all = leaves(7);
        let top = root(&all);
        let path = proof(&all, 3);
        assert!(!verify(
            &path,
            &top,
            leaf(1, 3, &Pubkey::new_from_array([4; 32]), 4_001)
        ));
        assert!(!verify(
            &path,
            &top,
            leaf(1, 3, &Pubkey::new_from_array([9; 32]), 4_000)
        ));
        assert!(!verify(
            &path,
            &top,
            leaf(2, 3, &Pubkey::new_from_array([4; 32]), 4_000)
        ));
    }

    /// The same vector is checked in packages/chain-client/test/prize-vault.test.ts.
    #[test]
    fn matches_the_typescript_tree() {
        let all = leaves(5);
        let hex = |bytes: &[u8; 32]| bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
        assert_eq!(
            hex(&all[0]),
            "a4b1f098b33cd34af364dd93f1a6bb008bc4a8f7ebc281ccf79a927133ee3367"
        );
        assert_eq!(
            hex(&root(&all)),
            "dea079247b54a918d3c467dfc4f933f41107b5494fa9fbe0f247bab06b1b8d96"
        );
    }
}
