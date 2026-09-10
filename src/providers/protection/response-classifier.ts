import { ErrorCode, MoreelError } from '../../domain/errors.js';

/**
 * What a provider call actually did, independent of the `ErrorCode` we
 * surface to the client. This is what the circuit breaker and provider
 * metrics key off — a bad user-supplied URL (`permanent`) must never trip
 * the same breaker as Instagram itself failing (`transient`/`blocked`),
 * since the former says nothing about the provider's health.
 */
export type ProviderClassification =
  | 'success'
  | 'rate_limited'
  | 'auth_required'
  | 'blocked'
  | 'transient'
  | 'permanent';

/** Classifications that indicate the provider itself is struggling — feed the circuit breaker. */
export function isProviderCausedFailure(classification: ProviderClassification): boolean {
  return (
    classification === 'rate_limited' ||
    classification === 'auth_required' ||
    classification === 'blocked' ||
    classification === 'transient'
  );
}

const BLOCK_SIGNAL_PATTERN = /rate-limit reached|blocked|restricted video|temporarily unavailable/i;

export function classifyProviderError(error: unknown): ProviderClassification {
  if (!(error instanceof MoreelError)) {
    return 'transient';
  }

  switch (error.code) {
    case ErrorCode.RATE_LIMITED:
      return 'rate_limited';
    case ErrorCode.AUTHENTICATION_REQUIRED: {
      const message = describeCause(error).toLowerCase();
      return BLOCK_SIGNAL_PATTERN.test(message) ? 'blocked' : 'auth_required';
    }
    case ErrorCode.CONTENT_UNAVAILABLE:
    case ErrorCode.MEDIA_TOO_LARGE:
    case ErrorCode.MEDIA_TOO_LONG:
    case ErrorCode.INVALID_URL:
    case ErrorCode.UNSUPPORTED_SOURCE:
      return 'permanent';
    case ErrorCode.PROVIDER_UNAVAILABLE:
      return 'blocked';
    default:
      return 'transient';
  }
}

function describeCause(error: MoreelError): string {
  if (error.cause instanceof Error) return `${error.message} ${error.cause.message}`;
  return error.message;
}
