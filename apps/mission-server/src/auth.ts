import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { SESSION_TTL_MS, issueBearerToken, verifyBearerToken } from '@bas/server-kit';
import { PublicKey } from '@solana/web3.js';
import { MissionError } from './errors.js';

const CHALLENGE_TTL_MS = 5 * 60_000;

/** DER prefix of an Ed25519 public key in SubjectPublicKeyInfo form. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function signInMessage(wallet: string, nonce: string, issuedAt: number): string {
  return [
    'BAS District sign-in',
    'Sign this message to prove you hold this wallet. It does not move any funds.',
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Issued: ${new Date(issuedAt).toISOString()}`,
  ].join('\n');
}

export function verifyWalletSignature(wallet: string, message: string, signature: Uint8Array): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, new PublicKey(wallet).toBuffer()]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, Buffer.from(message), key, signature);
  } catch {
    return false;
  }
}

export interface Challenge {
  readonly nonce: string;
  readonly issuedAt: number;
  readonly message: string;
}

/** Wallet sign-in: a one-time message to sign, then a signed bearer token. */
export class Authenticator {
  private readonly challenges = new Map<string, Challenge>();

  constructor(
    private readonly secret: Buffer,
    private readonly clock: () => number = Date.now,
  ) {
    if (secret.length < 32) throw new Error('[mission-server] the token secret needs at least 32 bytes');
  }

  challenge(wallet: string): Challenge {
    try {
      new PublicKey(wallet);
    } catch {
      throw new MissionError('bad-request', 'wallet is not a valid address');
    }
    const now = this.clock();
    for (const [key, entry] of this.challenges) {
      if (now - entry.issuedAt > CHALLENGE_TTL_MS) this.challenges.delete(key);
    }
    const nonce = randomBytes(16).toString('hex');
    const challenge = { nonce, issuedAt: now, message: signInMessage(wallet, nonce, now) };
    this.challenges.set(`${wallet}:${nonce}`, challenge);
    return challenge;
  }

  /** Trades a signed challenge for a token. A challenge works once. */
  redeem(wallet: string, nonce: string, signature: Uint8Array): { token: string; expiresAt: number } {
    const key = `${wallet}:${nonce}`;
    const challenge = this.challenges.get(key);
    this.challenges.delete(key);
    const now = this.clock();
    if (!challenge || now - challenge.issuedAt > CHALLENGE_TTL_MS) throw new MissionError('unauthorized');
    if (!verifyWalletSignature(wallet, challenge.message, signature)) throw new MissionError('unauthorized');
    const expiresAt = now + SESSION_TTL_MS;
    return { token: this.issue(wallet, expiresAt), expiresAt };
  }

  /** The wallet a bearer token was issued to. */
  wallet(token: string | undefined): string {
    const wallet = verifyBearerToken(this.secret, token, this.clock());
    if (!wallet) throw new MissionError('unauthorized');
    return wallet;
  }

  private issue(wallet: string, expiresAt: number): string {
    return issueBearerToken(this.secret, wallet, expiresAt);
  }
}
