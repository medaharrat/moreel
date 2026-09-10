import type { FastifyInstance } from 'fastify';
import type { AuthRepository } from '../../auth/repository.js';

export function registerPrivacyRoutes(app: FastifyInstance, authRepo: AuthRepository) {
  // Export: returns a privacy-safe snapshot for the authenticated account
  app.post('/privacy/export', async (request, reply) => {
    if (!request.account) return reply.code(401).send({ error: 'authentication required' });

    // minimal export: account identity and non-secret key metadata — no raw transcripts/media
    const apiKeys = await authRepo.listApiKeys(request.account.id);
    return reply.send({
      account: { id: request.account.id, email: request.account.email },
      apiKeys,
    });
  });

  // Deletion: triggers account deletion (authorized via API key). This is destructive.
  app.post('/privacy/delete', async (request, reply) => {
    if (!request.account) return reply.code(401).send({ error: 'authentication required' });

    // In production this should be gated, logged, and require verification.
    // Here we implement a best-effort immediate delete for operators/testing.
    await authRepo.deleteAccount(request.account.id);
    return reply.send({ ok: true });
  });
}

export default registerPrivacyRoutes;
