import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { Authenticator, MissionError } from '../dist/index.js';
import { signMessage } from './fixtures.ts';

const secret = Buffer.alloc(32, 7);

function code(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof MissionError) return error.code;
    throw error;
  }
  return 'none';
}

describe('wallet sign-in', () => {
  it('trades a signed challenge for a token that names the wallet', () => {
    const auth = new Authenticator(secret);
    const wallet = Keypair.generate();
    const challenge = auth.challenge(wallet.publicKey.toBase58());
    const { token } = auth.redeem(wallet.publicKey.toBase58(), challenge.nonce, signMessage(wallet, challenge.message));
    assert.equal(auth.wallet(token), wallet.publicKey.toBase58());
  });

  it('rejects a signature from another key, and a challenge used twice', () => {
    const auth = new Authenticator(secret);
    const wallet = Keypair.generate();
    const other = Keypair.generate();
    const first = auth.challenge(wallet.publicKey.toBase58());
    assert.equal(code(() => auth.redeem(wallet.publicKey.toBase58(), first.nonce, signMessage(other, first.message))), 'unauthorized');

    const second = auth.challenge(wallet.publicKey.toBase58());
    const signature = signMessage(wallet, second.message);
    auth.redeem(wallet.publicKey.toBase58(), second.nonce, signature);
    assert.equal(code(() => auth.redeem(wallet.publicKey.toBase58(), second.nonce, signature)), 'unauthorized');
  });

  it('rejects a signature over a different message', () => {
    const auth = new Authenticator(secret);
    const wallet = Keypair.generate();
    const challenge = auth.challenge(wallet.publicKey.toBase58());
    assert.equal(
      code(() => auth.redeem(wallet.publicKey.toBase58(), challenge.nonce, signMessage(wallet, 'something else'))),
      'unauthorized',
    );
  });

  it('expires challenges and tokens', () => {
    let now = 1_000_000;
    const auth = new Authenticator(secret, () => now);
    const wallet = Keypair.generate();
    const stale = auth.challenge(wallet.publicKey.toBase58());
    now += 6 * 60_000;
    assert.equal(code(() => auth.redeem(wallet.publicKey.toBase58(), stale.nonce, signMessage(wallet, stale.message))), 'unauthorized');

    const fresh = auth.challenge(wallet.publicKey.toBase58());
    const { token } = auth.redeem(wallet.publicKey.toBase58(), fresh.nonce, signMessage(wallet, fresh.message));
    now += 13 * 60 * 60_000;
    assert.equal(code(() => auth.wallet(token)), 'unauthorized');
  });

  it('rejects a tampered token and one from another secret', () => {
    const auth = new Authenticator(secret);
    const wallet = Keypair.generate();
    const challenge = auth.challenge(wallet.publicKey.toBase58());
    const { token } = auth.redeem(wallet.publicKey.toBase58(), challenge.nonce, signMessage(wallet, challenge.message));
    const [body, mac] = token.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ w: Keypair.generate().publicKey.toBase58(), exp: Date.now() + 1e9 })).toString('base64url');
    assert.equal(code(() => auth.wallet(`${forged}.${mac}`)), 'unauthorized');
    assert.equal(code(() => auth.wallet(`${body}.AAAA`)), 'unauthorized');
    assert.equal(code(() => new Authenticator(Buffer.alloc(32, 9)).wallet(token)), 'unauthorized');
    assert.equal(code(() => auth.wallet(undefined)), 'unauthorized');
  });

  it('refuses a short secret and a malformed wallet', () => {
    assert.throws(() => new Authenticator(Buffer.alloc(8)));
    assert.equal(code(() => new Authenticator(secret).challenge('not a wallet')), 'bad-request');
  });
});
