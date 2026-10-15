import { z } from 'zod';

export const EMOTIONS = ['neutral', 'curious', 'happy', 'worried', 'thinking'] as const;
/** The animations a reply may ask for (SPEC v2 section 10.4). Anything else is invalid output. */
export const ANIMATIONS = ['idle', 'blink', 'look_left', 'look_right', 'happy', 'worried', 'thinking'] as const;

export const MAX_REPLY_CHARS = 400;
export const MAX_MEMORY_CANDIDATE_CHARS = 240;

export const CitizenReplySchema = z
  .object({
    reply: z.string().min(1).max(MAX_REPLY_CHARS),
    emotion: z.enum(EMOTIONS),
    animation: z.enum(ANIMATIONS),
    memoryCandidate: z.string().max(MAX_MEMORY_CANDIDATE_CHARS).nullable(),
    safety: z.enum(['ok', 'blocked']),
  })
  .strict();

export type CitizenReply = z.infer<typeof CitizenReplySchema>;

export type ParsedReply =
  | { readonly ok: true; readonly reply: CitizenReply }
  | { readonly ok: false; readonly reason: 'not-json' | 'schema' | 'blocked' | 'leak' };

/**
 * A marker the system prompt carries and no reply may contain. A reply that
 * repeats it has echoed the instructions, so it is dropped.
 */
export const PROMPT_CANARY = 'bas-canary-7f3a91';

/** Pulls the JSON object out of a model answer, tolerating a code fence around it. */
function extractJson(raw: string): unknown {
  const text = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  const body = fenced?.[1] ?? text;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

/** Validates a raw model answer against the strict reply schema. Never throws. */
export function parseReply(raw: string): ParsedReply {
  const value = extractJson(raw);
  if (value === undefined) return { ok: false, reason: 'not-json' };
  const parsed = CitizenReplySchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: 'schema' };
  if (parsed.data.safety === 'blocked') return { ok: false, reason: 'blocked' };
  const { reply, memoryCandidate } = parsed.data;
  if (reply.includes(PROMPT_CANARY) || memoryCandidate?.includes(PROMPT_CANARY)) return { ok: false, reason: 'leak' };
  return { ok: true, reply: parsed.data };
}
