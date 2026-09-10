/**
 * Collapses concurrent identical requests (same key, typically the
 * normalized URL) into one in-flight call, so N users hitting the same Reel
 * at once trigger one retrieval instead of N. In-memory and therefore only
 * correct within a single replica. A Redis-backed distributed lock
 * (`src/cache/redis-dedup-lock.ts`) can replace this to hold across
 * replicas too; until wired in, this is a partial mitigation, not a
 * guarantee, in a multi-replica deployment.
 */
export class InFlightDedup<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  async run(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = fn().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }
}
