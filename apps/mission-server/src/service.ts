import { Keypair, PublicKey } from '@solana/web3.js';
import {
  DAILY_MISSION_LIMIT,
  EVENT_TASK_POINTS,
  MISSION_POINTS,
  findMission,
  type MissionSpec,
  type StatName,
} from './catalog.js';
import { buildClaimTransaction, type ChainReader } from './chain.js';
import { MissionError } from './errors.js';
import { describeClaim, type HistoryEvent } from './history.js';
import { assertCanStart, checkStep, type StepProof } from './rules.js';
import type { ClaimRecord, IssuedClaim, MissionStore, Session } from './store.js';

/** One season day on the real clock. */
export const DAY_SECONDS = 86_400;
/** How long a signed claim stays valid on chain. */
export const CLAIM_TTL_SECONDS = 120;
/** Slack for clock skew between this server and the validators before an expired claim is replaced. */
const EXPIRY_MARGIN_SECONDS = 30;

export interface SeasonConfig {
  readonly id: number;
  /** Unix seconds of day 1, hour 0. */
  readonly startsAt: number;
  readonly days: number;
  /** Seconds in one season day; shorter only on devnet, to play a season through in an afternoon. */
  readonly daySeconds?: number;
}

/** When a season ends, in unix seconds; the prize vault takes the same end. */
export function seasonEndsAt(season: SeasonConfig): number {
  return season.startsAt + season.days * (season.daySeconds ?? DAY_SECONDS);
}

export interface EventWindow {
  /** Unix seconds. */
  readonly startsAt: number;
  readonly endsAt: number;
}

export interface MissionServiceOptions {
  readonly programId: PublicKey;
  readonly authority: Keypair;
  readonly season: SeasonConfig;
  /** District event missions by mission id. A mission without a window is closed. */
  readonly events?: Readonly<Record<string, EventWindow>>;
  readonly store: MissionStore;
  readonly chain: ChainReader;
  /**
   * Called once a claim is confirmed on chain, with the line for the citizen's
   * public history. A failure here never fails the claim, so the hook must log
   * its own errors.
   */
  readonly onHistory?: (event: HistoryEvent) => Promise<void> | void;
  /** Milliseconds; replaced in tests. */
  readonly clock?: () => number;
}

export interface MissionStatus {
  readonly season: { id: number; day: number; days: number; open: boolean };
  readonly limit: number;
  /** Missions this citizen finished today. */
  readonly doneToday: readonly string[];
  /** Missions this citizen finished this season, oldest first. */
  readonly claims: readonly { missionId: string; stat: StatName; day: number }[];
  readonly session: {
    readonly missionId: string;
    readonly stat: StatName;
    readonly done: number;
    readonly steps: number;
  } | null;
  readonly points: number;
}

/** What anyone can read about the running season; no wallet needed. */
export interface SeasonInfo {
  readonly id: number;
  /** Unix seconds of day 1, hour 0. */
  readonly startsAt: number;
  readonly days: number;
  readonly daySeconds: number;
  /** Unix seconds; the season's prizes can be drawn up from then on. */
  readonly endsAt: number;
  /** Season day counted from 1; 0 or less before the start, above `days` after the end. */
  readonly day: number;
  readonly open: boolean;
  /** Scheduled event missions by mission id, in unix seconds. */
  readonly events: Readonly<Record<string, EventWindow>>;
}

export type ClaimOutcome =
  | { readonly status: 'sign'; readonly transaction: string; readonly expiresAt: number }
  | { readonly status: 'confirmed'; readonly points: number };

/** Serializes work per key, so two requests for one citizen never interleave. */
class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.tails.set(key, next.catch(() => undefined));
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === next) this.tails.delete(key);
    }
  }
}

function pointsOf(mission: MissionSpec): number {
  return mission.event ? EVENT_TASK_POINTS : MISSION_POINTS;
}

/** The mission rules (D-0025), checked against what the chain says about the citizen. */
export class MissionService {
  private readonly lock = new KeyedLock();
  private readonly clock: () => number;

  constructor(private readonly options: MissionServiceOptions) {
    this.clock = options.clock ?? Date.now;
  }

  /** Season day, counted from 1; 0 or less before the season starts. */
  dayAt(now: number): number {
    const { startsAt, daySeconds = DAY_SECONDS } = this.options.season;
    return Math.floor((Math.floor(now / 1000) - startsAt) / daySeconds) + 1;
  }

  season(): SeasonInfo {
    const { season, events } = this.options;
    const day = this.dayAt(this.clock());
    return {
      id: season.id,
      startsAt: season.startsAt,
      days: season.days,
      daySeconds: season.daySeconds ?? DAY_SECONDS,
      endsAt: seasonEndsAt(season),
      day,
      open: day >= 1 && day <= season.days,
      events: { ...events },
    };
  }

  async status(wallet: string, asset: string): Promise<MissionStatus> {
    await this.assertOwner(wallet, asset);
    return this.statusOf(asset);
  }

  async start(wallet: string, asset: string, missionId: string, stat: StatName): Promise<MissionStatus> {
    return this.lock.run(asset, async () => {
      await this.assertOwner(wallet, asset);
      const mission = this.mission(missionId);
      const citizen = await this.options.chain.citizen(asset);
      if (!citizen) throw new MissionError('citizen-not-found');

      const now = this.clock();
      const day = this.dayAt(now);
      const claims = await this.options.store.claimsOf(asset);
      const window = this.options.events?.[mission.id];
      const seconds = Math.floor(now / 1000);
      assertCanStart({
        mission,
        stat,
        scores: citizen.scores,
        doneToday: this.doneOn(claims, day),
        hasSession: (await this.options.store.getSession(asset)) !== undefined,
        seasonOpen: day >= 1 && day <= this.options.season.days,
        eventOpen: window !== undefined && seconds >= window.startsAt && seconds < window.endsAt,
      });

      await this.options.store.saveSession({
        asset,
        wallet,
        missionId: mission.id,
        stat,
        done: 0,
        startedAt: now,
        lastStepAt: now,
      });
      return this.statusOf(asset);
    });
  }

  async step(wallet: string, asset: string, missionId: string, proof: StepProof): Promise<MissionStatus> {
    return this.lock.run(asset, async () => {
      await this.assertOwner(wallet, asset);
      const session = await this.sessionOf(asset, missionId);
      const mission = this.mission(session.missionId);
      if (session.done >= mission.steps.length) throw new MissionError('wrong-step');

      const now = this.clock();
      checkStep(mission, session.done, proof, now - session.lastStepAt);
      await this.options.store.saveSession({ ...session, done: session.done + 1, lastStepAt: now });
      return this.statusOf(asset);
    });
  }

  async abandon(wallet: string, asset: string): Promise<MissionStatus> {
    return this.lock.run(asset, async () => {
      await this.assertOwner(wallet, asset);
      const session = await this.options.store.getSession(asset);
      if (!session) throw new MissionError('no-session');
      if (session.claim && (await this.receiptExists(session, session.claim))) {
        // The claim already landed on chain, so the mission is finished, not abandoned.
        throw new MissionError('claim-pending');
      }
      await this.options.store.deleteSession(asset);
      return this.statusOf(asset);
    });
  }

  /**
   * Signs the claim for a finished mission. The citizen's owner adds the last
   * signature and sends it. Asking again before the claim expires returns the
   * same arguments with a fresh blockhash.
   */
  async claim(wallet: string, asset: string, missionId: string): Promise<ClaimOutcome> {
    return this.lock.run(asset, async () => {
      await this.assertOwner(wallet, asset);
      const session = await this.sessionOf(asset, missionId);
      const mission = this.mission(session.missionId);
      if (session.done < mission.steps.length) throw new MissionError('steps-left');

      const now = this.clock();
      const seconds = Math.floor(now / 1000);
      let issued = session.claim;
      if (issued && (await this.receiptExists(session, issued))) {
        return { status: 'confirmed', points: await this.finish(session, mission, issued) };
      }
      // A claim that is expired by a margin can be replaced; one that may still land on chain cannot.
      if (issued && seconds >= issued.expiresAt && seconds < issued.expiresAt + EXPIRY_MARGIN_SECONDS) {
        throw new MissionError('claim-pending');
      }
      if (!issued || seconds >= issued.expiresAt) {
        const day = this.dayAt(now);
        if (day < 1 || day > this.options.season.days) throw new MissionError('season-closed');
        // One nonce per season day: the receipt PDA then also stops a second claim of this mission on the same day.
        issued = {
          nonce: this.options.season.id * 1000 + day,
          seasonId: this.options.season.id,
          day,
          issuedAt: seconds,
          expiresAt: seconds + CLAIM_TTL_SECONDS,
        };
        await this.options.store.saveSession({ ...session, claim: issued });
      }

      const { blockhash } = await this.options.chain.latestBlockhash();
      const transaction = buildClaimTransaction({
        programId: this.options.programId,
        asset: new PublicKey(asset),
        owner: new PublicKey(wallet),
        authority: this.options.authority,
        args: {
          stat: session.stat,
          missionChainId: mission.chainId,
          seasonId: issued.seasonId,
          nonce: issued.nonce,
          expiresAt: issued.expiresAt,
        },
        blockhash,
      });
      return {
        status: 'sign',
        transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
        expiresAt: issued.expiresAt,
      };
    });
  }

  /** Counts a claim once its receipt exists on chain. */
  async confirm(wallet: string, asset: string, missionId: string): Promise<MissionStatus> {
    return this.lock.run(asset, async () => {
      await this.assertOwner(wallet, asset);
      const session = await this.sessionOf(asset, missionId);
      const mission = this.mission(session.missionId);
      const issued = session.claim;
      if (!issued || !(await this.receiptExists(session, issued))) throw new MissionError('claim-missing');
      await this.finish(session, mission, issued);
      return this.statusOf(asset);
    });
  }

  /** Season points per citizen, highest first. */
  async standings(): Promise<readonly { asset: string; points: number }[]> {
    const totals = new Map<string, number>();
    for (const claim of await this.options.store.allClaims()) {
      if (claim.seasonId !== this.options.season.id) continue;
      totals.set(claim.asset, (totals.get(claim.asset) ?? 0) + claim.points);
    }
    return [...totals.entries()]
      .map(([asset, points]) => ({ asset, points }))
      .sort((a, b) => b.points - a.points || a.asset.localeCompare(b.asset));
  }

  private async finish(session: Session, mission: MissionSpec, issued: IssuedClaim): Promise<number> {
    const record: ClaimRecord = {
      asset: session.asset,
      missionId: mission.id,
      stat: session.stat,
      seasonId: issued.seasonId,
      day: issued.day,
      points: pointsOf(mission),
      confirmedAt: this.clock(),
    };
    await this.options.store.addClaim(record);
    await this.options.store.deleteSession(session.asset);
    try {
      await this.options.onHistory?.(describeClaim(record, mission));
    } catch {
      // The claim is already counted; the history line is best effort.
    }
    return record.points;
  }

  private receiptExists(session: Session, issued: IssuedClaim): Promise<boolean> {
    const mission = this.mission(session.missionId);
    return this.options.chain.claimReceiptExists(session.asset, mission.chainId, issued.nonce);
  }

  private doneOn(claims: readonly ClaimRecord[], day: number): string[] {
    return claims
      .filter((claim) => claim.seasonId === this.options.season.id && claim.day === day)
      .map((claim) => claim.missionId);
  }

  private mission(id: string): MissionSpec {
    const mission = findMission(id);
    if (!mission) throw new MissionError('unknown-mission');
    return mission;
  }

  private async sessionOf(asset: string, missionId: string): Promise<Session> {
    const session = await this.options.store.getSession(asset);
    if (!session) throw new MissionError('no-session');
    if (session.missionId !== missionId) throw new MissionError('wrong-session');
    return session;
  }

  private async assertOwner(wallet: string, asset: string): Promise<void> {
    try {
      new PublicKey(asset);
    } catch {
      throw new MissionError('bad-request', 'asset is not a valid address');
    }
    const owner = await this.options.chain.assetOwner(asset);
    if (owner === null) throw new MissionError('citizen-not-found');
    if (owner !== wallet) throw new MissionError('not-owner');
  }

  private async statusOf(asset: string): Promise<MissionStatus> {
    const { season } = this.options;
    const day = this.dayAt(this.clock());
    const claims = (await this.options.store.claimsOf(asset)).filter((claim) => claim.seasonId === season.id);
    const session = await this.options.store.getSession(asset);
    return {
      season: { id: season.id, day, days: season.days, open: day >= 1 && day <= season.days },
      limit: DAILY_MISSION_LIMIT,
      doneToday: this.doneOn(claims, day),
      claims: claims.map((claim) => ({ missionId: claim.missionId, stat: claim.stat, day: claim.day })),
      session: session
        ? {
            missionId: session.missionId,
            stat: session.stat,
            done: session.done,
            steps: this.mission(session.missionId).steps.length,
          }
        : null,
      points: claims.reduce((sum, claim) => sum + claim.points, 0),
    };
  }
}
