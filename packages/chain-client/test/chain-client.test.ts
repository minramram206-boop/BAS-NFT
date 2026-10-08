import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEVNET_CONFIG, MAINNET_CONFIG } from '@bas/config';
import { MAX_STAT_SCORE } from '@bas/content';
import {
  DistrictChainClient,
  DistrictClientError,
  PROGRAM_SEEDS,
  STAT_MAX,
  STAT_TYPES,
  clampStatScore,
  isStatType,
} from '../src/index.ts';

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
