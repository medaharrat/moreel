import { ErrorCode, MoreelError } from '../../domain/errors.js';
import type { VideoAsset } from '../../domain/transcript.js';
import { recordProviderOutcome } from '../../observability/provider-metrics.js';
import type { Metrics } from '../../observability/metrics.js';
import { Semaphore } from '../../util/semaphore.js';
import { withRetry } from '../../util/retry.js';
import type { FetchOptions, VideoProvider } from '../provider.js';
import { CircuitBreaker, type CircuitBreakerStore } from './circuit-breaker.js';
import { InFlightDedup } from './dedup.js';
import { ProviderHealthTracker, type ProviderHealth } from './provider-health.js';
import { classifyProviderError, isProviderCausedFailure } from './response-classifier.js';
import { TokenBucket } from './token-bucket.js';

export interface ProtectedProviderOptions {
  provider: VideoProvider;
  metrics: Metrics;
  maxConcurrency: number;
  requestsPerSecond: number;
  cooldownMs: number;
  maxRetries: number;
  circuitFailureThreshold: number;
  /** Config-driven kill switch, independent of the circuit breaker's own state. */
  isDisabled: () => boolean;
  /** Injects a Redis-backed store to share breaker state across replicas; defaults to in-memory. */
  circuitBreakerStore?: CircuitBreakerStore;
}

/**
 * Wraps any `VideoProvider` with the provider-protection layer: response
 * classification, a circuit breaker, provider-scoped concurrency and
 * rate limiting, bounded retries, request dedup, and metrics — without
 * changing the `VideoProvider` interface or the wrapped provider's own
 * code. A future second provider gets the same protection for free by
 * being wrapped the same way.
 *
 * No part of this ever increases traffic to a struggling provider: retries
 * are bounded and only for classifications that indicate a transient
 * hiccup, the circuit breaker only ever reduces call frequency once it
 * opens, and there is no fallback path that tries harder when blocked.
 */
export class ProtectedProvider implements VideoProvider {
  readonly id: string;
  private readonly semaphore: Semaphore;
  private readonly tokenBucket: TokenBucket;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly healthTracker: ProviderHealthTracker;
  private readonly dedup = new InFlightDedup<VideoAsset>();

  constructor(private readonly options: ProtectedProviderOptions) {
    this.id = options.provider.id;
    this.semaphore = new Semaphore(options.maxConcurrency);
    this.tokenBucket = new TokenBucket(options.requestsPerSecond);
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: options.circuitFailureThreshold,
      cooldownMs: options.cooldownMs,
      ...(options.circuitBreakerStore ? { store: options.circuitBreakerStore } : {}),
    });
    this.healthTracker = new ProviderHealthTracker(this.circuitBreaker, options.isDisabled);
  }

  canHandle(url: URL): boolean {
    return this.options.provider.canHandle(url);
  }

  contentId(url: URL): string | undefined {
    return this.options.provider.contentId?.(url);
  }

  async getHealth(): Promise<ProviderHealth> {
    return this.healthTracker.getHealth();
  }

  async fetch(url: URL, fetchOptions: FetchOptions): Promise<VideoAsset> {
    if (this.options.isDisabled()) {
      throw new MoreelError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        `The ${this.id} provider is currently disabled.`,
        { details: { provider: this.id } },
      );
    }

    // Dedup key is the raw URL; the caller (TranscriptionService) already
    // normalizes for its own cache lookup, this just collapses concurrent
    // identical in-flight fetches within this one replica.
    return this.dedup.run(url.toString(), () =>
      withRetry(() => this.attempt(url, fetchOptions), {
        maxAttempts: this.options.maxRetries + 1,
        baseDelayMs: 300,
        maxDelayMs: 4_000,
        signal: fetchOptions.signal,
        isRetryable: (error) => {
          const classification = classifyProviderError(error);
          return classification === 'transient' || classification === 'rate_limited';
        },
      }),
    );
  }

  private async attempt(url: URL, fetchOptions: FetchOptions): Promise<VideoAsset> {
    await this.circuitBreaker.assertCanExecute(this.id);

    if (!this.tokenBucket.tryTake()) {
      throw new MoreelError(ErrorCode.RATE_LIMITED, undefined, {
        details: { provider: this.id, reason: 'provider_requests_per_second_exceeded' },
      });
    }

    return this.semaphore.runOrReject(() => this.callAndRecord(url, fetchOptions));
  }

  private async callAndRecord(url: URL, fetchOptions: FetchOptions): Promise<VideoAsset> {
    const start = performance.now();
    try {
      const result = await this.options.provider.fetch(url, fetchOptions);
      await this.circuitBreaker.recordSuccess();
      recordProviderOutcome(this.options.metrics, this.id, 'success', performance.now() - start);
      return result;
    } catch (error) {
      const classification = classifyProviderError(error);
      recordProviderOutcome(this.options.metrics, this.id, classification, performance.now() - start);
      if (isProviderCausedFailure(classification)) {
        await this.circuitBreaker.recordFailure();
      }
      throw error;
    }
  }
}
