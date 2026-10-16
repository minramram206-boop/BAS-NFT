import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { RateLimiter, applyCors, readJsonBody, sendJson } from '@bas/server-kit';
import type { StatName } from './catalog.js';
import { Authenticator } from './auth.js';
import { MissionError } from './errors.js';
import type { MarketActivity } from './market.js';
import { SEEN_NOTICES_LIMIT, type SeenStore } from './market-seen.js';
import type { MintService } from './mint.js';
import { parseProof } from './rules.js';
import type { MissionService } from './service.js';

const MAX_BODY_BYTES = 4_096;
/** Room for a full list of seen notice ids, each a signature with a short prefix. */
const MAX_SEEN_BODY_BYTES = 32_768;
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const STATS: readonly string[] = ['intelligence', 'alignment', 'compute'];

export interface HttpOptions {
  readonly service: MissionService;
  readonly auth: Authenticator;
  /** The public sale. Without it `/mint/prepare` answers `unavailable`. */
  readonly mint?: MintService;
  /** Sales and bids read from the market program. Without it `/market/activity` is empty. */
  readonly market?: { activity(): MarketActivity };
  /** Market notices each wallet dismissed. Without it `/market/seen` keeps nothing. */
  readonly seen?: SeenStore;
  /** Origins of the web app; requests from others get no CORS headers. */
  readonly allowedOrigins: readonly string[];
  /** Requests per minute per client address. */
  readonly rateLimit?: number;
  readonly clock?: () => number;
}

type Body = Record<string, unknown>;

const readBody = (request: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Body> =>
  readJsonBody(request, limit, (message) => new MissionError('bad-request', message));

/** Notice ids as the web app makes them: a signature, or a short kind, a dash and a signature. */
function noticeIds(body: Body): string[] {
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length > SEEN_NOTICES_LIMIT) throw new MissionError('bad-request', 'ids must be a list');
  return ids.map((id) => {
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,120}$/.test(id)) throw new MissionError('bad-request', 'ids must be notice ids');
    return id;
  });
}

function text(body: Body, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new MissionError('bad-request', `${key} is missing`);
  }
  return value;
}

function stat(body: Body): StatName {
  const value = body.stat;
  if (typeof value !== 'string' || !STATS.includes(value)) throw new MissionError('invalid-stat');
  return value as StatName;
}

/** JSON API of the mission server. */
export function createMissionServer(options: HttpOptions): Server {
  const { service, auth } = options;
  const limiter = new RateLimiter(options.rateLimit ?? 120, options.clock ?? Date.now);

  const send = sendJson;

  const route = async (request: IncomingMessage, url: URL): Promise<{ status: number; payload: unknown }> => {
    const method = request.method ?? 'GET';
    const path = url.pathname;
    const bearer = request.headers.authorization?.replace(/^Bearer /, '');

    if (method === 'GET' && path === '/health') return { status: 200, payload: { ok: true } };

    if (method === 'GET' && path === '/season') return { status: 200, payload: service.season() };

    if (method === 'GET' && path === '/market/activity') {
      return { status: 200, payload: options.market?.activity() ?? { sales: [], bids: [] } };
    }

    // Read without sign-in: the ids only name sales and bids that are public on chain.
    if (method === 'GET' && path === '/market/seen') {
      const wallet = url.searchParams.get('wallet') ?? '';
      if (!WALLET.test(wallet)) throw new MissionError('bad-request', 'wallet is missing');
      return { status: 200, payload: { ids: (await options.seen?.list(wallet)) ?? [] } };
    }

    // Written only by the wallet itself, so nobody hides another wallet's notices.
    if (method === 'POST' && path === '/market/seen') {
      const wallet = auth.wallet(bearer);
      const ids = noticeIds(await readBody(request, MAX_SEEN_BODY_BYTES));
      await options.seen?.add(wallet, ids, (options.clock ?? Date.now)());
      return { status: 200, payload: { ids: (await options.seen?.list(wallet)) ?? [] } };
    }

    if (method === 'GET' && path === '/season/standings') {
      return { status: 200, payload: { standings: await service.standings() } };
    }

    if (method === 'POST' && path === '/auth/challenge') {
      const body = await readBody(request);
      const challenge = auth.challenge(text(body, 'wallet'));
      return { status: 200, payload: { nonce: challenge.nonce, message: challenge.message } };
    }

    if (method === 'POST' && path === '/auth/verify') {
      const body = await readBody(request);
      const signature = Buffer.from(text(body, 'signature'), 'base64');
      return { status: 200, payload: auth.redeem(text(body, 'wallet'), text(body, 'nonce'), signature) };
    }

    if (method === 'POST' && path === '/mint/prepare') {
      const wallet = auth.wallet(bearer);
      if (!options.mint) throw new MissionError('unavailable', 'the sale is not configured');
      return { status: 200, payload: await options.mint.prepare(wallet) };
    }

    const match = /^\/citizens\/([1-9A-HJ-NP-Za-km-z]{32,44})\/missions(?:\/([a-z]+))?$/.exec(path);
    if (!match) throw new MissionError('bad-request', 'unknown route');
    const asset = match[1] as string;
    const action = match[2];
    const wallet = auth.wallet(bearer);

    if (method === 'GET' && action === undefined) {
      return { status: 200, payload: await service.status(wallet, asset) };
    }
    if (method !== 'POST' || action === undefined) throw new MissionError('bad-request', 'unknown route');

    const body = await readBody(request);
    switch (action) {
      case 'start':
        return { status: 200, payload: await service.start(wallet, asset, text(body, 'missionId'), stat(body)) };
      case 'step': {
        const proof = parseProof(body.proof);
        if (!proof) throw new MissionError('bad-request', 'proof is not valid');
        return { status: 200, payload: await service.step(wallet, asset, text(body, 'missionId'), proof) };
      }
      case 'claim':
        return { status: 200, payload: await service.claim(wallet, asset, text(body, 'missionId')) };
      case 'confirm':
        return { status: 200, payload: await service.confirm(wallet, asset, text(body, 'missionId')) };
      case 'abandon':
        return { status: 200, payload: await service.abandon(wallet, asset) };
      default:
        throw new MissionError('bad-request', 'unknown route');
    }
  };

  return createServer((request, response) => {
    applyCors(request, response, options.allowedOrigins);
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }

    void (async () => {
      try {
        if (!limiter.allow(request.socket.remoteAddress ?? 'unknown')) throw new MissionError('rate-limited');
        const url = new URL(request.url ?? '/', 'http://localhost');
        const { status, payload } = await route(request, url);
        send(response, status, payload);
      } catch (error) {
        if (error instanceof MissionError) {
          send(response, error.status, { error: error.code, message: error.message });
          return;
        }
        // Chain or disk trouble: say so without leaking the cause.
        console.error('[mission-server]', error);
        send(response, 503, { error: 'unavailable', message: 'The server could not finish the request.' });
      }
    })();
  });
}
