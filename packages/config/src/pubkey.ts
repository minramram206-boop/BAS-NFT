/** Structural checks for Solana public keys, without a Solana SDK dependency. */

/** Base58 alphabet used by Solana public keys (no 0, O, I, l). */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** A 32 byte public key encodes to 43 or 44 base58 characters. */
export const PUBKEY_LENGTH_RANGE = { min: 43, max: 44 } as const;

/** Solana public keys are always 32 bytes. */
export const PUBLIC_KEY_BYTES = 32;

function isBase58(value: string): boolean {
  return value.length > 0 && [...value].every((character) => BASE58_ALPHABET.includes(character));
}

function hasValidPublicKeyLength(value: string): boolean {
  return value.length >= PUBKEY_LENGTH_RANGE.min && value.length <= PUBKEY_LENGTH_RANGE.max;
}

/**
 * Decoded byte length of a base58 string.
 *
 * Leading `1` characters are the base58 encoding of leading zero bytes and
 * carry no value, so they have to be counted separately.
 */
function decodedByteLength(value: string): number {
  let leadingZeros = 0;
  for (const character of value) {
    if (character !== BASE58_ALPHABET[0]) break;
    leadingZeros += 1;
  }

  let bits = 0n;
  for (const character of value) {
    bits = bits * 58n + BigInt(BASE58_ALPHABET.indexOf(character));
  }
  let significantBytes = 0;
  while (bits > 0n) {
    bits >>= 8n;
    significantBytes += 1;
  }
  return leadingZeros + significantBytes;
}

/** Base58, 43-44 characters and exactly 32 bytes once decoded. */
export function isWellFormedPublicKey(value: string): boolean {
  return isBase58(value) && hasValidPublicKeyLength(value) && decodedByteLength(value) === PUBLIC_KEY_BYTES;
}
