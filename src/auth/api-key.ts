import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/** Visible prefix so a key can be identified in logs/UIs without ever storing the secret. */
const KEY_PREFIX = 'moreel_live_';

export interface GeneratedApiKey {
  /** Full secret, shown to the caller exactly once at creation time. Never stored or logged. */
  secret: string;
  /** Short, non-secret prefix stored alongside the hash for identification/rotation UIs. */
  prefix: string;
  /** Argon2id hash of `secret`. Safe to persist. */
  hash: string;
}

export async function generateApiKey(): Promise<GeneratedApiKey> {
  const random = randomBytes(24).toString('base64url');
  const secret = `${KEY_PREFIX}${random}`;
  const prefix = secret.slice(0, KEY_PREFIX.length + 8);
  const hashed = await hashApiKeySecret(secret);
  return { secret, prefix, hash: hashed };
}

export function hashApiKeySecret(secret: string): Promise<string> {
  return hash(secret);
}

export function verifyApiKeySecret(secret: string, hashValue: string): Promise<boolean> {
  return verify(hashValue, secret);
}
