export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  signal?: AbortSignal;
  isRetryable: (error: unknown) => boolean;
}

/** Bounded exponential backoff with full jitter. Never retries indefinitely, never retries non-retryable errors. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt >= options.maxAttempts;
      if (isLastAttempt || !options.isRetryable(error)) {
        throw error;
      }
      const exponential = options.baseDelayMs * 2 ** (attempt - 1);
      const capped = Math.min(exponential, options.maxDelayMs);
      const delayMs = Math.random() * capped;
      await sleep(delayMs, options.signal);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
