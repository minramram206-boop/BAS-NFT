import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { findRepoRoot } from '@bas/config';
import * as client from '@bas/chain-client';
import { CORE_ASSET_LAYOUT } from '@bas/chain-client';
import { address } from '@solana/kit';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  CITIZEN_STATE_LAYOUT,
  buildClaimTransaction,
  citizenAddress,
  claimReceiptAddress,
  configAddress,
  encodeClaimArgs,
  instructionDiscriminator,
  parseCitizenState,
  parseCoreAssetOwner,
  STAT_INDEX,
} from '../dist/index.js';
import { PROGRAM_ID } from './fixtures.ts';

const root = findRepoRoot();
const program = (file: string): string => readFileSync(join(root, 'programs/district/src', file), 'utf8');

describe('account layouts', () => {
  it('reads a citizen state written the way the program lays it out', () => {
    const asset = Keypair.generate().publicKey;
    const data = Buffer.alloc(CITIZEN_STATE_LAYOUT.length);
    data.writeUInt8(1, 8);
    data.writeUInt32LE(42, CITIZEN_STATE_LAYOUT.citizenIdOffset);
    asset.toBuffer().copy(data, CITIZEN_STATE_LAYOUT.assetOffset);
    data.writeUInt8(3, CITIZEN_STATE_LAYOUT.roleOffset);
    data.writeUInt8(4, CITIZEN_STATE_LAYOUT.intelligenceOffset);
    data.writeUInt8(5, CITIZEN_STATE_LAYOUT.alignmentOffset);
    data.writeUInt8(6, CITIZEN_STATE_LAYOUT.computeOffset);
    assert.deepEqual(parseCitizenState(data, asset), {
      citizenId: 42,
      role: 3,
      scores: { intelligence: 4, alignment: 5, compute: 6 },
    });
  });

  it('refuses a citizen state of another asset, a short one and an unknown role', () => {
    const asset = Keypair.generate().publicKey;
    const data = Buffer.alloc(CITIZEN_STATE_LAYOUT.length);
    asset.toBuffer().copy(data, CITIZEN_STATE_LAYOUT.assetOffset);
    assert.equal(parseCitizenState(data, Keypair.generate().publicKey), undefined);
    assert.equal(parseCitizenState(data.subarray(0, 20), asset), undefined);
    data.writeUInt8(200, CITIZEN_STATE_LAYOUT.roleOffset);
    assert.equal(parseCitizenState(data, asset), undefined);
  });

  it('matches the field list of CitizenState in the program', () => {
    const source = program('state/citizen.rs');
    const fields = [...source.matchAll(/^\s{4}pub (\w+): (\w+),$/gm)].map((match) => `${match[1]}:${match[2]}`);
    const struct = source.slice(source.indexOf('pub struct CitizenState'), source.indexOf('impl CitizenState'));
    const declared = [...struct.matchAll(/pub (\w+): (\w+),/g)].map((match) => `${match[1]}:${match[2]}`);
    assert.ok(fields.length > 0);
    assert.deepEqual(declared, [
      'version:u8',
      'bump:u8',
      'citizen_id:u32',
      'asset:Pubkey',
      'role:u8',
      'intelligence:u8',
      'alignment:u8',
      'compute:u8',
      'insight_training_credits:u16',
      'bond_training_credits:u16',
      'craft_training_credits:u16',
    ]);
  });

  it('reads the owner of a Core asset in the collection and nothing else', () => {
    const collection = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const data = Buffer.alloc(CORE_ASSET_LAYOUT.minPrefixLength + 8);
    data.writeUInt8(CORE_ASSET_LAYOUT.keyAssetV1, 0);
    owner.toBuffer().copy(data, CORE_ASSET_LAYOUT.ownerOffset);
    data.writeUInt8(CORE_ASSET_LAYOUT.updateAuthorityCollection, CORE_ASSET_LAYOUT.updateAuthorityTagOffset);
    collection.toBuffer().copy(data, CORE_ASSET_LAYOUT.collectionOffset);
    assert.equal(parseCoreAssetOwner(data, collection)?.toBase58(), owner.toBase58());
    assert.equal(parseCoreAssetOwner(data, Keypair.generate().publicKey), undefined);
    data.writeUInt8(2, 0);
    assert.equal(parseCoreAssetOwner(data, collection), undefined);
  });
});

describe('claim_training_credit transaction', () => {
  const asset = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const authority = Keypair.generate();
  const args = { stat: 'compute', missionChainId: 1, seasonId: 1, nonce: 1_007, expiresAt: 1_800_000_120 } as const;

  const transaction = buildClaimTransaction({
    programId: PROGRAM_ID,
    asset,
    owner,
    authority,
    args,
    blockhash: '11111111111111111111111111111111',
  });

  it('encodes the arguments in the order of MissionClaimArgs', () => {
    const source = program('instructions/claim_training_credit.rs');
    const body = source.slice(source.indexOf('pub struct MissionClaimArgs'), source.indexOf('#[derive(Accounts)]'));
    const declared = [...body.matchAll(/pub (\w+): (\w+),/g)].map((match) => `${match[1]}:${match[2]}`);
    assert.deepEqual(declared, ['stat:u8', 'mission_id:u64', 'season_id:u32', 'nonce:u64', 'expires_at:i64']);

    const bytes = encodeClaimArgs(args);
    assert.equal(bytes.length, 1 + 8 + 4 + 8 + 8);
    assert.equal(bytes.readUInt8(0), 2);
    assert.equal(bytes.readBigUInt64LE(1), 1n);
    assert.equal(bytes.readUInt32LE(9), 1);
    assert.equal(bytes.readBigUInt64LE(13), 1_007n);
    assert.equal(bytes.readBigInt64LE(21), 1_800_000_120n);
  });

  it('starts with the Anchor discriminator of the instruction', () => {
    const expected = createHash('sha256').update('global:claim_training_credit').digest().subarray(0, 8);
    assert.deepEqual(instructionDiscriminator('claim_training_credit'), expected);
    assert.deepEqual(transaction.instructions[0]!.data.subarray(0, 8), expected);
  });

  it('lists the accounts in the order of the Accounts struct', () => {
    const keys = transaction.instructions[0]!.keys;
    assert.deepEqual(
      keys.map((key) => key.pubkey.toBase58()),
      [
        configAddress(PROGRAM_ID).toBase58(),
        asset.toBase58(),
        citizenAddress(PROGRAM_ID, asset).toBase58(),
        authority.publicKey.toBase58(),
        owner.toBase58(),
        claimReceiptAddress(PROGRAM_ID, asset, 1, 1_007).toBase58(),
        '11111111111111111111111111111111',
      ],
    );
    assert.deepEqual(
      keys.map((key) => [key.isSigner, key.isWritable]),
      [
        [false, false],
        [false, false],
        [false, true],
        [true, false],
        [true, true],
        [false, true],
        [false, false],
      ],
    );
  });

  it('is signed by the authority and waits for the owner', () => {
    const wire = Transaction.from(transaction.serialize({ requireAllSignatures: false }));
    const message = wire.compileMessage().serialize();
    const signature = wire.signatures.find((entry) => entry.publicKey.equals(authority.publicKey))?.signature;
    assert.ok(signature);
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), authority.publicKey.toBuffer()]),
      format: 'der',
      type: 'spki',
    });
    assert.equal(verify(null, message, key, signature), true);
    assert.equal(wire.signatures.find((entry) => entry.publicKey.equals(owner))?.signature, null);
    assert.equal(wire.feePayer?.toBase58(), owner.toBase58());
  });

  it('derives the receipt from asset, mission and nonce', () => {
    const a = claimReceiptAddress(PROGRAM_ID, asset, 1, 1_007);
    assert.notEqual(a.toBase58(), claimReceiptAddress(PROGRAM_ID, asset, 2, 1_007).toBase58());
    assert.notEqual(a.toBase58(), claimReceiptAddress(PROGRAM_ID, asset, 1, 1_008).toBase58());
    const seeds = [Buffer.from('claim'), asset.toBuffer(), Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]), Buffer.from([0xef, 0x03, 0, 0, 0, 0, 0, 0])];
    assert.equal(PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0].toBase58(), a.toBase58());
  });
});

describe('agreement with @bas/chain-client', () => {
  it('derives the same addresses as the kit-based builders the web app uses', async () => {
    const asset = Keypair.generate().publicKey;
    const program = address(PROGRAM_ID.toBase58());
    const key = address(asset.toBase58());
    assert.equal(configAddress(PROGRAM_ID).toBase58(), await client.configAddress(program));
    assert.equal(citizenAddress(PROGRAM_ID, asset).toBase58(), await client.citizenStateAddress(program, key));
    assert.equal(
      claimReceiptAddress(PROGRAM_ID, asset, 4, 1_012).toBase58(),
      await client.claimReceiptAddress(program, key, 4, 1_012),
    );
  });

  it('reads the same CitizenState bytes the web decoder reads', () => {
    const own = CITIZEN_STATE_LAYOUT;
    const web = client.CITIZEN_STATE_LAYOUT;
    assert.equal(own.length, web.length);
    assert.equal(own.citizenIdOffset, web.citizenIdOffset);
    assert.equal(own.assetOffset, web.assetOffset);
    assert.equal(own.roleOffset, web.roleOffset);
    assert.equal(own.intelligenceOffset, web.intelligenceOffset);
    assert.equal(own.alignmentOffset, web.alignmentOffset);
    assert.equal(own.computeOffset, web.computeOffset);

    const asset = Keypair.generate().publicKey;
    const data = new Uint8Array(web.length);
    data.set(client.CITIZEN_STATE_DISCRIMINATOR, 0);
    data.set(asset.toBytes(), web.assetOffset);
    data[web.roleOffset] = 3;
    data[web.intelligenceOffset] = 4;
    data[web.alignmentOffset] = 5;
    data[web.computeOffset] = 6;
    const server = parseCitizenState(data, asset);
    const decoded = client.decodeCitizenState(data);
    assert.deepEqual(server?.scores, {
      intelligence: decoded?.intelligence,
      alignment: decoded?.alignment,
      compute: decoded?.compute,
    });
    assert.equal(server?.role, decoded?.role);
  });

  it('uses the same claim discriminator and stat indexes', () => {
    assert.deepEqual([...instructionDiscriminator('claim_training_credit')], [...client.INSTRUCTION_DISCRIMINATORS.claimTrainingCredit]);
    assert.equal(STAT_INDEX.intelligence, client.STAT_INDEX.intelligence);
    assert.equal(STAT_INDEX.alignment, client.STAT_INDEX.alignment);
    assert.equal(STAT_INDEX.compute, client.STAT_INDEX.compute);
  });
});
