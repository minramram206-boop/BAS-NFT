import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { findRepoRoot } from '@bas/config';
import { AccountRole, address } from '@solana/kit';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  INSTRUCTION_DISCRIMINATORS,
  STAT_INDEX,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  approvedTemplateAddress,
  associatedTokenAddress,
  candyGuardAddress,
  citizenStateAddress,
  claimReceiptAddress,
  configAddress,
  mintCounterAddress,
  registerCitizenInstruction,
  upgradeScoreInstruction,
} from '../dist/index.js';

const program = (file: string): string => readFileSync(join(findRepoRoot(), 'programs/district/src', file), 'utf8');
const PROGRAM = address('82zccW1Z97ic24aCrt2c3U6qDUZMfbHufZMCjv2dm1Ym');
const OWNER = address('FLagggahkgNjgzjXKKsXECvPZdLXGtfmUgPuZYKnconk');
const ASSET = address('A6kLyjEaWi5pzdc46MnVd1WeKgFabjWVUREJw8f8rbhn');
const MINT = address('6yv2K6n1pczbSdWNZGfEvkQuS5rgHhq5RwKD64PQ7TcG');

const discriminator = (name: string) => [...createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)];

describe('instruction discriminators', () => {
  it('are the Anchor hashes of the instruction names', () => {
    assert.deepEqual([...INSTRUCTION_DISCRIMINATORS.upgradeScore], discriminator('upgrade_score'));
    assert.deepEqual([...INSTRUCTION_DISCRIMINATORS.claimTrainingCredit], discriminator('claim_training_credit'));
    assert.deepEqual([...INSTRUCTION_DISCRIMINATORS.registerCitizen], discriminator('register_citizen'));
  });

  it('name instructions the program really has', () => {
    const lib = program('lib.rs');
    for (const name of ['upgrade_score', 'claim_training_credit', 'register_citizen']) {
      assert.ok(lib.includes(`pub fn ${name}(`), name);
    }
  });
});

describe('upgrade_score', () => {
  it('lists the accounts of the Accounts struct, in order, with the same flags', async () => {
    const source = program('instructions/upgrade_score.rs');
    const body = source.slice(source.indexOf('pub struct UpgradeScore'), source.indexOf("impl<'info> UpgradeScore"));
    const names = [...body.matchAll(/pub (\w+): /g)].map((match) => match[1]);
    assert.deepEqual(names, ['config', 'asset', 'citizen_state', 'owner', 'utility_mint', 'user_token_account', 'token_program']);

    // A struct field is writable when its attribute block says `mut`.
    const blocks = body.split(/\n\n/);
    const writable = names.map((name) => {
      const block = blocks.find((entry) => entry.includes(`pub ${name}:`)) ?? '';
      return /#\[account\(\s*mut/.test(block);
    });
    const signer = names.map((name) => body.includes(`pub ${name}: Signer`));

    const instruction = await upgradeScoreInstruction({
      programId: PROGRAM,
      owner: OWNER,
      asset: ASSET,
      utilityMint: MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
      stat: 'compute',
    });
    assert.deepEqual(
      instruction.accounts?.map((account) => account.role === AccountRole.WRITABLE || account.role === AccountRole.WRITABLE_SIGNER),
      writable,
    );
    assert.deepEqual(
      instruction.accounts?.map((account) => account.role === AccountRole.READONLY_SIGNER || account.role === AccountRole.WRITABLE_SIGNER),
      signer,
    );
  });

  it('points at the derived accounts and encodes the stat', async () => {
    const instruction = await upgradeScoreInstruction({
      programId: PROGRAM,
      owner: OWNER,
      asset: ASSET,
      utilityMint: MINT,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      stat: 'alignment',
    });
    const keys = instruction.accounts?.map((account) => account.address);
    assert.deepEqual(keys, [
      await configAddress(PROGRAM),
      ASSET,
      await citizenStateAddress(PROGRAM, ASSET),
      OWNER,
      MINT,
      await associatedTokenAddress(OWNER, MINT, TOKEN_2022_PROGRAM_ID),
      TOKEN_2022_PROGRAM_ID,
    ]);
    assert.deepEqual([...(instruction.data ?? [])], [...INSTRUCTION_DISCRIMINATORS.upgradeScore, STAT_INDEX.alignment]);
    assert.equal(instruction.programAddress, PROGRAM);
  });

  it('uses the token program the mint lives under for the token account', async () => {
    assert.notEqual(
      await associatedTokenAddress(OWNER, MINT, TOKEN_PROGRAM_ID),
      await associatedTokenAddress(OWNER, MINT, TOKEN_2022_PROGRAM_ID),
    );
  });
});

describe('addresses', () => {
  it('derive the claim receipt from asset, mission and nonce', async () => {
    const a = await claimReceiptAddress(PROGRAM, ASSET, 1, 1_001);
    assert.notEqual(a, await claimReceiptAddress(PROGRAM, ASSET, 2, 1_001));
    assert.notEqual(a, await claimReceiptAddress(PROGRAM, ASSET, 1, 1_002));
    assert.equal(a, await claimReceiptAddress(PROGRAM, ASSET, 1n, 1_001n));
  });

  it('keep the associated token program id', () => {
    assert.equal(ASSOCIATED_TOKEN_PROGRAM_ID, 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  });
});

describe('register_citizen', () => {
  it('lists the accounts of the Accounts struct, in order, with the same flags', async () => {
    const source = program('instructions/register_citizen.rs');
    const body = source.slice(source.indexOf('pub struct RegisterCitizen'), source.indexOf("impl<'info> RegisterCitizen"));
    const names = [...body.matchAll(/pub (\w+): /g)].map((match) => match[1]);
    assert.deepEqual(names, ['config', 'asset', 'approved_template', 'citizen_state', 'owner', 'system_program']);

    // `init` creates the account, so it is writable like `mut`.
    const blocks = body.split(/\n\n/);
    const writable = names.map((name) => {
      const block = blocks.find((entry) => entry.includes(`pub ${name}:`)) ?? '';
      return /#\[account\(\s*(mut|init)/.test(block);
    });
    const signer = names.map((name) => body.includes(`pub ${name}: Signer`));

    const instruction = await registerCitizenInstruction({ programId: PROGRAM, owner: OWNER, asset: ASSET, approvedTemplateId: 7 });
    assert.deepEqual(
      instruction.accounts?.map((account) => account.role === AccountRole.WRITABLE || account.role === AccountRole.WRITABLE_SIGNER),
      writable,
    );
    assert.deepEqual(
      instruction.accounts?.map((account) => account.role === AccountRole.READONLY_SIGNER || account.role === AccountRole.WRITABLE_SIGNER),
      signer,
    );
  });

  it('points at the derived accounts and carries only the discriminator', async () => {
    const instruction = await registerCitizenInstruction({ programId: PROGRAM, owner: OWNER, asset: ASSET, approvedTemplateId: 7 });
    assert.deepEqual(
      instruction.accounts?.map((account) => account.address),
      [
        await configAddress(PROGRAM),
        ASSET,
        await approvedTemplateAddress(PROGRAM, 7),
        await citizenStateAddress(PROGRAM, ASSET),
        OWNER,
        '11111111111111111111111111111111',
      ],
    );
    assert.deepEqual([...(instruction.data ?? [])], [...INSTRUCTION_DISCRIMINATORS.registerCitizen]);
  });

  it('derives the template account from the template id', async () => {
    const a = await approvedTemplateAddress(PROGRAM, 7);
    assert.notEqual(a, await approvedTemplateAddress(PROGRAM, 8));
    assert.equal(a, await approvedTemplateAddress(PROGRAM, 7));
  });
});

describe('candy machine addresses', () => {
  const MACHINE = address('FLagggahkgNjgzjXKKsXECvPZdLXGtfmUgPuZYKnconk');

  it('derive the guard from the machine and the counter from id, wallet, guard and machine', async () => {
    const guard = await candyGuardAddress(MACHINE);
    assert.notEqual(guard, MACHINE);
    const counter = await mintCounterAddress({ id: 0, user: OWNER, candyMachine: MACHINE, candyGuard: guard });
    assert.notEqual(counter, await mintCounterAddress({ id: 1, user: OWNER, candyMachine: MACHINE, candyGuard: guard }));
    assert.notEqual(counter, await mintCounterAddress({ id: 0, user: ASSET, candyMachine: MACHINE, candyGuard: guard }));
  });
});
