import type { IncomingMessage, ServerResponse } from 'node:http';

/** Fixed-window counter per client address. Enough to blunt a loop, not a flood. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private readonly limit: number;
  private readonly clock: () => number;

  constructor(limit: number, clock: () => number = Date.now) {
    this.limit = limit;
    this.clock = clock;
  }

  allow(client: string): boolean {
    const now = this.clock();
    const window = this.windows.get(client);
    if (!window || now - window.start >= 60_000) {
      this.windows.set(client, { start: now, count: 1 });
      if (this.windows.size > 10_000) this.windows.clear();
      return true;
    }
    window.count += 1;
    return window.count <= this.limit;
  }
}

/**
 * Reads a small JSON object body. `fail` builds the error to throw, so each
 * server keeps its own error type and codes.
 */
export async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number,
  fail: (message: string) => Error,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw fail('body is too large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw fail('body is not a JSON object');
  }
}

/** CORS headers for an origin on the allow list. Requests from other origins get none. */
export function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: readonly string[],
  methods = 'GET, POST, OPTIONS',
): void {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) return;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'Origin');
  response.setHeader('access-control-allow-headers', 'authorization, content-type');
  response.setHeader('access-control-allow-methods', methods);
}

export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}
