import type { StatKey } from '@bas/content';
import type { StepProof } from '../types';
import type { WalletSession } from './types';

/**
 * Typed client of the mission server (`apps/mission-server`). It signs the
 * wallet in once, keeps the bearer token in memory and signs in again when the
 * server says the token is no longer good.
 */

export interface SeasonInfo {
  readonly id: number;
  readonly startsAt: number;
  readonly days: number;
  /** Seconds in a season day; a server from before short devnet days leaves it out. */
  readonly daySeconds?: number;
  readonly endsAt?: number;
  readonly day: number;
  readonly open: boolean;
  readonly events: Readonly<Record<string, { startsAt: number; endsAt: number }>>;
}

/** One row of a season's published winners. Lamports are decimal strings. */
export interface PublishedPrizeRow {
  readonly index: number;
  readonly winner: string;
  readonly amountLamports: string;
  readonly asset: string;
  readonly pool: 'open' | 'rookie' | 'skilled' | 'elite' | 'master';
  readonly rank: number;
}

/** The winners list behind a season's root in the prize vault. */
export interface PublishedPrizes {
  readonly seasonId: number;
  /** Hex of the root the list hashes to. */
  readonly root: string;
  readonly rows: readonly PublishedPrizeRow[];
}

/** One sale in the market, as the mission server reports it. Lamports are decimal strings. */
export interface SaleActivity {
  readonly signature: string;
  readonly asset: string;
  readonly seller: string;
  readonly buyer: string;
  readonly priceLamports: string;
  readonly sellerLamports: string;
  readonly kind: 'fixed' | 'auction' | 'offer';
  /** Unix seconds. */
  readonly at: number;
}

export interface BidActivity {
  readonly signature: string;
  readonly asset: string;
  readonly bidder: string;
  readonly amountLamports: string;
  readonly previousBidder: string | null;
  readonly at: number;
}

export interface MarketActivity {
  readonly sales: readonly SaleActivity[];
  readonly bids: readonly BidActivity[];
}

export interface MissionStatus {
  readonly season: { id: number; day: number; days: number; open: boolean };
  readonly limit: number;
  readonly doneToday: readonly string[];
  readonly claims: readonly { missionId: string; stat: StatKey; day: number }[];
  readonly session: { missionId: string; stat: StatKey; done: number; steps: number } | null;
  readonly points: number;
}

export type ClaimOutcome =
  | { readonly status: 'sign'; readonly transaction: string; readonly expiresAt: number }
  | { readonly status: 'confirmed'; readonly points: number };

/** A mint transaction the server built; the wallet adds the last signature. */
export interface MintOffer {
  /** Base64 wire bytes. */
  readonly transaction: string;
  /** Address the new citizen will have. */
  readonly asset: string;
}

export interface Standing {
  readonly asset: string;
  readonly points: number;
  readonly masterEligible?: boolean;
}

/** The server refused the request, or could not be reached (`code: 'unavailable'`). */
export class MissionApiError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'MissionApiError';
    this.code = code;
  }
}

export interface MissionApiOptions {
  /** Origin of the mission server, without a trailing slash. */
  readonly baseUrl: string;
  /** The connected wallet, or `null`. Read on every call, so a disconnect takes effect at once. */
  readonly wallet: () => WalletSession | null;
  readonly fetch?: typeof fetch;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export class MissionApi {
  private token: { wallet: string; value: string } | null = null;
  private readonly options: MissionApiOptions;
  private readonly call: typeof fetch;

  constructor(options: MissionApiOptions) {
    this.options = options;
    this.call = options.fetch ?? ((...args) => fetch(...args));
  }

  /** True while a token for the connected wallet is held. */
  get signedIn(): boolean {
    const wallet = this.options.wallet();
    return wallet !== null && this.token?.wallet === wallet.address;
  }

  /** Forget the token, for a disconnect or a switch of wallet. */
  forget(): void {
    this.token = null;
  }

  season(): Promise<SeasonInfo> {
    return this.request<SeasonInfo>('GET', '/season', undefined, false);
  }

  async standings(): Promise<readonly Standing[]> {
    return (await this.request<{ standings: Standing[] }>('GET', '/season/standings', undefined, false)).standings;
  }

  /** The published winners of a season, or `null` before they are drawn up. Public: no sign-in. */
  async prizes(seasonId: number): Promise<PublishedPrizes | null> {
    const body = await this.request<{ prizes: PublishedPrizes | null }>('GET', `/season/prizes?season=${seasonId}`, undefined, false);
    return body.prizes && Array.isArray(body.prizes.rows) ? body.prizes : null;
  }

  /** Sales and bids the server read from the market program. Public: no sign-in. */
  async marketActivity(): Promise<MarketActivity> {
    const body = await this.request<MarketActivity>('GET', '/market/activity', undefined, false);
    return { sales: Array.isArray(body.sales) ? body.sales : [], bids: Array.isArray(body.bids) ? body.bids : [] };
  }

  /** The market notices `wallet` dismissed in any browser, newest first. Public: no sign-in. */
  async seenNotices(wallet: string): Promise<string[]> {
    const body = await this.request<{ ids?: unknown }>('GET', `/market/seen?wallet=${encodeURIComponent(wallet)}`, undefined, false);
    return Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : [];
  }

  /**
   * Adds dismissed market notices for the connected wallet. Only with a token
   * already held: a dismissed notice is not worth a wallet prompt, so without
   * one this does nothing and returns `false`.
   */
  async rememberSeen(ids: readonly string[]): Promise<boolean> {
    if (!this.signedIn || ids.length === 0) return false;
    await this.request('POST', '/market/seen', { ids });
    return true;
  }

  /** Asks for the mint transaction of the public sale. The server decides whether this wallet may mint. */
  prepareMint(): Promise<MintOffer> {
    return this.request('POST', '/mint/prepare', {});
  }

  /** The bearer token for the connected wallet, signing in first if there is none. `force` signs in again. */
  bearer(force = false): Promise<string> {
    return this.authorize(force);
  }

  /** Signs in now, so a later call does not stop on the wallet prompt. */
  async signIn(): Promise<void> {
    await this.authorize(true);
  }

  status(asset: string): Promise<MissionStatus> {
    return this.request('GET', `/citizens/${asset}/missions`);
  }

  start(asset: string, missionId: string, stat: StatKey): Promise<MissionStatus> {
    return this.request('POST', `/citizens/${asset}/missions/start`, { missionId, stat });
  }

  step(asset: string, missionId: string, proof: StepProof): Promise<MissionStatus> {
    return this.request('POST', `/citizens/${asset}/missions/step`, { missionId, proof });
  }

  claim(asset: string, missionId: string): Promise<ClaimOutcome> {
    return this.request('POST', `/citizens/${asset}/missions/claim`, { missionId });
  }

  confirm(asset: string, missionId: string): Promise<MissionStatus> {
    return this.request('POST', `/citizens/${asset}/missions/confirm`, { missionId });
  }

  abandon(asset: string): Promise<MissionStatus> {
    return this.request('POST', `/citizens/${asset}/missions/abandon`, {});
  }

  private async authorize(force = false): Promise<string> {
    const wallet = this.options.wallet();
    if (!wallet) throw new MissionApiError('not-connected');
    if (!force && this.token?.wallet === wallet.address) return this.token.value;

    const challenge = await this.send<{ nonce: string; message: string }>('POST', '/auth/challenge', { wallet: wallet.address });
    const signature = await wallet.signMessage(new TextEncoder().encode(challenge.message));
    const verified = await this.send<{ token: string }>('POST', '/auth/verify', {
      wallet: wallet.address,
      nonce: challenge.nonce,
      signature: toBase64(signature),
    });
    this.token = { wallet: wallet.address, value: verified.token };
    return verified.token;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, signedIn = true): Promise<T> {
    if (!signedIn) return this.send<T>(method, path, body);
    const token = await this.authorize();
    try {
      return await this.send<T>(method, path, body, token);
    } catch (error) {
      if (!(error instanceof MissionApiError) || error.code !== 'unauthorized') throw error;
    }
    // The token expired or the server restarted with a new secret: sign in once more.
    return this.send<T>(method, path, body, await this.authorize(true));
  }

  private async send<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    let response: Response;
    try {
      response = await this.call(this.options.baseUrl + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new MissionApiError('unavailable', 'the mission server could not be reached');
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const failure = payload as { error?: unknown; message?: unknown } | null;
      throw new MissionApiError(
        typeof failure?.error === 'string' ? failure.error : 'unavailable',
        typeof failure?.message === 'string' ? failure.message : undefined,
      );
    }
    return payload as T;
  }
}
