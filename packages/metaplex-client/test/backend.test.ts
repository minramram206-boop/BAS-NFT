import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMintBackend } from '../dist/index.js';
import { BLOCKHASH, PROGRAM_ID, TREASURY, offlineUmi, signerOf } from './fixtures.ts';

function backendFor(umi = offlineUmi()) {
  umi.rpc = { ...umi.rpc, getLatestBlockhash: async () => BLOCKHASH } as typeof umi.rpc;
  const secret = signerOf(umi, 'mint-signer').secretKey;
  return {
    umi,
    backend: createMintBackend({
      rpcUrl: 'http://127.0.0.1:9',
      programId: PROGRAM_ID,
      approvedTemplateId: 7,
      candyMachine: signerOf(umi, 'machine').publicKey,
      collection: signerOf(umi, 'collection').publicKey,
      treasury: TREASURY,
      mintLimitId: 0,
      mintSecretKey: secret,
      umi,
    }),
  };
}

describe('mint backend', () => {
  it('names the backend signer the guard must be created with', () => {
    const { backend, umi } = backendFor();
    assert.equal(backend.signer, signerOf(umi, 'mint-signer').publicKey);
  });

  it('prepares a different asset for every request and leaves only the wallet to sign', async () => {
    const { backend, umi } = backendFor();
    const wallet = signerOf(umi, 'wallet').publicKey;
    const first = await backend.prepare(wallet);
    const second = await backend.prepare(wallet);
    assert.notEqual(first.asset, second.asset);
    const message = umi.transactions.deserialize(first.transaction).message;
    assert.equal(message.accounts[0], wallet, 'the wallet pays and signs first');
    assert.ok(message.accounts.includes(first.asset as never));
    assert.equal(first.blockhash, BLOCKHASH.blockhash);
  });
});
