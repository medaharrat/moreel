import * as Sentry from '@sentry/node';

export interface ErrorContext {
  requestId?: string;
  provider?: string;
  environment?: string;
  version?: string;
}

/** Explicit allowlist — never a generic "attach everything" call. Everything else (API keys, cookies, raw media, transcripts) must never reach here. */
const ALLOWED_CONTEXT_KEYS: ReadonlyArray<keyof ErrorContext> = [
  'requestId',
  'provider',
  'environment',
  'version',
];

let initialized = false;

export function initErrorTracking(dsn: string | undefined): void {
  if (!dsn) return;
  Sentry.init({ dsn });
  initialized = true;
}

/**
 * Reports an exception with a strictly scrubbed context. Safe to call
 * whether or not Sentry is configured (`initErrorTracking` was a no-op) —
 * it just does nothing in that case, same as the rest of this codebase's
 * "inert until configured" pattern.
 */
export function captureException(error: unknown, context: ErrorContext = {}): void {
  if (!initialized) return;

  const scrubbedContext: Record<string, string> = {};
  for (const key of ALLOWED_CONTEXT_KEYS) {
    const value = context[key];
    if (value !== undefined) scrubbedContext[key] = value;
  }

  Sentry.captureException(error, { extra: scrubbedContext });
}
