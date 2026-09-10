import type { Redis } from 'ioredis';
import type { CircuitBreakerState, CircuitBreakerStore } from './circuit-breaker.js';
import { initialCircuitBreakerState } from './circuit-breaker.js';

/**
 * Shares one provider's circuit-breaker state across every replica via a
 * single Redis hash. `CircuitBreaker` itself is unaware this isn't the
 * in-memory store — same interface, same call sites.
 */
export class RedisCircuitBreakerStore implements CircuitBreakerStore {
  constructor(
    private readonly redis: Redis,
    private readonly providerId: string,
    private readonly keyPrefix = 'circuit',
  ) {}

  private get key(): string {
    return `${this.keyPrefix}:${this.providerId}`;
  }

  async get(): Promise<CircuitBreakerState> {
    const raw = await this.redis.get(this.key);
    if (!raw) return initialCircuitBreakerState();
    try {
      return JSON.parse(raw) as CircuitBreakerState;
    } catch {
      return initialCircuitBreakerState();
    }
  }

  async set(state: CircuitBreakerState): Promise<void> {
    // Long TTL, not correctness-critical: a stale key just means the
    // breaker "forgets" a very old, otherwise-abandoned circuit and starts
    // CLOSED again, which is always the safe default.
    await this.redis.set(this.key, JSON.stringify(state), 'EX', 86_400);
  }
}
