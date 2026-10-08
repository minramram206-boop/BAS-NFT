import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { DEVNET_CONFIG, MAINNET_CONFIG, findRepoRoot } from '@bas/config';
import { MAX_STAT_SCORE, ROLE_KEYS } from '@bas/content';
import {
  CREDITS_PER_UPGRADE,
  CORE_ASSET_LAYOUT,
  DISTRICT_CONFIG_VERSION,
  DistrictChainClient,
  DistrictClientError,
  MPL_CORE_PROGRAM_ID,
  PROGRAM_SEEDS,
  ROLE_COUNT,
  ROLE_TEMPLATES,
  STAT_LABELS,
  STAT_MAX,
  STAT_TYPES,
  TIER_1_SCORE,
  TIER_2_SCORE,
  TIER_3_SCORE,
  canUpgrade,
  canUpgradeWithCredit,
  clampStatScore,
  creditFieldOf,
  formatTokenAtoms,
  isStatType,
  roleTemplate,
  tierOf,
  trainingCostAtoms,
} from '../dist/index.js';
import type { CitizenStateOnChain } from '../dist/index.js';

const repoRoot = findRepoRoot();
const source = (relative: string) => readFileSync(join(repoRoot, relative), 'utf8');

function rustConst(file: string, name: string): string {
  const rust = source(file);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`pub const ${escaped}: [^=]+ = ([^;]+);`).exec(rust);
  assert.ok(match, `${file} must declare ${name}`);
  return (match[1] as string).trim();
}

function rustRoleRegistry(): Array<{
  index: number;
  key: string;
  label: string;
  intelligence: number;
  alignment: number;
  compute: number;
}> {
  const rust = source('programs/district/src/roles.rs');
  const registry = /pub const ROLE_TEMPLATES:[\s\S]*?= \[[\s\S]*?\n\];/.exec(rust);
  assert.ok(registry, 'roles.rs must declare ROLE_TEMPLATES');
  const entries = [...(registry[0] as string).matchAll(
    /RoleTemplate\s*\{\s*index:\s*(\d+),\s*code_name:\s*"([^"]+)",\s*public_label:\s*"([^"]+)",\s*initial_intelligence:\s*(\d+),\s*initial_alignment:\s*(\d+),\s*initial_compute:\s*(\d+),\s*\}/g,
  )];
  assert.ok(entries.length > 0, 'the Rust role registry must contain entries');
  return entries.map(([, index, key, label, intelligence, alignment, compute]) => ({
    index: Number(index),
    key: key as string,
    label: label as string,
    intelligence: Number(intelligence),
    alignment: Number(alignment),
    compute: Number(compute),
  }));
}

describe('@bas/chain-client network contract', () => {
  it('defaults to the devnet cluster and reads the canonical manifest', () => {
    const client = new DistrictChainClient();
    assert.equal(client.network, 'devnet');
    assert.equal(client.rpcEndpoint, DEVNET_CONFIG.rpcUrl);
    assert.equal(client.programId, DEVNET_CONFIG.districtProgramId);
    assert.equal(client.collectionMint, DEVNET_CONFIG.coreCollection);
    assert.equal(client.candyMachine, DEVNET_CONFIG.candyMachine);
    assert.equal(client.candyGuard, DEVNET_CONFIG.candyGuard);
    assert.equal(client.utilityTokenMint, DEVNET_CONFIG.utilityTokenMint);
    assert.equal(client.treasuryAddress, DEVNET_CONFIG.solTreasury);
    assert.equal(client.royaltyRecipient, DEVNET_CONFIG.royaltyRecipient);
    assert.equal(client.missionAuthority, DEVNET_CONFIG.missionAuthority);
    assert.equal(client.maxScore, DEVNET_CONFIG.maxScore);
    assert.equal(client.baseTrainingCostAtoms, 100_000_000n);
    assert.equal(client.burnBps, 10_000);
    assert.equal(client.dailyMessageLimit, 20);
    assert.equal(client.tokenDecimals, 6);
    assert.equal(client.approvedTemplateId, DEVNET_CONFIG.approvedTemplateId);
    assert.equal(client.approvedTemplateUriPrefix, DEVNET_CONFIG.approvedTemplateUriPrefix);
  });

  it('can be pinned to mainnet and asserts the active cluster', () => {
    const client = new DistrictChainClient('mainnet-beta');
    assert.equal(client.programId, MAINNET_CONFIG.districtProgramId);
    assert.equal(client.utilityTokenMint, MAINNET_CONFIG.utilityTokenMint);
    assert.equal(client.network, 'mainnet-beta');

    client.assertNetwork('mainnet-beta');
    assert.throws(() => client.assertNetwork('devnet'), DistrictClientError);
  });

  it('mirrors the deployed program address in declare_id! and Anchor.toml', () => {
    const rust = source('programs/district/src/lib.rs');
    const declared = /declare_id!\("([^"]+)"\)/.exec(rust);
    assert.ok(declared, 'lib.rs must declare the program id');
    assert.equal(declared[1], DEVNET_CONFIG.districtProgramId);
    assert.equal(DEVNET_CONFIG.districtProgramId, MAINNET_CONFIG.districtProgramId);
  });
});

describe('@bas/chain-client protocol parity', () => {
  it('keeps the maximum score and tiers in parity with Rust and content', () => {
    const state = source('programs/district/src/state.rs');
    assert.equal(STAT_MAX, MAX_STAT_SCORE);
    assert.equal(STAT_MAX, DEVNET_CONFIG.maxScore);
    assert.equal(STAT_MAX, 10, 'SPEC v2 §7: Maximum score: 10');
    assert.equal(TIER_1_SCORE, 3);
    assert.equal(TIER_2_SCORE, 6);
    assert.equal(TIER_3_SCORE, 10);
    assert.equal(TIER_3_SCORE, STAT_MAX);
    assert.match(state, /pub const STAT_MAX: u8 = 10;/);
    assert.match(state, /pub const TIER_1_SCORE: u8 = 3;/);
    assert.match(state, /pub const TIER_2_SCORE: u8 = 6;/);
    assert.match(state, /pub const TIER_3_SCORE: u8 = STAT_MAX;/);
  });

  it('keeps the internal stat names and public English labels separate', () => {
    assert.deepEqual([...STAT_TYPES], ['intelligence', 'alignment', 'compute']);
    assert.deepEqual(STAT_LABELS, {
      intelligence: 'Insight',
      alignment: 'Bond',
      compute: 'Craft',
    });
    assert.ok(isStatType('compute'));
    assert.ok(!isStatType('composure'));
    assert.ok(!isStatType('charisma'));
    assert.ok(!isStatType(undefined));

    const state = source('programs/district/src/state.rs');
    assert.match(state, /Compute = 2/);
    assert.doesNotMatch(state, /Composure/);
  });

  it('mirrors the Phase A seven-role registry in content and Rust', () => {
    const rustRoles = rustRoleRegistry();
    assert.equal(ROLE_COUNT, 7);
    assert.equal(ROLE_TEMPLATES.length, ROLE_COUNT);
    assert.equal(ROLE_KEYS.length, ROLE_COUNT);
    assert.deepEqual(
      ROLE_TEMPLATES.map(({ index, key, label, intelligence, alignment, compute }) => ({
        index, key, label, intelligence, alignment, compute,
      })),
      rustRoles,
      'the client role table must match programs/district/src/roles.rs',
    );
    assert.deepEqual(ROLE_KEYS, rustRoles.map((role) => role.key));

    const rolesJson = JSON.parse(source('content/en/roles.json')) as Array<{
      index: number;
      key: string;
      label: string;
      initialStats: { intelligence: number; alignment: number; compute: number };
    }>;
    assert.deepEqual(
      rolesJson.map(({ index, key, label, initialStats }) => ({
        index,
        key,
        label,
        intelligence: initialStats.intelligence,
        alignment: initialStats.alignment,
        compute: initialStats.compute,
      })),
      rustRoles,
      'content/en/roles.json is canonical; Rust and TS registries are checked mirrors',
    );
    for (const role of ROLE_TEMPLATES) {
      assert.equal(roleTemplate(role.index)?.key, role.key);
      assert.equal(role.intelligence + role.alignment + role.compute, 3);
      assert.ok(Math.max(role.intelligence, role.alignment, role.compute) < TIER_1_SCORE);
    }
  });

  it('uses the exact CitizenState seeds and account fields from the spec', () => {
    const lib = source('programs/district/src/lib.rs');
    const state = source('programs/district/src/state.rs');
    assert.equal(PROGRAM_SEEDS.districtConfig, 'district_config');
    assert.equal(PROGRAM_SEEDS.citizen, 'citizen');
    assert.equal(PROGRAM_SEEDS.claim, 'claim');
    assert.match(lib, /seeds = \[b"citizen", asset\.key\(\)\.as_ref\(\)\]/);
    assert.match(lib, /seeds = \[b"citizen", citizen_state\.asset\.as_ref\(\)\]/);
    assert.match(lib, /b"claim",\s*ctx\.accounts\.asset\.key\(\)\.as_ref\(\),\s*&args\.mission_id\.to_le_bytes\(\),\s*&args\.nonce\.to_le_bytes\(\),/);
    const citizenState = state.match(/pub struct CitizenState\s*\{[\s\S]*?\n\}/)?.[0];
    assert.ok(citizenState, 'CitizenState declaration must exist');
    const citizenFields = [...citizenState.matchAll(/^\s*pub ([a-z_]+): ([^,]+),/gm)]
      .map((match) => `${match[1]}: ${match[2]}`);
    assert.deepEqual(citizenFields, [
      'version: u8',
      'bump: u8',
      'citizen_id: u32',
      'asset: Pubkey',
      'role: u8',
      'intelligence: u8',
      'alignment: u8',
      'compute: u8',
      'insight_training_credits: u16',
      'bond_training_credits: u16',
      'craft_training_credits: u16',
    ]);
    assert.doesNotMatch(citizenState, /pub composure:|pub owner: Pubkey/);
    assert.equal(DISTRICT_CONFIG_VERSION, Number(rustConst('programs/district/src/state.rs', 'DISTRICT_CONFIG_VERSION')));
  });

  it('requires an immutable approved-template PDA and verifies the Core asset URI', () => {
    const program = source('programs/district/src/lib.rs');
    const state = source('programs/district/src/state.rs');
    const coreReader = source('programs/district/src/mpl_core.rs');
    const prefix = DEVNET_CONFIG.approvedTemplateUriPrefix;

    assert.match(program, /pub approved_template: Account<'info, ApprovedTemplate>/);
    assert.match(
      program,
      /seeds = \[\s*b"approved_template"\.as_ref\(\),\s*config\.approved_template_id\.to_le_bytes\(\)\.as_ref\(\)\s*\]/,
    );
    assert.match(program, /ctx\.accounts\.approved_template\.approves_uri\(asset_uri\)/);
    assert.match(coreReader, /pub fn read_core_asset_uri\(data: &\[u8\]\) -> Result<&str>/);
    assert.match(state, /pub fn approves_uri\(&self, uri: &str\) -> bool/);
    assert.match(state, /uri\.strip_prefix\(&self\.uri_prefix\)/);
    assert.match(state, /filename\.ends_with\("\.json"\)/);
    assert.ok(prefix.endsWith(`/templates/${DEVNET_CONFIG.approvedTemplateId}/`));
    assert.equal(prefix, MAINNET_CONFIG.approvedTemplateUriPrefix);
  });

  it('keeps the marginal token-cost formula in parity with the Rust unit tests', () => {
    const rust = source('programs/district/src/state.rs');
    assert.equal(trainingCostAtoms('100000000', 0), 100_000_000n);
    assert.equal(trainingCostAtoms('100000000', 1), 200_000_000n);
    assert.equal(trainingCostAtoms('100000000', 8), 900_000_000n);
    assert.equal(trainingCostAtoms('100000000', 9), 1_000_000_000n);
    assert.equal(trainingCostAtoms('18446744073709551615', 10), 0n);
    assert.throws(() => trainingCostAtoms('0', 0), /must be positive/);
    assert.throws(() => trainingCostAtoms('not atoms', 0), /decimal integer/);
    assert.match(rust, /training_cost = base_training_cost × \(current_score \+ 1\)/);
    assert.equal(Number(rustConst('programs/district/src/state.rs', 'CREDITS_PER_UPGRADE')), 1);
    assert.equal(CREDITS_PER_UPGRADE, 1);
  });

  it('checks that both a stat-specific credit and score headroom are required', () => {
    const citizen: CitizenStateOnChain = {
      version: 1,
      bump: 254,
      citizenId: 3,
      asset: 'asset',
      role: 0,
      intelligence: 2,
      alignment: 1,
      compute: 3,
      insightTrainingCredits: 1,
      bondTrainingCredits: 0,
      craftTrainingCredits: 1,
    };
    assert.equal(creditFieldOf('intelligence'), 'insightTrainingCredits');
    assert.equal(creditFieldOf('alignment'), 'bondTrainingCredits');
    assert.equal(creditFieldOf('compute'), 'craftTrainingCredits');
    assert.ok(canUpgradeWithCredit(citizen, 'intelligence'));
    assert.ok(!canUpgradeWithCredit(citizen, 'alignment'));
    assert.ok(canUpgradeWithCredit(citizen, 'compute'));
    assert.ok(canUpgrade(9));
    assert.ok(!canUpgrade(10));
  });

  it('formats token atoms without rounding through Number', () => {
    assert.equal(formatTokenAtoms(200_000_000n, 6), '200');
    assert.equal(formatTokenAtoms(1_234_567n, 6), '1.234567');
    assert.equal(formatTokenAtoms(5n, 6), '0.000005');
    assert.equal(formatTokenAtoms(1_000n, 0), '1000');
    assert.throws(() => formatTokenAtoms(1n, -1), /decimals/);
  });

  it('mirrors the PDA seeds used by the Anchor program', () => {
    assert.deepEqual(PROGRAM_SEEDS, {
      districtConfig: 'district_config',
      citizen: 'citizen',
      claim: 'claim',
      approvedTemplate: 'approved_template',
    });
  });

  it('mirrors the Metaplex Core address and asset layout used by the program', () => {
    const rust = source('programs/district/src/mpl_core.rs');

    const programId = /pub const MPL_CORE_PROGRAM_ID: Pubkey = pubkey!\("([^"]+)"\)/.exec(rust);
    assert.ok(programId, 'mpl_core.rs must declare MPL_CORE_PROGRAM_ID');
    assert.equal(MPL_CORE_PROGRAM_ID, programId[1]);

    function rustNumber(name: string): number {
      const match = new RegExp(`pub const ${name}: (?:u8|usize) = (\\d+)`).exec(rust);
      assert.ok(match, `mpl_core.rs must declare ${name}`);
      return Number(match[1]);
    }

    assert.equal(CORE_ASSET_LAYOUT.keyAssetV1, rustNumber('KEY_ASSET_V1'));
    assert.equal(CORE_ASSET_LAYOUT.updateAuthorityCollection, rustNumber('UPDATE_AUTHORITY_COLLECTION'));
    assert.equal(CORE_ASSET_LAYOUT.ownerOffset, rustNumber('OWNER_OFFSET'));
    assert.equal(CORE_ASSET_LAYOUT.updateAuthorityTagOffset, rustNumber('UPDATE_AUTHORITY_TAG_OFFSET'));
    assert.equal(CORE_ASSET_LAYOUT.collectionOffset, rustNumber('COLLECTION_OFFSET'));
    const minLength = /pub const MIN_ASSET_PREFIX_LEN: usize = COLLECTION_OFFSET \+ (\d+)/.exec(rust);
    assert.ok(minLength, 'mpl_core.rs must derive MIN_ASSET_PREFIX_LEN from COLLECTION_OFFSET');
    assert.equal(CORE_ASSET_LAYOUT.minPrefixLength, CORE_ASSET_LAYOUT.collectionOffset + Number(minLength[1]));
  });

  it('guards raw scores and computes spec-defined tiers', () => {
    assert.equal(clampStatScore(5), 5);
    assert.equal(clampStatScore(STAT_MAX + 10), STAT_MAX);
    assert.equal(clampStatScore(-3), 0);
    assert.equal(clampStatScore(7.9), 7);
    assert.equal(clampStatScore(Number.NaN), 0);
    assert.deepEqual([0, 2, 3, 5, 6, 9, 10].map(tierOf), [0, 0, 1, 1, 2, 2, 3]);
  });
});
