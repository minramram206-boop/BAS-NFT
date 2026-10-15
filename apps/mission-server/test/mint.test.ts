import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { Keypair } from '@solana/web3.js';
import type { MintBackend } from '@bas/metaplex-client';
import { Authenticator, MintService, MissionError, createMissionServer } from '../dist/index.js';
import { rig, signMessage } from './fixtures.ts';

interface Sale {
  collection: string;
  mintAuthority: string;
  itemsAvailable: number;
  itemsLoaded: number;
  itemsRedeemed: number;
  mintedByWallet: number;
}

class FakeBackend implements MintBackend {
  signer = 'signer';
  sale_: Sale | undefined = { collection: 'c', mintAuthority: 'g', itemsAvailable: 10, itemsLoaded: 10, itemsRedeemed: 0, mintedByWallet: 0 };
  prepared: string[] = [];

  async sale(): Promise<Sale | undefined> {
    return this.sale_;
  }

  async prepare(wallet: string) {
    this.prepared.push(wallet);
    return { transaction: Uint8Array.from([1, 2, 3]), asset: 'Asset111', blockhash: 'hash', lastValidBlockHeight: 99 };
  }
}

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    assert.ok(error instanceof MissionError);
    return error.code;
  }
  return 'none';
}

describe('mint service', () => {
  it('hands out the transaction as base64 when the wallet may mint', async () => {
    const backend = new FakeBackend();
    const offer = await new MintService({ backend, limitPerWallet: 1 }).prepare('wallet');
    assert.deepEqual(offer, { transaction: 'AQID', asset: 'Asset111', blockhash: 'hash', lastValidBlockHeight: 99 });
    assert.deepEqual(backend.prepared, ['wallet']);
  });

  it('refuses a sold-out sale, a wallet at its limit and a sale that is not loaded', async () => {
    const backend = new FakeBackend();
    const service = new MintService({ backend, limitPerWallet: 1 });

    backend.sale_ = { ...(backend.sale_ as Sale), itemsRedeemed: 10 };
    assert.equal(await codeOf(service.prepare('wallet')), 'sold-out');

    backend.sale_ = { ...(backend.sale_ as Sale), itemsRedeemed: 3, mintedByWallet: 1 };
    assert.equal(await codeOf(service.prepare('wallet')), 'mint-limit');

    backend.sale_ = { ...(backend.sale_ as Sale), mintedByWallet: 0, itemsLoaded: 4 };
    assert.equal(await codeOf(service.prepare('wallet')), 'unavailable');

    backend.sale_ = undefined;
    assert.equal(await codeOf(service.prepare('wallet')), 'unavailable');
    assert.deepEqual(backend.prepared, [], 'no transaction is signed for a refused wallet');
  });

  it('keeps the sale closed until it opens', async () => {
    const backend = new FakeBackend();
    let now = 1_000_000;
    const service = new MintService({ backend, limitPerWallet: 1, opensAt: 2_000, clock: () => now });
    assert.equal(await codeOf(service.prepare('wallet')), 'mint-not-open');
    now = 2_000_000;
    assert.equal(await codeOf(service.prepare('wallet')), 'none');
  });
});

describe('POST /mint/prepare', () => {
  async function start(mint?: MintService) {
    const r = rig();
    const server = createMissionServer({
      service: r.service,
      auth: new Authenticator(Buffer.alloc(32, 5)),
      allowedOrigins: [],
      ...(mint ? { mint } : {}),
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (path: string, init: RequestInit = {}) => {
      const response = await fetch(base + path, init);
      return { status: response.status, json: (await response.json()) as any };
    };
    const signIn = async (wallet: Keypair): Promise<string> => {
      const challenge = await call('/auth/challenge', { method: 'POST', body: JSON.stringify({ wallet: wallet.publicKey.toBase58() }) });
      const verified = await call('/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
          wallet: wallet.publicKey.toBase58(),
          nonce: challenge.json.nonce,
          signature: signMessage(wallet, challenge.json.message).toString('base64'),
        }),
      });
      return verified.json.token as string;
    };
    return { call, signIn, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  }

  it('needs a signed-in wallet and gives it the transaction', async () => {
    const backend = new FakeBackend();
    const { call, signIn, close } = await start(new MintService({ backend, limitPerWallet: 1 }));
    try {
      assert.equal((await call('/mint/prepare', { method: 'POST' })).status, 401);
      const wallet = Keypair.generate();
      const token = await signIn(wallet);
      const response = await call('/mint/prepare', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200);
      assert.equal(response.json.asset, 'Asset111');
      assert.deepEqual(backend.prepared, [wallet.publicKey.toBase58()], 'the wallet comes from the token, not the body');

      backend.sale_ = { ...(backend.sale_ as Sale), mintedByWallet: 1 };
      const again = await call('/mint/prepare', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      assert.equal(again.status, 409);
      assert.equal(again.json.error, 'mint-limit');
    } finally {
      await close();
    }
  });

  it('answers unavailable when the server has no mint key', async () => {
    const { call, signIn, close } = await start();
    try {
      const token = await signIn(Keypair.generate());
      const response = await call('/mint/prepare', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 503);
      assert.equal(response.json.error, 'unavailable');
    } finally {
      await close();
    }
  });
});
