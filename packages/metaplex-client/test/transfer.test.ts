import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildTransferAsset } from '../dist/index.js';
import { offlineUmi, signerOf } from './fixtures.ts';

const MPL_CORE = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
/** Instruction number of `TransferV1` in the Core program. */
const TRANSFER_V1 = 14;

describe('transfer', () => {
  it('builds the Core transfer for an asset in a collection, signed by the current owner', () => {
    const umi = offlineUmi();
    const owner = signerOf(umi, 'owner');
    umi.identity = owner;
    umi.payer = owner;
    const asset = signerOf(umi, 'asset').publicKey;
    const collection = signerOf(umi, 'collection').publicKey;
    const buyer = signerOf(umi, 'buyer').publicKey;

    const [item] = buildTransferAsset(umi, { asset, collection, newOwner: buyer }).items;
    assert.ok(item);
    assert.equal(item.instruction.programId, MPL_CORE);
    assert.equal(item.instruction.data[0], TRANSFER_V1);
    const keys = item.instruction.keys.map((key) => key.pubkey);
    for (const address of [asset, collection, buyer, owner.publicKey]) assert.ok(keys.includes(address as never), `${address} is an account`);
    const signers = item.instruction.keys.filter((key) => key.isSigner).map((key) => key.pubkey);
    assert.ok(signers.includes(owner.publicKey as never), 'the owner signs');
    assert.ok(!signers.includes(buyer as never), 'the buyer does not have to sign');
  });

  it('leaves the collection out for an asset that has none', () => {
    const umi = offlineUmi();
    const owner = signerOf(umi, 'owner');
    umi.identity = owner;
    umi.payer = owner;
    const asset = signerOf(umi, 'asset').publicKey;
    const buyer = signerOf(umi, 'buyer').publicKey;
    const [item] = buildTransferAsset(umi, { asset, collection: null, newOwner: buyer }).items;
    assert.ok(item);
    assert.equal(item.instruction.programId, MPL_CORE);
    assert.ok(!item.instruction.keys.some((key) => key.pubkey === signerOf(umi, 'collection').publicKey));
  });
});
