import type { CircuitBreaker } from './circuit-breaker.js';

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'blocked' | 'disabled';

export interface ProviderHealth {
  status: ProviderHealthStatus;
}

/**
 * Derives a provider's externally-visible health from its circuit breaker
 * plus an independent, config-driven kill switch. The kill switch exists so
 * an operator can disable a provider immediately (e.g. a legal request, or
 * a suspected block worse than the breaker has detected yet) without
 * waiting for failures to accumulate, and without touching MCP, auth, or
 * any other provider.
 */
export class ProviderHealthTracker {
  constructor(
    private readonly circuitBreaker: CircuitBreaker,
    private readonly isDisabled: () => boolean,
  ) {}

  async getHealth(): Promise<ProviderHealth> {
    if (this.isDisabled()) {
      return { status: 'disabled' };
    }
    switch (await this.circuitBreaker.getState()) {
      case 'OPEN':
        return { status: 'blocked' };
      case 'HALF_OPEN':
        return { status: 'degraded' };
      case 'CLOSED':
      default:
        return { status: 'healthy' };
    }
  }
}
