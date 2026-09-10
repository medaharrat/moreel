import crypto from 'node:crypto';
import { loadConfig } from '../config/index.js';

const config = loadConfig(process.env as Record<string, string | undefined>);

/**
 * Pseudonymize an identifier using HMAC-SHA256 and an application-level salt.
 * The salt is derived from `ANALYTICS_SALT` env var; if unset, a fallback
 * deterministic value is used (acceptable for local/testing only).
 */
export function pseudonymizeId(id: string): string {
  const salt = process.env.ANALYTICS_SALT ?? `local-fallback-${config.otelServiceName}`;
  return crypto.createHmac('sha256', salt).update(String(id)).digest('hex').slice(0, 16);
}

export function pseudonymizeEmail(email: string): string {
  // simple: hash the normalized lower-case email
  return pseudonymizeId(email.trim().toLowerCase());
}

export default { pseudonymizeId, pseudonymizeEmail };
