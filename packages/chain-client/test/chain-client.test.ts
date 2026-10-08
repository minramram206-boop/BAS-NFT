import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { DEVNET_CONFIG, MAINNET_CONFIG, findRepoRoot } from '@bas/config';
import { MAX_STAT_SCORE } from '@bas/content';
import {
  CORE_ASSET_LAYOUT,
  DistrictChainClient,
  DistrictClientError,
  MPL_CORE_PROGRAM_ID,
  PROGRAM_SEEDS,
  STAT_MAX,
  STAT_TYPES,
  clampStatScore,
  isStatType,
} from '../dist/index.js';

describe('@bas/chain-client', () => {
  it('defaults to the devnet cluster', () => {
    const client = new DistrictChainClient();
    assert.equal(client.network, 'devnet');
    assert.equal(client.rpcEndpoint, DEVNET_CONFIG.rpcUrl);
    assert.equal(client.programId, DEVNET_CONFIG.programId);
    assert.equal(client.collectionMint, DEVNET_CONFIG.collectionMint);
    assert.equal(client.candyMachine, DEVNET_CONFIG.candyMachine);
    assert.equal(client.utilityTokenMint, DEVNET_CONFIG.utilityTokenMint);
    assert.equal(client.treasuryAddress, DEVNET_CONFIG.treasuryAddress);
    assert.equal(client.tokenBurnRequired, DEVNET_CONFIG.tokenBurnRequired);
  });

  it('can be pinned to mainnet and asserts the active cluster', () => {
    const client = new DistrictChainClient('mainnet-beta');
    assert.equal(client.programId, MAINNET_CONFIG.programId);
    assert.equal(client.utilityTokenMint, MAINNET_CONFIG.utilityTokenMint);

    client.assertNetwork('mainnet-beta');
    assert.throws(() => client.assertNetwork('devnet'), DistrictClientError);
  });

  it('keeps the stat model in parity with the content package', () => {
    assert.equal(STAT_MAX, MAX_STAT_SCORE);
    assert.deepEqual([...STAT_TYPES], ['intelligence', 'alignment', 'composure']);
  });

  it('mirrors the PDA seeds used by the Anchor program', () => {
    assert.equal(PROGRAM_SEEDS.districtConfig, 'district_config');
    assert.equal(PROGRAM_SEEDS.citizenState, 'citizen_state');
  });

  it('mirrors the Metaplex Core address and asset layout used by the program', () => {
    const rust = readFileSync(join(findRepoRoot(), 'programs/district/src/mpl_core.rs'), 'utf8');

    const programId = /pub const MPL_CORE_PROGRAM_ID: Pubkey = pubkey!\("([^"]+)"\)/.exec(rust);
    assert.ok(programId, 'mpl_core.rs must declare MPL_CORE_PROGRAM_ID');
    assert.equal(MPL_CORE_PROGRAM_ID, programId[1]);

    function rustConst(name: string): number {
      const match = new RegExp(`pub const ${name}: (?:u8|usize) = (\\d+)`).exec(rust);
      assert.ok(match, `mpl_core.rs must declare ${name}`);
      return Number(match[1]);
    }

    assert.equal(CORE_ASSET_LAYOUT.keyAssetV1, rustConst('KEY_ASSET_V1'));
    assert.equal(CORE_ASSET_LAYOUT.updateAuthorityCollection, rustConst('UPDATE_AUTHORITY_COLLECTION'));
    assert.equal(CORE_ASSET_LAYOUT.ownerOffset, rustConst('OWNER_OFFSET'));
    assert.equal(CORE_ASSET_LAYOUT.updateAuthorityTagOffset, rustConst('UPDATE_AUTHORITY_TAG_OFFSET'));
    assert.equal(CORE_ASSET_LAYOUT.collectionOffset, rustConst('COLLECTION_OFFSET'));

    // MIN_ASSET_PREFIX_LEN is derived in Rust (`COLLECTION_OFFSET + 32`), so it
    // is checked against the offset rather than against a literal.
    const minLength = /pub const MIN_ASSET_PREFIX_LEN: usize = COLLECTION_OFFSET \+ (\d+)/.exec(rust);
    assert.ok(minLength, 'mpl_core.rs must derive MIN_ASSET_PREFIX_LEN from COLLECTION_OFFSET');
    assert.equal(CORE_ASSET_LAYOUT.minPrefixLength, CORE_ASSET_LAYOUT.collectionOffset + Number(minLength[1]));
    assert.equal(CORE_ASSET_LAYOUT.minPrefixLength, CORE_ASSET_LAYOUT.updateAuthorityTagOffset + 33);
  });

  it('guards stat values', () => {
    assert.ok(isStatType('alignment'));
    assert.ok(!isStatType('charisma'));
    assert.ok(!isStatType(undefined));

    assert.equal(clampStatScore(5), 5);
    assert.equal(clampStatScore(STAT_MAX + 10), STAT_MAX);
    assert.equal(clampStatScore(-3), 0);
    assert.equal(clampStatScore(7.9), 7);
    assert.equal(clampStatScore(Number.NaN), 0);
  });
});
