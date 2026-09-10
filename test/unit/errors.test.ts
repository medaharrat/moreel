import { describe, expect, it } from 'vitest';
import { ErrorCode, isMoreelError, MoreelError, toMoreelError } from '../../src/domain/errors.js';

describe('MoreelError', () => {
  it('uses a sensible default message per code', () => {
    const error = new MoreelError(ErrorCode.MEDIA_TOO_LARGE);
    expect(error.message).toMatch(/exceeds the configured maximum size/i);
  });

  it('marks retryable codes as retryable and others as not', () => {
    expect(new MoreelError(ErrorCode.RATE_LIMITED).retryable).toBe(true);
    expect(new MoreelError(ErrorCode.DOWNLOAD_FAILED).retryable).toBe(true);
    expect(new MoreelError(ErrorCode.INVALID_URL).retryable).toBe(false);
    expect(new MoreelError(ErrorCode.UNSUPPORTED_SOURCE).retryable).toBe(false);
  });

  it('never leaks internal cause details in the client view', () => {
    const internal = new Error('/etc/secret/path leaked; Authorization: Bearer sk-abc123');
    const error = new MoreelError(ErrorCode.DOWNLOAD_FAILED, undefined, { cause: internal });
    const clientView = error.toClientView();

    expect(JSON.stringify(clientView)).not.toContain('/etc/secret/path');
    expect(JSON.stringify(clientView)).not.toContain('sk-abc123');
    expect(clientView).toEqual({
      code: 'DOWNLOAD_FAILED',
      message: error.message,
      retryable: true,
    });
  });

  it('includes safe details when provided', () => {
    const error = new MoreelError(ErrorCode.MEDIA_TOO_LONG, undefined, {
      details: { durationSeconds: 900, maxDurationSeconds: 600 },
    });
    expect(error.toClientView().details).toEqual({ durationSeconds: 900, maxDurationSeconds: 600 });
  });
});

describe('toMoreelError', () => {
  it('passes through an existing MoreelError unchanged', () => {
    const original = new MoreelError(ErrorCode.CONTENT_UNAVAILABLE);
    expect(toMoreelError(original)).toBe(original);
  });

  it('wraps a plain Error as INTERNAL_ERROR by default', () => {
    const wrapped = toMoreelError(new Error('boom'));
    expect(wrapped.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(wrapped.cause).toBeInstanceOf(Error);
  });

  it('wraps a non-Error thrown value', () => {
    const wrapped = toMoreelError('a string was thrown');
    expect(wrapped.code).toBe(ErrorCode.INTERNAL_ERROR);
  });

  it('respects a custom fallback code', () => {
    const wrapped = toMoreelError(new Error('boom'), ErrorCode.TRANSCRIPTION_FAILED);
    expect(wrapped.code).toBe(ErrorCode.TRANSCRIPTION_FAILED);
  });
});

describe('isMoreelError', () => {
  it('type-guards correctly', () => {
    expect(isMoreelError(new MoreelError(ErrorCode.INVALID_URL))).toBe(true);
    expect(isMoreelError(new Error('plain'))).toBe(false);
    expect(isMoreelError(null)).toBe(false);
  });
});
