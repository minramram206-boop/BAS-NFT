import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { findRepoRoot } from '@bas/config';
import { address, getAddressEncoder, type Address } from '@solana/kit';
import {
  CANDY_MACHINE_LAYOUT,
  CITIZEN_STATE_DISCRIMINATOR,
  CITIZEN_STATE_LAYOUT,
  decodeCandyMachine,
  decodeCitizenState,
  decodeCoreAsset,
  decodeMintCounter,
  decodeTokenAccountAmount,
  serialFromMetadataUri,
} from '../dist/index.js';

const ASSET: Address = address('A6kLyjEaWi5pzdc46MnVd1WeKgFabjWVUREJw8f8rbhn');
const OWNER: Address = address('FLagggahkgNjgzjXKKsXECvPZdLXGtfmUgPuZYKnconk');
const MINT: Address = address('6yv2K6n1pczbSdWNZGfEvkQuS5rgHhq5RwKD64PQ7TcG');
const COLLECTION: Address = address('82zccW1Z97ic24aCrt2c3U6qDUZMfbHufZMCjv2dm1Ym');
const encoder = getAddressEncoder();
const bytesOf = (value: Address) => new Uint8Array(encoder.encode(value));

function citizenState(overrides: { role?: number } = {}): Uint8Array {
  const data = new Uint8Array(CITIZEN_STATE_LAYOUT.length);
  const view = new DataView(data.buffer);
  data.set(CITIZEN_STATE_DISCRIMINATOR, 0);
  view.setUint8(8, 1);
  view.setUint8(9, 254);
  view.setUint32(10, 42, true);
  data.set(bytesOf(ASSET), 14);
  view.setUint8(46, overrides.role ?? 5);
  view.setUint8(47, 3);
  view.setUint8(48, 1);
  view.setUint8(49, 7);
  view.setUint16(50, 2, true);
  view.setUint16(52, 300, true);
  view.setUint16(54, 65_535, true);
  return data;
}

function borshString(value: string): Uint8Array {
  const text = new TextEncoder().encode(value);
  const out = new Uint8Array(4 + text.length);
  new DataView(out.buffer).setUint32(0, text.length, true);
  out.set(text, 4);
  return out;
}

function coreAsset(name: string, uri: string): Uint8Array {
  const head = new Uint8Array(66);
  head[0] = 1;
  head.set(bytesOf(OWNER), 1);
  head[33] = 2;
  head.set(bytesOf(COLLECTION), 34);
  return Uint8Array.of(...head, ...borshString(name), ...borshString(uri), 0);
}

describe('CitizenState', () => {
  it('uses the Anchor discriminator of the account name', () => {
    const expected = [...createHash('sha256').update('account:CitizenState').digest().subarray(0, 8)];
    assert.deepEqual([...CITIZEN_STATE_DISCRIMINATOR], expected);
  });

  it('has the field order and size of the Rust struct', () => {
    const source = readFileSync(join(findRepoRoot(), 'programs/district/src/state/citizen.rs'), 'utf8');
    const body = source.slice(source.indexOf('pub struct CitizenState'), source.indexOf('impl CitizenState'));
    const fields = [...body.matchAll(/pub (\w+): (\w+)/g)].map((match) => `${match[1]}:${match[2]}`);
    assert.deepEqual(fields, [
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
    assert.equal(CITIZEN_STATE_LAYOUT.length, 8 + 1 + 1 + 4 + 32 + 1 + 1 + 1 + 1 + 2 + 2 + 2);
    assert.equal(CITIZEN_STATE_LAYOUT.craftCreditsOffset + 2, CITIZEN_STATE_LAYOUT.length);
  });

  it('decodes every field', () => {
    assert.deepEqual(decodeCitizenState(citizenState()), {
      version: 1,
      bump: 254,
      citizenId: 42,
      asset: ASSET,
      role: 5,
      intelligence: 3,
      alignment: 1,
      compute: 7,
      insightTrainingCredits: 2,
      bondTrainingCredits: 300,
      craftTrainingCredits: 65_535,
    });
  });

  it('refuses a wrong size, a foreign discriminator and an unknown role', () => {
    assert.equal(decodeCitizenState(citizenState().subarray(0, 55)), undefined);
    const foreign = citizenState();
    foreign.set([(foreign[0] ?? 0) ^ 0xff], 0);
    assert.equal(decodeCitizenState(foreign), undefined);
    assert.equal(decodeCitizenState(citizenState({ role: 7 })), undefined);
  });
});

describe('Core asset', () => {
  it('reads owner, collection, name and uri', () => {
    const uri = 'https://example.test/templates/7/018-navigator.json';
    assert.deepEqual(decodeCoreAsset(coreAsset('Rhea #018', uri)), {
      owner: OWNER,
      collection: COLLECTION,
      name: 'Rhea #018',
      uri,
    });
  });

  it('refuses other keys, other update authorities and cut-off strings', () => {
    const asset = coreAsset('Rhea', 'https://example.test/018-navigator.json');
    const wrongKey = asset.slice();
    wrongKey[0] = 5;
    assert.equal(decodeCoreAsset(wrongKey), undefined);
    const wrongAuthority = asset.slice();
    wrongAuthority[33] = 1;
    assert.equal(decodeCoreAsset(wrongAuthority), undefined);
    assert.equal(decodeCoreAsset(asset.subarray(0, asset.length - 10)), undefined);
    assert.equal(decodeCoreAsset(asset.subarray(0, 40)), undefined);
  });
});

describe('metadata serial', () => {
  it('is the number before the role in the file name', () => {
    assert.equal(serialFromMetadataUri('https://x.test/templates/7/018-navigator.json'), 18);
    assert.equal(serialFromMetadataUri('https://x.test/templates/7/005-steward.json?v=2'), 5);
  });

  it('is undefined for anything else', () => {
    assert.equal(serialFromMetadataUri('https://x.test/templates/7/navigator.json'), undefined);
    assert.equal(serialFromMetadataUri('https://x.test/templates/7/000-navigator.json'), undefined);
    assert.equal(serialFromMetadataUri('https://x.test/templates/7/018-navigator.png'), undefined);
    assert.equal(serialFromMetadataUri(''), undefined);
  });
});

describe('token account', () => {
  function tokenAccount(mint: Address, owner: Address, amount: bigint): Uint8Array {
    const data = new Uint8Array(165);
    data.set(bytesOf(mint), 0);
    data.set(bytesOf(owner), 32);
    new DataView(data.buffer).setBigUint64(64, amount, true);
    return data;
  }

  it('reads the amount of the right mint and owner', () => {
    assert.equal(decodeTokenAccountAmount(tokenAccount(MINT, OWNER, 1_240_000_000n), MINT, OWNER), 1_240_000_000n);
    assert.equal(decodeTokenAccountAmount(tokenAccount(MINT, OWNER, 2n ** 64n - 1n), MINT, OWNER), 2n ** 64n - 1n);
  });

  it('refuses another mint, another owner and short data', () => {
    assert.equal(decodeTokenAccountAmount(tokenAccount(ASSET, OWNER, 5n), MINT, OWNER), undefined);
    assert.equal(decodeTokenAccountAmount(tokenAccount(MINT, ASSET, 5n), MINT, OWNER), undefined);
    assert.equal(decodeTokenAccountAmount(new Uint8Array(40), MINT, OWNER), undefined);
  });
});

describe('candy machine', () => {
  function candyMachine(redeemed: bigint, available: bigint): Uint8Array {
    const data = new Uint8Array(CANDY_MACHINE_LAYOUT.minLength + 40);
    data.set(CANDY_MACHINE_LAYOUT.discriminator, 0);
    data.set(bytesOf(OWNER), CANDY_MACHINE_LAYOUT.authorityOffset);
    data.set(bytesOf(ASSET), CANDY_MACHINE_LAYOUT.mintAuthorityOffset);
    data.set(bytesOf(COLLECTION), CANDY_MACHINE_LAYOUT.collectionOffset);
    const view = new DataView(data.buffer);
    view.setBigUint64(CANDY_MACHINE_LAYOUT.itemsRedeemedOffset, redeemed, true);
    view.setBigUint64(CANDY_MACHINE_LAYOUT.itemsAvailableOffset, available, true);
    return data;
  }

  it('reads the keys and the supply counters', () => {
    assert.deepEqual(decodeCandyMachine(candyMachine(3n, 100n)), {
      authority: OWNER,
      mintAuthority: ASSET,
      collection: COLLECTION,
      itemsRedeemed: 3,
      itemsAvailable: 100,
    });
  });

  it('refuses a foreign discriminator, short data and absurd counters', () => {
    const foreign = candyMachine(0n, 10n);
    foreign.set([0], 0);
    assert.equal(decodeCandyMachine(foreign), undefined);
    assert.equal(decodeCandyMachine(candyMachine(0n, 10n).subarray(0, 119)), undefined);
    assert.equal(decodeCandyMachine(candyMachine(0n, 2n ** 60n)), undefined);
  });

  it('reads a mint counter as a bare u16', () => {
    assert.equal(decodeMintCounter(Uint8Array.of(1, 0)), 1);
    assert.equal(decodeMintCounter(Uint8Array.of(0x2c, 0x01)), 300);
    assert.equal(decodeMintCounter(Uint8Array.of(1)), undefined);
  });
});
