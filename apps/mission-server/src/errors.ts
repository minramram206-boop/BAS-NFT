/** Reasons the server refuses a request. The web app maps each one to its own copy. */
export type MissionErrorCode =
  | 'unauthorized'
  | 'bad-request'
  | 'not-owner'
  | 'citizen-not-found'
  | 'unknown-mission'
  | 'invalid-stat'
  | 'season-closed'
  | 'mission-closed'
  | 'district-locked'
  | 'citizen-busy'
  | 'mission-cooldown'
  | 'daily-limit'
  | 'no-session'
  | 'wrong-session'
  | 'steps-left'
  | 'wrong-step'
  | 'wrong-answer'
  | 'wrong-order'
  | 'too-fast'
  | 'claim-pending'
  | 'claim-missing'
  | 'mint-not-open'
  | 'sold-out'
  | 'mint-limit'
  | 'rate-limited'
  | 'unavailable';

const STATUS: Readonly<Record<MissionErrorCode, number>> = {
  unauthorized: 401,
  'bad-request': 400,
  'not-owner': 403,
  'citizen-not-found': 404,
  'unknown-mission': 404,
  'invalid-stat': 400,
  'season-closed': 409,
  'mission-closed': 409,
  'district-locked': 409,
  'citizen-busy': 409,
  'mission-cooldown': 409,
  'daily-limit': 409,
  'no-session': 404,
  'wrong-session': 409,
  'steps-left': 409,
  'wrong-step': 400,
  'wrong-answer': 422,
  'wrong-order': 422,
  'too-fast': 429,
  'claim-pending': 409,
  'claim-missing': 409,
  'mint-not-open': 409,
  'sold-out': 409,
  'mint-limit': 409,
  'rate-limited': 429,
  unavailable: 503,
};

export class MissionError extends Error {
  readonly code: MissionErrorCode;

  constructor(code: MissionErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'MissionError';
    this.code = code;
  }

  get status(): number {
    return STATUS[this.code];
  }
}
