import {
  ChatPortError,
  type ChatErrorCode,
  type ChatMemoryView,
  type ChatSendResult,
  type ChatStatusView,
} from '../chat';

/**
 * Typed client of the chat server (`apps/chat-server`). It uses the bearer
 * token of the mission server, which both servers accept, and asks for a fresh
 * one once when the server says the token is no longer good.
 */

export interface ChatApiOptions {
  /** Origin of the chat server, without a trailing slash. */
  readonly baseUrl: string;
  /** The wallet token; `force` signs in again. */
  readonly token: (force?: boolean) => Promise<string>;
  readonly fetch?: typeof fetch;
}

const CODES: readonly ChatErrorCode[] = [
  'not-owner',
  'citizen-not-found',
  'unauthorized',
  'rate-limited',
  'empty',
  'too-long',
  'bad-request',
];

export class ChatApi {
  private readonly options: ChatApiOptions;
  private readonly call: typeof fetch;

  constructor(options: ChatApiOptions) {
    this.options = options;
    this.call = options.fetch ?? ((...args) => fetch(...args));
  }

  status(asset: string): Promise<ChatStatusView & { citizen: { name: string } }> {
    return this.request('GET', `/chat/${asset}/status`);
  }

  send(asset: string, message: string): Promise<ChatSendResult> {
    return this.request('POST', `/chat/${asset}/messages`, { message });
  }

  memory(asset: string): Promise<ChatMemoryView> {
    return this.request('GET', `/chat/${asset}/memory`);
  }

  async forget(asset: string): Promise<void> {
    await this.request('DELETE', `/chat/${asset}/memory`);
  }

  private async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    try {
      return await this.transport<T>(method, path, body, await this.options.token());
    } catch (error) {
      if (!(error instanceof ChatPortError) || error.code !== 'unauthorized') throw error;
    }
    // The token expired or the servers restarted with a new secret: sign in once more.
    return this.transport<T>(method, path, body, await this.options.token(true));
  }

  private async transport<T>(method: string, path: string, body: unknown, token: string): Promise<T> {
    let response: Response;
    try {
      response = await this.call(this.options.baseUrl + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          authorization: `Bearer ${token}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ChatPortError('unavailable', 'the chat server could not be reached');
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const failure = payload as { error?: unknown; message?: unknown } | null;
      const code = CODES.find((known) => known === failure?.error) ?? 'unavailable';
      throw new ChatPortError(code, typeof failure?.message === 'string' ? failure.message : undefined);
    }
    return payload as T;
  }
}
