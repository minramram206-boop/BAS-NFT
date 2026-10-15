import { createPrivateKey, sign } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  MemoryStore,
  MissionService,
  type CitizenOnChain,
  type ChainReader,
  type MissionServiceOptions,
} from '../dist/index.js';

export const PROGRAM_ID = new PublicKey('82zccW1Z97ic24aCrt2c3U6qDUZMfbHufZMCjv2dm1Ym');
export const SEASON_START = 1_800_000_000;
export const DAY = 86_400;

/** A fake chain: who holds which asset, what the citizens' scores are, and which receipts exist. */
export class FakeChain implements ChainReader {
  readonly owners = new Map<string, string>();
  readonly citizens = new Map<string, CitizenOnChain>();
  readonly receipts = new Set<string>();

  async assetOwner(asset: string): Promise<string | null> {
    return this.owners.get(asset) ?? null;
  }

  async citizen(asset: string): Promise<CitizenOnChain | null> {
    return this.citizens.get(asset) ?? null;
  }

  async claimReceiptExists(asset: string, missionChainId: number, nonce: number): Promise<boolean> {
    return this.receipts.has(`${asset}:${missionChainId}:${nonce}`);
  }

  async latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 };
  }

  register(asset: string, owner: string, scores: [number, number, number]): void {
    this.owners.set(asset, owner);
    this.citizens.set(asset, {
      citizenId: 1,
      role: 0,
      scores: { intelligence: scores[0], alignment: scores[1], compute: scores[2] },
    });
  }
}

export class Clock {
  now = (SEASON_START + 3_600) * 1000;
  readonly read = (): number => this.now;

  advance(seconds: number): void {
    this.now += seconds * 1000;
  }
}

export interface Rig {
  readonly service: MissionService;
  readonly chain: FakeChain;
  readonly clock: Clock;
  readonly store: MemoryStore;
  readonly authority: Keypair;
  readonly owner: Keypair;
  readonly asset: string;
}

export function rig(overrides: Partial<MissionServiceOptions> = {}, scores: [number, number, number] = [1, 1, 1]): Rig {
  const chain = new FakeChain();
  const clock = new Clock();
  const store = new MemoryStore();
  const authority = Keypair.generate();
  const owner = Keypair.generate();
  const asset = Keypair.generate().publicKey.toBase58();
  chain.register(asset, owner.publicKey.toBase58(), scores);
  const service = new MissionService({
    programId: PROGRAM_ID,
    authority,
    season: { id: 1, startsAt: SEASON_START, days: 28 },
    store,
    chain,
    clock: clock.read,
    ...overrides,
  });
  return { service, chain, clock, store, authority, owner, asset };
}

/** Signs `message` as `keypair` the way a wallet's `signMessage` does. */
export function signMessage(keypair: Keypair, message: string): Buffer {
  const key = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(keypair.secretKey.subarray(0, 32))]),
    format: 'der',
    type: 'pkcs8',
  });
  return sign(null, Buffer.from(message), key);
}
