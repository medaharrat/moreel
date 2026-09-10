import { ErrorCode, MoreelError } from '../../domain/errors.js';

export type CircuitStatus = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerState {
  status: CircuitStatus;
  consecutiveFailures: number;
  openedAt: number;
  /** Guards against multiple concurrent probes while HALF_OPEN. */
  halfOpenProbeInFlight: boolean;
}

/**
 * Where circuit state lives. Async because a distributed backend (Redis,
 * `RedisCircuitBreakerStore`) is inherently async; the in-memory default
 * just resolves immediately. A distributed store lets one breaker be
 * shared per provider across every replica without changing
 * `CircuitBreaker`'s logic — only its store.
 */
export interface CircuitBreakerStore {
  get(): Promise<CircuitBreakerState>;
  set(state: CircuitBreakerState): Promise<void>;
}

export function initialCircuitBreakerState(): CircuitBreakerState {
  return { status: 'CLOSED', consecutiveFailures: 0, openedAt: 0, halfOpenProbeInFlight: false };
}

export interface CircuitBreakerOptions {
  /** Consecutive provider-caused failures before the breaker opens. */
  failureThreshold: number;
  /** How long the breaker stays OPEN before allowing a HALF_OPEN probe. */
  cooldownMs: number;
  /** Injectable for deterministic tests; defaults to wall-clock time. */
  clock?: () => number;
  store?: CircuitBreakerStore;
}

/**
 * CLOSED -> (failureThreshold consecutive failures) -> OPEN
 * OPEN -> (cooldownMs elapsed) -> HALF_OPEN (single probe allowed)
 * HALF_OPEN -> (probe succeeds) -> CLOSED
 * HALF_OPEN -> (probe fails) -> OPEN (cooldown restarts)
 *
 * Deliberately has no "retry harder" path: every failure transition only
 * ever reduces how often the wrapped call is attempted, never increases it.
 */
export class CircuitBreaker {
  private readonly clock: () => number;
  private readonly store: CircuitBreakerStore;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.clock = options.clock ?? (() => Date.now());
    this.store = options.store ?? new InMemoryCircuitBreakerStore();
  }

  async getState(): Promise<CircuitStatus> {
    return (await this.transitionIfCooldownElapsed()).status;
  }

  /** Throws PROVIDER_UNAVAILABLE if the call should not be attempted right now. */
  async assertCanExecute(providerId: string): Promise<void> {
    const state = await this.transitionIfCooldownElapsed();

    if (state.status === 'OPEN') {
      throw this.unavailableError(providerId, state);
    }

    if (state.status === 'HALF_OPEN') {
      if (state.halfOpenProbeInFlight) {
        throw this.unavailableError(providerId, state);
      }
      await this.store.set({ ...state, halfOpenProbeInFlight: true });
    }
  }

  async recordSuccess(): Promise<void> {
    await this.store.set(initialCircuitBreakerState());
  }

  async recordFailure(): Promise<void> {
    const state = await this.store.get();
    const consecutiveFailures = state.consecutiveFailures + 1;

    if (state.status === 'HALF_OPEN' || consecutiveFailures >= this.options.failureThreshold) {
      await this.store.set({
        status: 'OPEN',
        consecutiveFailures,
        openedAt: this.clock(),
        halfOpenProbeInFlight: false,
      });
      return;
    }

    await this.store.set({ ...state, consecutiveFailures, halfOpenProbeInFlight: false });
  }

  private async transitionIfCooldownElapsed(): Promise<CircuitBreakerState> {
    const state = await this.store.get();
    if (state.status === 'OPEN' && this.clock() - state.openedAt >= this.options.cooldownMs) {
      const next: CircuitBreakerState = { ...state, status: 'HALF_OPEN', halfOpenProbeInFlight: false };
      await this.store.set(next);
      return next;
    }
    return state;
  }

  private unavailableError(providerId: string, state: CircuitBreakerState): MoreelError {
    const retryAfterMs = Math.max(0, this.options.cooldownMs - (this.clock() - state.openedAt));
    return new MoreelError(ErrorCode.PROVIDER_UNAVAILABLE, undefined, {
      details: { provider: providerId, retryAfterMs },
    });
  }
}

export class InMemoryCircuitBreakerStore implements CircuitBreakerStore {
  private state: CircuitBreakerState = initialCircuitBreakerState();

  async get(): Promise<CircuitBreakerState> {
    return this.state;
  }

  async set(state: CircuitBreakerState): Promise<void> {
    this.state = state;
  }
}
