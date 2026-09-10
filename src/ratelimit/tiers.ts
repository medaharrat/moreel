export interface RateLimitTierConfig {
  rateLimitAnonymousRpm: number;
  rateLimitFreeRpm: number;
}

/**
 * Unauthenticated traffic gets the tightest limit; authenticated accounts
 * get a bit more. "Internal/provider" limits are the separate
 * `INSTAGRAM_*` config in `src/providers/protection/` — a customer's HTTP
 * rate limit is deliberately independent from how hard Moreel is allowed to
 * hit Instagram, so no single customer can be the one consuming all
 * available provider capacity.
 */
export type RateLimitTierName = 'anonymous' | 'free';

export function resolveTierLimit(config: RateLimitTierConfig, tier: RateLimitTierName): number {
  switch (tier) {
    case 'anonymous':
      return config.rateLimitAnonymousRpm;
    case 'free':
      return config.rateLimitFreeRpm;
  }
}
