/**
 * Framework-independent rate limiting: nothing here knows about Fastify or
 * HTTP. `src/http/middleware/rate-limit.ts` is the thin adapter that turns
 * this into 429s/headers.
 */
export interface RateLimitDecision {
  allowed: boolean;
  /** Requests remaining in the current window, floored at 0. */
  remaining: number;
  /** Epoch ms when the caller can expect a fresh allotment. */
  resetAt: number;
}

export interface RateLimiter {
  /** `key` identifies the caller (IP or account id); `limitPerMinute` is resolved from their tier. */
  checkLimit(key: string, limitPerMinute: number): Promise<RateLimitDecision>;
}
