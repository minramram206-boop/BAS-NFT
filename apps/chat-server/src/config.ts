import { type ChatConfig, loadChatConfig } from '@bas/ai';
import { type DistrictNetworkConfig, getNetworkConfig } from '@bas/config';

export interface ServerConfig {
  readonly network: DistrictNetworkConfig;
  readonly tokenSecret: Buffer;
  readonly chat: ChatConfig;
  readonly siteUrl: string | undefined;
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  /** Postgres. Without it, memory, quota and budget live in this process only. */
  readonly databaseUrl: string | undefined;
  /** Redis. Without it, conversations and locks live in this process only. */
  readonly redisUrl: string | undefined;
}

function port(env: NodeJS.ProcessEnv): number {
  const raw = env.CHAT_PORT;
  if (raw === undefined || raw === '') return 8788;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error('[chat-server] CHAT_PORT must be a port number');
  return value;
}

/**
 * Reads the server settings from the environment. The token secret is the
 * mission server's, because the web app signs in once and uses the same token
 * for both. Mainnet refuses to start on process-local storage: a restart would
 * hand every owner a fresh quota and an empty memory.
 */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const network = getNetworkConfig(env.BAS_NETWORK);
  const tokenSecret = Buffer.from(env.MISSION_TOKEN_SECRET ?? '', 'hex');
  if (tokenSecret.length < 32) throw new Error('[chat-server] MISSION_TOKEN_SECRET must be 64 hex characters or more');

  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  const redisUrl = env.REDIS_URL?.trim() || undefined;
  if (network.cluster === 'mainnet-beta' && (!databaseUrl || !redisUrl)) {
    throw new Error('[chat-server] mainnet needs DATABASE_URL and REDIS_URL');
  }

  return {
    network,
    tokenSecret,
    chat: loadChatConfig(env),
    siteUrl: env.CHAT_SITE_URL?.trim() || undefined,
    port: port(env),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',').map((origin) => origin.trim()),
    databaseUrl,
    redisUrl,
  };
}
