import { type ConsolidationResult, type MemoryStore } from '@bas/ai';
import { type JobName, parseJob } from '@bas/chat-store';

export interface UpkeepDeps {
  readonly memory: MemoryStore;
  readonly consolidate: (asset: string, owner: string, citizenName: string) => Promise<ConsolidationResult>;
  readonly now?: () => number;
}

/** A job this worker version cannot read. Retrying cannot help, so the queue should drop it. */
export class UnreadableJobError extends Error {
  constructor(name: string) {
    super(`unreadable ${name} job`);
    this.name = 'UnreadableJobError';
  }
}

/**
 * One unit of upkeep. A model hiccup during a rewrite ends as 'failed' and is
 * not retried: the summary is only a convenience, and the owner's next message
 * queues another rewrite.
 */
export async function runJob(deps: UpkeepDeps, name: string, data: unknown): Promise<string> {
  const now = deps.now ?? Date.now;
  switch (name as JobName) {
    case 'consolidate': {
      const job = parseJob('consolidate', data);
      if (!job) throw new UnreadableJobError(name);
      return deps.consolidate(job.asset, job.owner, job.citizenName);
    }
    case 'public-line': {
      const job = parseJob('public-line', data);
      if (!job) throw new UnreadableJobError(name);
      return (await deps.memory.addPublicLine(job.asset, job.eventKey, job.line, now())) ? 'added' : 'duplicate';
    }
    default:
      throw new UnreadableJobError(name);
  }
}
