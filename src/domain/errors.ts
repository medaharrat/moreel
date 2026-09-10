/**
 * Typed, deterministic error taxonomy for Moreel.
 *
 * Every failure mode the pipeline can produce maps to exactly one of these
 * codes. The MCP layer turns a MoreelError into a structured tool error
 * response; nothing below this boundary (stack traces, file paths, raw
 * provider output) is allowed to leak to the calling model. Server-side
 * logs get the full detail via `cause`/`details`.
 */
export const ErrorCode = {
  INVALID_URL: 'INVALID_URL',
  UNSUPPORTED_SOURCE: 'UNSUPPORTED_SOURCE',
  CONTENT_UNAVAILABLE: 'CONTENT_UNAVAILABLE',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  MEDIA_TOO_LARGE: 'MEDIA_TOO_LARGE',
  MEDIA_TOO_LONG: 'MEDIA_TOO_LONG',
  AUDIO_EXTRACTION_FAILED: 'AUDIO_EXTRACTION_FAILED',
  FRAME_EXTRACTION_FAILED: 'FRAME_EXTRACTION_FAILED',
  VISION_ANALYSIS_FAILED: 'VISION_ANALYSIS_FAILED',
  VIDEO_NOT_FOUND: 'VIDEO_NOT_FOUND',
  EMBEDDING_FAILED: 'EMBEDDING_FAILED',
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  TRANSCRIPTION_TIMEOUT: 'TRANSCRIPTION_TIMEOUT',
  RATE_LIMITED: 'RATE_LIMITED',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Human-readable, model-safe descriptions. No internals, ever. */
const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  INVALID_URL: 'The provided URL is not a valid, well-formed URL.',
  UNSUPPORTED_SOURCE:
    'The URL does not point to a supported provider. Only public Instagram Reel URLs are supported in this version.',
  CONTENT_UNAVAILABLE:
    'The requested content could not be found. It may be private, deleted, or region-restricted.',
  AUTHENTICATION_REQUIRED:
    'This content requires authentication to access and cannot be retrieved. Only publicly accessible content is supported.',
  DOWNLOAD_FAILED: 'The media could not be downloaded after multiple attempts.',
  MEDIA_TOO_LARGE: 'The media file exceeds the configured maximum size limit.',
  MEDIA_TOO_LONG: 'The video exceeds the configured maximum duration limit.',
  AUDIO_EXTRACTION_FAILED: 'Audio could not be extracted from the downloaded media.',
  FRAME_EXTRACTION_FAILED: 'Video frames could not be extracted for visual analysis.',
  VISION_ANALYSIS_FAILED: 'The vision provider failed to analyze the video frames.',
  VIDEO_NOT_FOUND:
    'No processed video was found for this id. It may have expired, or it was never processed — call transcribe_video or understand_video first.',
  EMBEDDING_FAILED:
    'The embedding provider failed to generate vectors for semantic search. Lexical search still works.',
  TRANSCRIPTION_FAILED: 'The transcription provider failed to produce a transcript.',
  TRANSCRIPTION_TIMEOUT: 'Transcription did not complete within the allotted time.',
  RATE_LIMITED: 'Too many requests are in flight. Please retry shortly.',
  REQUEST_TIMEOUT: 'The overall request exceeded the configured timeout.',
  INTERNAL_ERROR: 'An unexpected internal error occurred.',
  PROVIDER_UNAVAILABLE:
    'This provider is temporarily unavailable due to repeated failures. Please try again later.',
};

/** Whether a given error code represents a condition worth retrying later. */
export const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.DOWNLOAD_FAILED,
  ErrorCode.TRANSCRIPTION_FAILED,
  ErrorCode.TRANSCRIPTION_TIMEOUT,
  ErrorCode.RATE_LIMITED,
  ErrorCode.REQUEST_TIMEOUT,
  ErrorCode.INTERNAL_ERROR,
  ErrorCode.PROVIDER_UNAVAILABLE,
]);

export interface MoreelErrorOptions {
  /** Extra machine-readable context, safe to show to the model (e.g. limit values). */
  details?: Record<string, unknown>;
  /** Underlying error for server-side logs only. Never serialized to the client. */
  cause?: unknown;
}

/**
 * Base error type for all typed, expected failures in the pipeline.
 * Unexpected exceptions are wrapped as INTERNAL_ERROR at the service boundary.
 */
export class MoreelError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message?: string, options: MoreelErrorOptions = {}) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'MoreelError';
    this.code = code;
    this.details = options.details;
    this.retryable = RETRYABLE_CODES.has(code);
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  /** Model-safe, JSON-serializable representation. No stack traces or internals. */
  toClientView(): {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  } {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function isMoreelError(value: unknown): value is MoreelError {
  return value instanceof MoreelError;
}

/** Wrap an arbitrary caught value as a MoreelError, preserving typed errors as-is. */
export function toMoreelError(
  value: unknown,
  fallbackCode: ErrorCode = ErrorCode.INTERNAL_ERROR,
): MoreelError {
  if (isMoreelError(value)) {
    return value;
  }
  const cause = value instanceof Error ? value : new Error(String(value));
  return new MoreelError(fallbackCode, undefined, { cause });
}
