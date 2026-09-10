import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../../src/util/retry.js';

describe('withRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 5,
      isRetryable: () => true,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries retryable failures up to maxAttempts then throws', async () => {
    const fn = vi.fn(async () => {
      throw new Error('transient');
    });
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5, isRetryable: () => true }),
    ).rejects.toThrow('transient');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-retryable error', async () => {
    const fn = vi.fn(async () => {
      throw new Error('fatal');
    });
    await expect(
      withRetry(fn, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5, isRetryable: () => false }),
    ).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('succeeds after a transient failure', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 2) throw new Error('transient');
      return 'recovered';
    });
    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 5,
      isRetryable: () => true,
    });
    expect(result).toBe('recovered');
  });

  it('aborts the retry delay when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn(async () => {
      throw new Error('transient');
    });
    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 2000,
        signal: controller.signal,
        isRetryable: () => true,
      }),
    ).rejects.toThrow();
  });
});
