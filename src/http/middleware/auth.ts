import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pseudonymizeId, pseudonymizeEmail } from '../../observability/pseudonymize.js';
import type { Account, AuthRepository } from '../../auth/repository.js';

declare module 'fastify' {
  interface FastifyRequest {
    account?: Account;
    apiKeyScopes?: string[];
  }
}

export interface AuthMiddlewareOptions {
  repository: AuthRepository;
  /** Paths that don't require authentication. */
  exemptPaths?: string[];
}

/**
 * Extracts `Authorization: Bearer <secret>`, verifies it against
 * `AuthRepository`, and attaches `request.account`/`request.apiKeyScopes`.
 * Rejects with 401 (never leaking whether a prefix existed vs. the secret
 * was wrong — same generic message either way).
 */
export function registerAuthMiddleware(app: FastifyInstance, options: AuthMiddlewareOptions): void {
  const exempt = options.exemptPaths ?? ['/health', '/ready', '/metrics'];

  // Exact match for static paths; prefix match (`/media/` under `/media`)
  // for routes with a dynamic segment, without accidentally exempting an
  // unrelated path that merely starts with the same characters.
  const isExempt = (path: string): boolean =>
    exempt.some((p) => path === p || path.startsWith(`${p}/`));

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isExempt(request.url.split('?')[0] ?? request.url)) return;

    const header = request.headers.authorization;
    const secret = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    if (!secret) {
      reply.code(401);
      await reply.send({
        error: { code: 'AUTHENTICATION_REQUIRED', message: 'Missing API key.', retryable: false },
      });
      return;
    }

    const authenticated = await options.repository.authenticate(secret);
    if (!authenticated) {
      reply.code(401);
      await reply.send({
        error: { code: 'AUTHENTICATION_REQUIRED', message: 'Invalid or revoked API key.', retryable: false },
      });
      return;
    }

    request.account = authenticated.account;
    request.apiKeyScopes = authenticated.scopes;
    // Attach a pseudonymous account marker to the request log so downstream
    // logs/metrics can include an account identifier without exposing PII.
    try {
      const anon = `acct_${pseudonymizeId(String(authenticated.account.id))}`;
      const emailHash = pseudonymizeEmail(authenticated.account.email ?? '');
      request.log = request.log.child({ account: anon, account_email_hash: emailHash });
    } catch {
      // non-fatal: if pseudonymization fails, continue without the child logger
    }
  });
}
