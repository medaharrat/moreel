import { describe, expect, it } from 'vitest';
import { ErrorCode, MoreelError } from '../../../src/domain/errors.js';
import {
  classifyProviderError,
  isProviderCausedFailure,
} from '../../../src/providers/protection/response-classifier.js';

describe('classifyProviderError', () => {
  it('classifies a non-MoreelError as transient', () => {
    expect(classifyProviderError(new Error('boom'))).toBe('transient');
  });

  it('classifies RATE_LIMITED as rate_limited', () => {
    expect(classifyProviderError(new MoreelError(ErrorCode.RATE_LIMITED))).toBe('rate_limited');
  });

  it('classifies plain AUTHENTICATION_REQUIRED as auth_required', () => {
    expect(classifyProviderError(new MoreelError(ErrorCode.AUTHENTICATION_REQUIRED))).toBe(
      'auth_required',
    );
  });

  it('classifies AUTHENTICATION_REQUIRED with a block signal in the cause as blocked', () => {
    const error = new MoreelError(ErrorCode.AUTHENTICATION_REQUIRED, undefined, {
      cause: new Error('rate-limit reached for this IP'),
    });
    expect(classifyProviderError(error)).toBe('blocked');
  });

  it('classifies PROVIDER_UNAVAILABLE as blocked', () => {
    expect(classifyProviderError(new MoreelError(ErrorCode.PROVIDER_UNAVAILABLE))).toBe('blocked');
  });

  it.each([
    ErrorCode.CONTENT_UNAVAILABLE,
    ErrorCode.MEDIA_TOO_LARGE,
    ErrorCode.MEDIA_TOO_LONG,
    ErrorCode.INVALID_URL,
    ErrorCode.UNSUPPORTED_SOURCE,
  ])('classifies %s as permanent (not the provider\'s fault)', (code) => {
    expect(classifyProviderError(new MoreelError(code))).toBe('permanent');
  });

  it('classifies DOWNLOAD_FAILED as transient', () => {
    expect(classifyProviderError(new MoreelError(ErrorCode.DOWNLOAD_FAILED))).toBe('transient');
  });
});

describe('isProviderCausedFailure', () => {
  it('is true for rate_limited, auth_required, blocked, and transient', () => {
    expect(isProviderCausedFailure('rate_limited')).toBe(true);
    expect(isProviderCausedFailure('auth_required')).toBe(true);
    expect(isProviderCausedFailure('blocked')).toBe(true);
    expect(isProviderCausedFailure('transient')).toBe(true);
  });

  it('is false for success and permanent (a bad URL is not the provider failing)', () => {
    expect(isProviderCausedFailure('success')).toBe(false);
    expect(isProviderCausedFailure('permanent')).toBe(false);
  });
});
