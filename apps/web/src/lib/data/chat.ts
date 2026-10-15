/**
 * Talking to a citizen. The chat server decides who may talk, how much and what
 * the citizen says; the web app only sends the owner's words and shows what
 * comes back. Mock mode has no chat, so `DistrictDataSource.chat` is absent there.
 */

export type ChatEmotion = 'neutral' | 'curious' | 'happy' | 'worried' | 'thinking';
export type ChatAnimation = 'idle' | 'blink' | 'look_left' | 'look_right' | 'happy' | 'worried' | 'thinking';

/** Why the citizen did not answer this time. The message goes back to the owner for every reason but `declined`. */
export type ChatUnavailableReason = 'disabled' | 'budget' | 'quota' | 'timeout' | 'invalid' | 'error' | 'busy';

export interface ChatStatusView {
  readonly enabled: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Milliseconds until the quota resets at the next UTC midnight. */
  readonly resetsInMs: number;
  readonly breakReminder: boolean;
}

export type ChatSendResult =
  | {
      readonly kind: 'reply';
      readonly reply: string;
      readonly emotion: ChatEmotion;
      readonly animation: ChatAnimation;
      readonly remaining: number;
      readonly breakReminder: boolean;
    }
  | { readonly kind: 'declined'; readonly remaining: number; readonly breakReminder: boolean }
  | {
      readonly kind: 'unavailable';
      readonly reason: ChatUnavailableReason;
      readonly remaining: number;
      readonly breakReminder: boolean;
      readonly quotaResetsInMs?: number;
    };

export interface ChatMemoryView {
  readonly nickname: string | null;
  readonly summary: string | null;
  readonly publicHistory: readonly string[];
}

export type ChatErrorCode =
  | 'not-connected'
  | 'not-owner'
  | 'citizen-not-found'
  | 'unauthorized'
  | 'rate-limited'
  | 'empty'
  | 'too-long'
  | 'bad-request'
  | 'declined'
  | 'unavailable';

/** The chat server refused the request, or could not be reached (`unavailable`). */
export class ChatPortError extends Error {
  readonly code: ChatErrorCode;

  constructor(code: ChatErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ChatPortError';
    this.code = code;
  }
}

/** What the screens use to talk to the citizens the connected wallet owns. */
export interface CitizenChatPort {
  status(citizenId: number): Promise<ChatStatusView>;
  send(citizenId: number, message: string): Promise<ChatSendResult>;
  /** What the citizen holds about this wallet, plus the public history that follows the NFT. */
  memory(citizenId: number): Promise<ChatMemoryView>;
  /** Forget what this wallet told the citizen. Public history stays. */
  forget(citizenId: number): Promise<void>;
}

/** Longest message the server accepts, in characters. */
export const MAX_CHAT_MESSAGE_CHARS = 300;
