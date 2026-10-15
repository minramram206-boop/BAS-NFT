import { type Conversation, type ConversationLock, type ConversationStore, SESSION_IDLE_MS } from '@bas/ai';
import { Redis } from 'ioredis';

export interface RedisOptions {
  /**
   * Fail a command that has not answered after this long. Without it, a command sent
   * while Redis is down waits for the connection to come back, and the request that
   * issued it hangs. Leave it unset for a BullMQ worker: its blocking reads wait on purpose.
   */
  readonly commandTimeoutMs?: number;
}

/** Redis connection for the chat. `maxRetriesPerRequest: null` is what BullMQ workers require. */
export function createRedis(url: string, options: RedisOptions = {}): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    ...(options.commandTimeoutMs === undefined ? {} : { commandTimeout: options.commandTimeoutMs }),
  });
}

const PREFIX = 'bas:chat';

/** Conversations expire with the idle gap, so nothing here is a transcript archive. */
export class RedisConversationStore implements ConversationStore {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async get(asset: string, owner: string): Promise<Conversation | null> {
    const raw = await this.redis.get(`${PREFIX}:conversation:${asset}:${owner}`);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Conversation;
      return typeof value.startedAt === 'number' && typeof value.lastAt === 'number' && Array.isArray(value.turns) ? value : null;
    } catch {
      return null;
    }
  }

  async put(asset: string, owner: string, conversation: Conversation): Promise<void> {
    await this.redis.set(`${PREFIX}:conversation:${asset}:${owner}`, JSON.stringify(conversation), 'PX', SESSION_IDLE_MS);
  }

  async delete(asset: string, owner: string): Promise<void> {
    await this.redis.del(`${PREFIX}:conversation:${asset}:${owner}`);
  }
}

const RELEASE_IF_MINE = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  end
  return 0`;

/** `SET NX PX` lock. The release only deletes the key if the lock is still the caller's own. */
export class RedisLock implements ConversationLock {
  private readonly redis: Redis;
  private sequence = 0;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async acquire(key: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
    const name = `${PREFIX}:lock:${key}`;
    this.sequence += 1;
    const token = `${process.pid}:${Date.now()}:${this.sequence}`;
    const taken = await this.redis.set(name, token, 'PX', ttlMs, 'NX');
    if (taken !== 'OK') return null;
    return async () => {
      await this.redis.eval(RELEASE_IF_MINE, 1, name, token);
    };
  }
}
