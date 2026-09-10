import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RateLimiter } from '../../ratelimit/rate-limiter.js';
import type { RateLimitTierName } from '../../ratelimit/tiers.js';

export interface RateLimitMiddlewareOptions {
  limiter: RateLimiter;
  /**
   * Resolves the caller's tier and rate-limit key. Pass
   * `resolveAccountOrIpCaller` once API-key auth is active so authenticated
   * callers are limited by account, not shared IP (multiple legitimate
   * users can share one IP; that must not tighten their limit) — falls
   * back to `resolveAnonymousCaller` otherwise.
   */
  resolveCaller: (request: FastifyRequest) => { key: string; tier: RateLimitTierName };
  limitForTier: (tier: RateLimitTierName) => number;
  /** Paths exempt from rate limiting (health checks). */
  exemptPaths?: string[];
}

export function registerRateLimitMiddleware(
  app: FastifyInstance,
  options: RateLimitMiddlewareOptions,
): void {
  const exempt = options.exemptPaths ?? ['/health', '/ready', '/metrics'];

  // Exact match for static paths; prefix match (`/media/` under `/media`)
  // for routes with a dynamic segment.
  const isExempt = (path: string): boolean =>
    exempt.some((p) => path === p || path.startsWith(`${p}/`));

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isExempt(request.url.split('?')[0] ?? request.url)) return;

    const { key, tier } = options.resolveCaller(request);
    const limit = options.limitForTier(tier);

    let decision;
    try {
      decision = await options.limiter.checkLimit(key, limit);
    } catch (error) {
      // Fail open: a Redis outage must not turn rate limiting into a
      // total-outage amplifier. Losing rate-limit enforcement briefly is
      // an acceptable degradation; 500ing every request is not.
      request.log.warn({ err: error }, 'rate limiter unavailable, failing open');
      return;
    }

    reply.header('X-RateLimit-Limit', String(limit));
    reply.header('X-RateLimit-Remaining', String(decision.remaining));
    reply.header('X-RateLimit-Reset', String(Math.ceil(decision.resetAt / 1000)));

    if (!decision.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000));
      reply.header('Retry-After', String(retryAfterSeconds));
      reply.code(429);
      await reply.send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please retry after the indicated delay.',
          retryable: true,
        },
      });
    }
  });
}

/** Default caller resolution when there's no auth at all: rate-limit by client IP, anonymous tier. */
export function resolveAnonymousCaller(request: FastifyRequest): {
  key: string;
  tier: RateLimitTierName;
} {
  return { key: `ip:${request.ip}`, tier: 'anonymous' };
}

/**
 * Once auth middleware has run, prefer the account over the IP: multiple
 * legitimate users can share one IP (NAT, corporate networks, mobile
 * carriers), so limiting by IP would unfairly tighten their shared limit.
 * Any authenticated account gets the `free` tier; unauthenticated requests
 * fall back to IP + `anonymous`.
 */
export function resolveAccountOrIpCaller(request: FastifyRequest): {
  key: string;
  tier: RateLimitTierName;
} {
  if (request.account) {
    return { key: `account:${request.account.id}`, tier: 'free' };
  }
  return resolveAnonymousCaller(request);
}
