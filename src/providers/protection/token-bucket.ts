/**
 * In-process token bucket limiting outbound requests to a provider (e.g.
 * `INSTAGRAM_REQUESTS_PER_SECOND`). Only correct at one replica; a
 * Redis-backed version would be needed for multi-replica deployments. The
 * per-provider `INSTAGRAM_MAX_CONCURRENCY` semaphore alongside it provides
 * a coarser backstop in the meantime.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.tokens = ratePerSecond;
    this.lastRefillMs = clock();
  }

  /** True and consumes a token if one is available right now; false otherwise (never blocks). */
  tryTake(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private refill(): void {
    const now = this.clock();
    const elapsedSeconds = (now - this.lastRefillMs) / 1000;
    if (elapsedSeconds <= 0) return;
    this.tokens = Math.min(this.ratePerSecond, this.tokens + elapsedSeconds * this.ratePerSecond);
    this.lastRefillMs = now;
  }
}
