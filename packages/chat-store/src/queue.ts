import { createHash } from 'node:crypto';
import { Queue, type ConnectionOptions } from 'bullmq';
import { z } from 'zod';

export const CHAT_QUEUE = 'bas-chat-upkeep';

const Wallet = z.string().min(32).max(44);

/** Jobs the chat server and the mission side hand to the worker. */
export const JobSchemas = {
  /** Rewrite one owner's long private summary. */
  consolidate: z.object({ asset: Wallet, owner: Wallet, citizenName: z.string().min(1).max(60) }).strict(),
  /** Add one line to the asset's public history, from a verified event. */
  'public-line': z.object({ asset: Wallet, eventKey: z.string().min(1).max(80), line: z.string().min(1).max(200) }).strict(),
} as const;

export type JobName = keyof typeof JobSchemas;
export type JobData<N extends JobName> = z.infer<(typeof JobSchemas)[N]>;

/** Returns the validated payload, or `null` for a job this version does not understand. */
export function parseJob<N extends JobName>(name: N, data: unknown): JobData<N> | null {
  const parsed = JobSchemas[name].safeParse(data);
  return parsed.success ? (parsed.data as JobData<N>) : null;
}

/**
 * A job id for a free-text key. BullMQ refuses ':' in custom ids, and a key is free
 * text, so the id carries a hash of it: the same key always gives the same id.
 */
function eventId(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

export interface UpkeepQueue {
  /**
   * One pending rewrite per owner at a time: asking again while one is waiting
   * does nothing. A finished job is removed, so a later rewrite can be queued.
   */
  enqueueConsolidation(data: JobData<'consolidate'>): Promise<void>;
  /** Idempotent by event key: the same event added twice produces one line. */
  enqueuePublicLine(data: JobData<'public-line'>): Promise<void>;
  close(): Promise<void>;
}

/**
 * BullMQ waits for the connection before it sends a command, and that wait has no
 * limit of its own. A caller that must not hang (a claim being confirmed) would sit
 * there for as long as Redis is down, so the wait is cut short.
 */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the job queue did not answer within ${ms} ms`)), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

export interface UpkeepQueueOptions {
  /** How long adding a job may take before it is given up on. Default 3000. */
  readonly addTimeoutMs?: number;
}

export function createUpkeepQueue(connection: ConnectionOptions, options: UpkeepQueueOptions = {}): UpkeepQueue {
  const addTimeoutMs = options.addTimeoutMs ?? 3_000;
  const queue = new Queue(CHAT_QUEUE, {
    connection,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
  });
  return {
    async enqueueConsolidation(data) {
      JobSchemas.consolidate.parse(data);
      const jobId = `consolidate-${eventId(`${data.asset}|${data.owner}`)}`;
      await within(queue.add('consolidate', data, { jobId, removeOnComplete: true, removeOnFail: true }), addTimeoutMs);
    },
    async enqueuePublicLine(data) {
      JobSchemas['public-line'].parse(data);
      const jobId = `line-${data.asset}-${eventId(data.eventKey)}`;
      await within(queue.add('public-line', data, { jobId, removeOnComplete: true }), addTimeoutMs);
    },
    close: () => queue.close(),
  };
}
