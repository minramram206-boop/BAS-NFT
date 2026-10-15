import { type UpkeepQueue, ServiceUnreachableError, checkRedis, createRedis, createUpkeepQueue } from '@bas/chat-store';

/**
 * The queue that carries confirmed missions to the chat worker, or `undefined` when
 * there is none. Missions work without the history lines, so a Redis that is not
 * configured or not answering must not keep the server from starting.
 */
export async function openUpkeep(url: string | undefined, log: Pick<Console, 'log' | 'warn'> = console): Promise<UpkeepQueue | undefined> {
  if (!url) {
    log.log('[mission-server] REDIS_URL is not set: public history lines are not queued');
    return undefined;
  }
  const redis = createRedis(url, { commandTimeoutMs: 3_000 });
  try {
    await checkRedis(redis, url);
  } catch (error) {
    redis.disconnect();
    if (!(error instanceof ServiceUnreachableError)) throw error;
    log.warn(`[mission-server] ${error.message} Public history lines are not queued until the server is restarted.`);
    return undefined;
  }
  return createUpkeepQueue(redis);
}
