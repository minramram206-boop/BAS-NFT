import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNetworkConfig, type DistrictNetworkConfig } from '@bas/config';
import { Keypair, PublicKey } from '@solana/web3.js';
import type { EventWindow, SeasonConfig } from './service.js';

export interface ServerConfig {
  readonly network: DistrictNetworkConfig;
  readonly programId: PublicKey;
  readonly collection: PublicKey;
  readonly authority: Keypair;
  readonly tokenSecret: Buffer;
  readonly season: SeasonConfig;
  readonly events: Readonly<Record<string, EventWindow>>;
  readonly storeFile: string;
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  /** Redis of the chat upkeep queue. Without it, confirmed missions leave no line in a citizen's public history. */
  readonly redisUrl?: string;
  /** Postgres that keeps the market history between starts. Without it the history lives in this process. */
  readonly databaseUrl?: string;
  /** The public sale, when `MINT_SIGNER_KEYPAIR_FILE` is set. */
  readonly mint?: {
    readonly signer: Keypair;
    /** Unix seconds; `undefined` means the sale is open as soon as the machine is loaded. */
    readonly opensAt?: number;
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`[mission-server] ${name} is not set`);
  return value;
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback?: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    if (fallback === undefined) throw new Error(`[mission-server] ${name} is not set`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`[mission-server] ${name} must be a whole number`);
  return value;
}

// dist/config.js sits in apps/mission-server/dist, three levels below the repository root.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Key and event files named with a relative path are read from the repository root, wherever the server is started. */
const fromRepoRoot = (file: string): string => resolve(REPO_ROOT, file);

/**
 * Reads the server settings from the environment. The key of the mission
 * authority comes from a file outside the repository, and it has to match
 * `missionAuthority` in the network manifest, because that is the key the
 * program accepts. The mint signer works the same way: its key file has to
 * match `mintSigner`, because that is the key the Candy Guard asks for.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const network = getNetworkConfig(env.BAS_NETWORK);
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(fromRepoRoot(required(env, 'MISSION_AUTHORITY_KEYPAIR_FILE')), 'utf8')) as number[]),
  );
  if (authority.publicKey.toBase58() !== network.missionAuthority) {
    throw new Error(
      `[mission-server] the key file is ${authority.publicKey.toBase58()} but the ${network.cluster} manifest expects ${network.missionAuthority}`,
    );
  }

  const tokenSecret = Buffer.from(required(env, 'MISSION_TOKEN_SECRET'), 'hex');
  if (tokenSecret.length < 32) throw new Error('[mission-server] MISSION_TOKEN_SECRET must be 64 hex characters or more');

  const events: Record<string, EventWindow> = env.MISSION_EVENTS_FILE
    ? (JSON.parse(readFileSync(fromRepoRoot(env.MISSION_EVENTS_FILE), 'utf8')) as Record<string, EventWindow>)
    : {};

  const mintKeyFile = env.MINT_SIGNER_KEYPAIR_FILE;
  let mint: ServerConfig['mint'];
  if (mintKeyFile) {
    const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(fromRepoRoot(mintKeyFile), 'utf8')) as number[]));
    if (signer.publicKey.toBase58() !== network.mintSigner) {
      throw new Error(
        `[mission-server] the mint key file is ${signer.publicKey.toBase58()} but the ${network.cluster} manifest expects ${network.mintSigner}`,
      );
    }
    const opensAt = env.MINT_OPENS_AT ? integer(env, 'MINT_OPENS_AT') : undefined;
    mint = opensAt === undefined ? { signer } : { signer, opensAt };
  }

  return {
    network,
    programId: new PublicKey(network.districtProgramId),
    collection: new PublicKey(network.coreCollection),
    authority,
    tokenSecret,
    season: {
      id: integer(env, 'SEASON_ID', 1),
      startsAt: integer(env, 'SEASON_STARTS_AT'),
      days: integer(env, 'SEASON_DAYS', 28),
    },
    events,
    storeFile: env.MISSION_STORE_FILE ?? './data/missions.json',
    port: integer(env, 'PORT', 8787),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',').map((origin) => origin.trim()),
    ...(env.REDIS_URL?.trim() ? { redisUrl: env.REDIS_URL.trim() } : {}),
    ...(env.DATABASE_URL?.trim() ? { databaseUrl: env.DATABASE_URL.trim() } : {}),
    ...(mint ? { mint } : {}),
  };
}
