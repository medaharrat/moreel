import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Short, URL-friendly id for user-facing identifiers — transcript
 * permalinks, media stream paths — where a full UUID (36 chars) is
 * needlessly long to read/type/share. Not a security boundary: entropy
 * (62^8 ≈ 2×10^14 at the default length) is tuned for "won't collide by
 * chance at this app's scale", not "cryptographically unguessable". Internal
 * correlation ids (request tracing/logging) keep using UUIDs via
 * `newRequestId` — this is only for what a user actually sees.
 */
export function generateShortId(length = 8): string {
  const bytes = randomBytes(length);
  let id = '';
  for (let i = 0; i < length; i++) {
    id += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return id;
}
