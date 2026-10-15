import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StatName } from './catalog.js';

/** A mission one citizen is playing. At most one per citizen. */
export interface Session {
  readonly asset: string;
  readonly wallet: string;
  readonly missionId: string;
  /** Fixed at start; the claim is signed for this stat only. */
  readonly stat: StatName;
  /** Steps finished so far. */
  readonly done: number;
  readonly startedAt: number;
  readonly lastStepAt: number;
  /** Set once the claim was issued, so a retry returns the same one. */
  readonly claim?: IssuedClaim;
}

export interface IssuedClaim {
  readonly nonce: number;
  readonly seasonId: number;
  /** Season day the claim was issued on; the daily limit counts it there. */
  readonly day: number;
  readonly expiresAt: number;
  readonly issuedAt: number;
}

/** A mission claim the chain confirmed. These are what the daily limit and the season points count. */
export interface ClaimRecord {
  readonly asset: string;
  readonly missionId: string;
  readonly stat: StatName;
  readonly seasonId: number;
  readonly day: number;
  readonly points: number;
  readonly confirmedAt: number;
}

export interface MissionStore {
  getSession(asset: string): Promise<Session | undefined>;
  saveSession(session: Session): Promise<void>;
  deleteSession(asset: string): Promise<void>;
  claimsOf(asset: string): Promise<readonly ClaimRecord[]>;
  addClaim(claim: ClaimRecord): Promise<void>;
  allClaims(): Promise<readonly ClaimRecord[]>;
}

interface StoreData {
  sessions: Record<string, Session>;
  claims: ClaimRecord[];
}

/** Keeps everything in memory. Used by the tests and as the base of the file store. */
export class MemoryStore implements MissionStore {
  protected data: StoreData = { sessions: {}, claims: [] };

  async getSession(asset: string): Promise<Session | undefined> {
    return this.data.sessions[asset];
  }

  async saveSession(session: Session): Promise<void> {
    this.data.sessions[session.asset] = session;
    await this.persist();
  }

  async deleteSession(asset: string): Promise<void> {
    delete this.data.sessions[asset];
    await this.persist();
  }

  async claimsOf(asset: string): Promise<readonly ClaimRecord[]> {
    return this.data.claims.filter((claim) => claim.asset === asset);
  }

  async addClaim(claim: ClaimRecord): Promise<void> {
    this.data.claims.push(claim);
    await this.persist();
  }

  async allClaims(): Promise<readonly ClaimRecord[]> {
    return this.data.claims;
  }

  protected async persist(): Promise<void> {}
}

/**
 * One JSON file, rewritten through a temporary file and a rename so a crash
 * never leaves half a file. Fine for a single server process; a second
 * instance needs a real database behind `MissionStore`.
 */
export class FileStore extends MemoryStore {
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {
    super();
    try {
      this.data = JSON.parse(readFileSync(path, 'utf8')) as StoreData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  protected override persist(): Promise<void> {
    const snapshot = JSON.stringify(this.data);
    this.writing = this.writing.then(() => {
      mkdirSync(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      writeFileSync(temporary, snapshot);
      renameSync(temporary, this.path);
    });
    return this.writing;
  }
}
