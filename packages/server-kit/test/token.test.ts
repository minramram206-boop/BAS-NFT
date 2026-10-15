import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RateLimiter, issueBearerToken, verifyBearerToken } from '../dist/index.js';

const secret = Buffer.alloc(32, 9);
const WALLET = 'Wallet1111111111111111111111111111111111111';

describe('bearer token', () => {
  it('names the wallet it was issued to', () => {
    const token = issueBearerToken(secret, WALLET, 2_000);
    assert.equal(verifyBearerToken(secret, token, 1_000), WALLET);
  });

  it('rejects an expired token, a missing one and a different secret', () => {
    const token = issueBearerToken(secret, WALLET, 2_000);
    assert.equal(verifyBearerToken(secret, token, 2_000), null);
    assert.equal(verifyBearerToken(secret, undefined, 1_000), null);
    assert.equal(verifyBearerToken(Buffer.alloc(32, 1), token, 1_000), null);
  });

  it('rejects a token whose claim was edited', () => {
    const token = issueBearerToken(secret, WALLET, 2_000);
    const [, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ w: 'Other', exp: 9_999 })).toString('base64url');
    assert.equal(verifyBearerToken(secret, `${forged}.${mac}`, 1_000), null);
    assert.equal(verifyBearerToken(secret, 'garbage', 1_000), null);
  });
});

describe('rate limiter', () => {
  it('allows the limit per minute per client and starts over in the next window', () => {
    let now = 0;
    const limiter = new RateLimiter(2, () => now);
    assert.deepEqual([limiter.allow('a'), limiter.allow('a'), limiter.allow('a'), limiter.allow('b')], [true, true, false, true]);
    now = 60_000;
    assert.equal(limiter.allow('a'), true);
  });
});
