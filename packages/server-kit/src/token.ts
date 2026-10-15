import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long a bearer token lasts after sign-in. */
export const SESSION_TTL_MS = 12 * 60 * 60_000;

function mac(secret: Buffer, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

/** A bearer token for `wallet`: a small signed claim, `<body>.<mac>`, both base64url. */
export function issueBearerToken(secret: Buffer, wallet: string, expiresAt: number): string {
  const body = Buffer.from(JSON.stringify({ w: wallet, exp: expiresAt })).toString('base64url');
  return `${body}.${mac(secret, body).toString('base64url')}`;
}

/**
 * The wallet a token was issued to, or `null` when the token is missing,
 * forged or expired. The mission server issues tokens and every other server
 * that shares `MISSION_TOKEN_SECRET` accepts them through this one function.
 */
export function verifyBearerToken(secret: Buffer, token: string | undefined, now: number): string | null {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = mac(secret, body);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { w?: unknown; exp?: unknown };
    if (typeof claims.w !== 'string' || typeof claims.exp !== 'number' || claims.exp <= now) return null;
    return claims.w;
  } catch {
    return null;
  }
}
