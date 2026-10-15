/**
 * Memory of a citizen (SPEC v2 section 11). Two kinds, kept apart on purpose:
 *
 * - public history, keyed by asset, follows the NFT to any new owner;
 * - private relationship memory, keyed by asset and owner wallet, is never
 *   readable by anyone else, so a sale starts the new owner with nothing.
 */

export interface PrivateMemory {
  readonly nickname: string | null;
  /** A short summary, not a transcript. Raw transcripts are not stored. */
  readonly summary: string | null;
  readonly updatedAt: number;
}

export const publicMemoryKey = (asset: string): string => `public_character_memory:${asset}`;
export const privateMemoryKey = (asset: string, owner: string): string =>
  `private_relationship_memory:${asset}:${owner}`;

/** Public lines the prompt carries at most; older ones stay stored but are not sent. */
export const PUBLIC_HISTORY_LINES = 20;
export const MAX_PUBLIC_LINE_CHARS = 200;

export interface MemoryStore {
  /** The latest public lines of the asset, oldest first. */
  publicHistory(asset: string): Promise<readonly string[]>;
  /**
   * Appends one public line written from a verified event. `eventKey` makes the
   * write idempotent, so a retried job does not repeat the line. Returns false
   * when the key was already used.
   */
  addPublicLine(asset: string, eventKey: string, line: string, at: number): Promise<boolean>;
  /** Reads the memory of `owner` with this asset; another owner's record is never returned. */
  privateMemory(asset: string, owner: string): Promise<PrivateMemory | null>;
  savePrivateMemory(asset: string, owner: string, memory: PrivateMemory): Promise<void>;
  /**
   * Replaces the summary only if the record is still the one that was read
   * (`expectedUpdatedAt`), so a summary written by the worker never wipes a fact
   * the owner added meanwhile. Returns false when the record has moved on.
   */
  replaceSummary(asset: string, owner: string, expectedUpdatedAt: number, summary: string, at: number): Promise<boolean>;
  /** The previous owner asked for deletion (SPEC v2 section 11.3). */
  deletePrivateMemory(asset: string, owner: string): Promise<void>;
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly publicLines = new Map<string, { eventKey: string; line: string }[]>();
  private readonly privateRecords = new Map<string, PrivateMemory>();

  async publicHistory(asset: string): Promise<readonly string[]> {
    return (this.publicLines.get(publicMemoryKey(asset)) ?? []).slice(-PUBLIC_HISTORY_LINES).map((entry) => entry.line);
  }

  async addPublicLine(asset: string, eventKey: string, line: string, _at: number): Promise<boolean> {
    const key = publicMemoryKey(asset);
    const lines = this.publicLines.get(key) ?? [];
    if (lines.some((entry) => entry.eventKey === eventKey)) return false;
    this.publicLines.set(key, [...lines, { eventKey, line }]);
    return true;
  }

  async replaceSummary(asset: string, owner: string, expectedUpdatedAt: number, summary: string, at: number): Promise<boolean> {
    const key = privateMemoryKey(asset, owner);
    const current = this.privateRecords.get(key);
    if (!current || current.updatedAt !== expectedUpdatedAt) return false;
    this.privateRecords.set(key, { ...current, summary, updatedAt: at });
    return true;
  }

  async privateMemory(asset: string, owner: string): Promise<PrivateMemory | null> {
    return this.privateRecords.get(privateMemoryKey(asset, owner)) ?? null;
  }

  async savePrivateMemory(asset: string, owner: string, memory: PrivateMemory): Promise<void> {
    this.privateRecords.set(privateMemoryKey(asset, owner), memory);
  }

  async deletePrivateMemory(asset: string, owner: string): Promise<void> {
    this.privateRecords.delete(privateMemoryKey(asset, owner));
  }
}

/** Hard cap on the stored summary. Past `CONSOLIDATE_AT` the worker rewrites it shorter. */
export const MAX_SUMMARY_CHARS = 600;
export const CONSOLIDATE_AT = 400;

/** What a model writes for a nickname request: "Likes to be called Boss", "The owner prefers to be called bos". */
const NICKNAME_PHRASE = /\b(?:likes?|prefers?|wants?)\s+to be called\s+["\u201c']?([^\s"\u201c\u201d',;.!]+(?:\s[^\s"\u201c\u201d',;.!]+)?)$/i;
const NICKNAME_LABEL = /^nickname:?\s+(.{1,40})$/i;

/** Lower case, letters and digits only, single spaces: two phrasings of one fact compare equal. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Folds one fact the model proposed into the owner's private memory. A fact that
 * looks like a nickname request becomes the nickname; anything else extends the
 * summary, which is trimmed from the front so recent facts survive. A fact the
 * memory already holds changes nothing, so a model that repeats it every turn
 * does not fill the notes with copies.
 */
export function mergeCandidate(current: PrivateMemory | null, candidate: string, now: number): PrivateMemory {
  const fact = candidate.replace(/\s+/g, ' ').trim();
  const bare = fact.replace(/["\u201c\u201d'.!\s]+$/u, '');
  const nickname = (NICKNAME_PHRASE.exec(bare)?.[1] ?? NICKNAME_LABEL.exec(bare)?.[1])?.trim() ?? null;
  if (nickname && nickname.length <= 40) {
    return { nickname, summary: current?.summary ?? null, updatedAt: nickname === current?.nickname ? (current?.updatedAt ?? now) : now };
  }
  const known = normalise(current?.summary ?? '');
  const wanted = normalise(fact);
  if (current && (wanted === '' || known.includes(wanted))) return current;
  const joined = [current?.summary, fact].filter((part): part is string => Boolean(part)).join(' ');
  const summary = joined.length > MAX_SUMMARY_CHARS ? joined.slice(joined.length - MAX_SUMMARY_CHARS) : joined;
  return { nickname: current?.nickname ?? null, summary, updatedAt: now };
}
