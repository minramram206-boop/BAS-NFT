import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { ChatService, MemoryStore } from '@bas/ai';
import { RateLimiter, applyCors, readJsonBody, sendJson, verifyBearerToken } from '@bas/server-kit';
import type { CitizenDirectory } from './directory.js';
import { ChatError } from './errors.js';

const MAX_BODY_BYTES = 2_048;
const ASSET_ROUTE = /^\/chat\/([1-9A-HJ-NP-Za-km-z]{32,44})\/(status|messages|memory)$/;

export interface HttpOptions {
  readonly chat: ChatService;
  readonly directory: CitizenDirectory;
  readonly memory: MemoryStore;
  /** The secret the mission server signs its tokens with. */
  readonly tokenSecret: Buffer;
  /** Origins of the web app; requests from others get no CORS headers. */
  readonly allowedOrigins: readonly string[];
  /** Requests per minute per client address. */
  readonly rateLimit?: number;
  readonly clock?: () => number;
}

/**
 * JSON API of the chat server. Every route needs the wallet token. Reading or
 * writing a conversation also needs the wallet to hold the asset right now,
 * checked against the chain on every call. Memory routes only ever touch the
 * caller's own record, so a previous owner can still read or delete what they
 * told the citizen.
 */
export function createChatServer(options: HttpOptions): Server {
  const { chat, directory, memory } = options;
  const clock = options.clock ?? Date.now;
  const limiter = new RateLimiter(options.rateLimit ?? 60, clock);

  const wallet = (request: IncomingMessage): string => {
    const found = verifyBearerToken(options.tokenSecret, request.headers.authorization?.replace(/^Bearer /, ''), clock());
    if (!found) throw new ChatError('unauthorized');
    return found;
  };

  const ownedCitizen = async (asset: string, caller: string) => {
    const resolved = await directory.resolve(asset);
    if (!resolved) throw new ChatError('citizen-not-found');
    if (resolved.owner !== caller) throw new ChatError('not-owner');
    return resolved.citizen;
  };

  const route = async (request: IncomingMessage, url: URL): Promise<{ status: number; payload: unknown }> => {
    const method = request.method ?? 'GET';
    if (method === 'GET' && url.pathname === '/health') return { status: 200, payload: { ok: true } };

    const match = ASSET_ROUTE.exec(url.pathname);
    if (!match) throw new ChatError('bad-request', 'unknown route');
    const asset = match[1] as string;
    const action = match[2];
    const caller = wallet(request);

    if (action === 'status' && method === 'GET') {
      const citizen = await ownedCitizen(asset, caller);
      return { status: 200, payload: { citizen: { name: citizen.name }, ...(await chat.status(asset, caller)) } };
    }

    if (action === 'messages' && method === 'POST') {
      const citizen = await ownedCitizen(asset, caller);
      const body = await readJsonBody(request, MAX_BODY_BYTES, (message) => new ChatError('bad-request', message));
      if (typeof body.message !== 'string') throw new ChatError('bad-request', 'message is missing');
      const outcome = await chat.respond({ citizen, owner: caller, message: body.message });
      if (outcome.kind === 'rejected') throw new ChatError(outcome.reason);
      return { status: 200, payload: outcome };
    }

    if (action === 'memory' && method === 'GET') {
      const [mine, publicHistory] = await Promise.all([memory.privateMemory(asset, caller), memory.publicHistory(asset)]);
      return { status: 200, payload: { nickname: mine?.nickname ?? null, summary: mine?.summary ?? null, publicHistory } };
    }

    if (action === 'memory' && method === 'DELETE') {
      if (!(await chat.forget(asset, caller))) throw new ChatError('unavailable', 'a message is being answered; try again in a moment');
      return { status: 200, payload: { ok: true } };
    }

    throw new ChatError('bad-request', 'unknown route');
  };

  return createServer((request, response) => {
    applyCors(request, response, options.allowedOrigins, 'GET, POST, DELETE, OPTIONS');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }

    void (async () => {
      try {
        if (!limiter.allow(request.socket.remoteAddress ?? 'unknown')) throw new ChatError('rate-limited');
        const { status, payload } = await route(request, new URL(request.url ?? '/', 'http://localhost'));
        sendJson(response, status, payload);
      } catch (error) {
        if (error instanceof ChatError) {
          sendJson(response, error.status, { error: error.code, message: error.message });
          return;
        }
        // Chain or storage trouble: say so without leaking the cause.
        console.error('[chat-server]', error);
        sendJson(response, 503, { error: 'unavailable', message: 'The server could not finish the request.' });
      }
    })();
  });
}

export type { Server };
