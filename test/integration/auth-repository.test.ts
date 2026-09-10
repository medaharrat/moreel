import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthRepository } from '../../src/auth/repository.js';
import { createDb } from '../../src/infra/db.js';

/**
 * Runs against a real local Postgres (see docs/deployment.md for setup).
 * Skipped automatically when DATABASE_URL isn't set/reachable — e.g. a CI
 * runner without a Postgres service configured — rather than failing the
 * suite. The availability check must happen before `describe.skipIf` is
 * evaluated (module load time), so it's a top-level await, not a
 * `beforeAll` — `beforeAll` runs too late to affect `skipIf`.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/moreel_test';
const db = createDb({ connectionString: DATABASE_URL, poolMax: 5 });

const available = await db
  .selectFrom('accounts')
  .select('id')
  .limit(1)
  .execute()
  .then(() => true)
  .catch(() => false);

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  if (!available) return;
  await sql`TRUNCATE TABLE api_keys, accounts RESTART IDENTITY CASCADE`.execute(db);
});

describe.skipIf(!available)('AuthRepository (real Postgres)', () => {
  it('creates an account and an API key, then authenticates with the raw secret', async () => {
    const repo = new AuthRepository(db);
    const account = await repo.createAccount('dev@example.com');
    expect(account.email).toBe('dev@example.com');

    const generated = await repo.createApiKey(account.id, ['transcribe']);
    expect(generated.secret.startsWith('moreel_live_')).toBe(true);

    const authenticated = await repo.authenticate(generated.secret);
    expect(authenticated?.account.email).toBe('dev@example.com');
    expect(authenticated?.scopes).toEqual(['transcribe']);
  });

  it('rejects an invalid secret', async () => {
    const repo = new AuthRepository(db);
    const account = await repo.createAccount('dev2@example.com');
    await repo.createApiKey(account.id);

    const result = await repo.authenticate('moreel_live_not-a-real-key');
    expect(result).toBeUndefined();
  });

  it('rejects a revoked key', async () => {
    const repo = new AuthRepository(db);
    const account = await repo.createAccount('dev3@example.com');
    const generated = await repo.createApiKey(account.id);

    const before = await repo.authenticate(generated.secret);
    expect(before).toBeDefined();

    await repo.revokeApiKey(before!.keyId);
    const after = await repo.authenticate(generated.secret);
    expect(after).toBeUndefined();
  });

  it('never stores the plaintext secret', async () => {
    const repo = new AuthRepository(db);
    const account = await repo.createAccount('dev4@example.com');
    const generated = await repo.createApiKey(account.id);

    const row = await db
      .selectFrom('api_keys')
      .select(['key_hash'])
      .where('account_id', '=', account.id)
      .executeTakeFirstOrThrow();

    expect(row.key_hash).not.toBe(generated.secret);
    expect(row.key_hash.startsWith('$argon2')).toBe(true);
  });
});
