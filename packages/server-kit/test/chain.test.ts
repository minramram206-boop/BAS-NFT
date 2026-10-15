import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MPL_CORE_PROGRAM_ID } from '@bas/chain-client';
import { Keypair, PublicKey } from '@solana/web3.js';
import { RpcAssetReader } from '../dist/index.js';

const collection = Keypair.generate().publicKey;
const program = Keypair.generate().publicKey;

function str(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}

/** A Core `AssetV1` account: key, owner, collection update authority, then name and uri. */
function coreAsset(owner: PublicKey, inCollection: PublicKey, uri: string): Buffer {
  const head = Buffer.alloc(66);
  head.writeUInt8(1, 0);
  owner.toBuffer().copy(head, 1);
  head.writeUInt8(2, 33);
  inCollection.toBuffer().copy(head, 34);
  return Buffer.concat([head, str('Citizen #019'), str(uri)]);
}

class StubbedReader extends RpcAssetReader {
  constructor(account: { owner: PublicKey; data: Buffer } | null) {
    super('http://127.0.0.1:1', { programId: program, collection });
    (this as unknown as { connection: unknown }).connection = { getAccountInfo: async () => account };
  }
}

describe('asset reader', () => {
  const holder = Keypair.generate().publicKey;
  const asset = Keypair.generate().publicKey.toBase58();
  const core = new PublicKey(MPL_CORE_PROGRAM_ID);

  it('reads the holder and the roster number from the metadata file name', async () => {
    const reader = new StubbedReader({ owner: core, data: coreAsset(holder, collection, 'https://example.test/meta/19-steward.json') });
    assert.deepEqual(await reader.assetInfo(asset), { owner: holder.toBase58(), serial: 19 });
  });

  it('gives no roster number when the file name does not follow the rule', async () => {
    const reader = new StubbedReader({ owner: core, data: coreAsset(holder, collection, 'https://example.test/meta/steward.json') });
    assert.deepEqual(await reader.assetInfo(asset), { owner: holder.toBase58(), serial: null });
  });

  it('ignores accounts that are not citizens of this collection', async () => {
    const other = Keypair.generate().publicKey;
    assert.equal(await new StubbedReader(null).assetInfo(asset), null);
    assert.equal(await new StubbedReader({ owner: other, data: coreAsset(holder, collection, 'x/1-pioneer.json') }).assetInfo(asset), null);
    assert.equal(await new StubbedReader({ owner: core, data: coreAsset(holder, other, 'x/1-pioneer.json') }).assetInfo(asset), null);
  });
});
