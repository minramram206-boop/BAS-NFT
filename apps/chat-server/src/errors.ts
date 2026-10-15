/** Reasons the chat server refuses a request. The web app maps each one to its own copy. */
export type ChatErrorCode =
  | 'unauthorized'
  | 'bad-request'
  | 'not-owner'
  | 'citizen-not-found'
  | 'empty'
  | 'too-long'
  | 'rate-limited'
  | 'unavailable';

const STATUS: Readonly<Record<ChatErrorCode, number>> = {
  unauthorized: 401,
  'bad-request': 400,
  'not-owner': 403,
  'citizen-not-found': 404,
  empty: 400,
  'too-long': 400,
  'rate-limited': 429,
  unavailable: 503,
};

export class ChatError extends Error {
  readonly code: ChatErrorCode;

  constructor(code: ChatErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ChatError';
    this.code = code;
  }

  get status(): number {
    return STATUS[this.code];
  }
}
