import type { Kysely } from 'kysely';
import type { Database } from '../infra/db-schema.js';
import { generateApiKey, verifyApiKeySecret, type GeneratedApiKey } from './api-key.js';

export interface Account {
  id: number;
  email: string;
}

export interface AuthenticatedApiKey {
  keyId: number;
  account: Account;
  scopes: string[];
}

/**
 * Postgres-backed account/API-key persistence via Kysely. Kept as a plain
 * repository (no ORM entities/decorators) so the SQL stays visible and
 * auditable — this table holds the credentials that gate access, so
 * correctness here matters more than abstraction.
 */
export class AuthRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async createAccount(email: string): Promise<Account> {
    const row = await this.db
      .insertInto('accounts')
      .values({ email })
      .returning(['id', 'email'])
      .executeTakeFirstOrThrow();
    return { id: row.id, email: row.email };
  }

  /** Creates a new key for an account. Returns the secret exactly once — callers must show it now or lose it. */
  async createApiKey(accountId: number, scopes: string[] = []): Promise<GeneratedApiKey> {
    const generated = await generateApiKey();
    await this.db
      .insertInto('api_keys')
      .values({
        account_id: accountId,
        key_prefix: generated.prefix,
        key_hash: generated.hash,
        scopes,
      })
      .execute();
    return generated;
  }

  /**
   * Verifies a bearer secret and returns the associated account, or
   * `undefined` if it's invalid/revoked. Updates `last_used_at`
   * fire-and-forget (never blocks the auth check on a write).
   */
  async authenticate(secret: string): Promise<AuthenticatedApiKey | undefined> {
    // Argon2 hashes aren't lookup-friendly (they're salted), so we can't
    // SELECT WHERE key_hash = hash(secret). We narrow by prefix first (cheap,
    // indexed-enough via key_hash uniqueness in practice at this scale) then
    // verify the hash for the (small) prefix-matching set.
    const prefix = secret.slice(0, 'moreel_live_'.length + 8);
    const candidates = await this.db
      .selectFrom('api_keys')
      .innerJoin('accounts', 'accounts.id', 'api_keys.account_id')
      .select([
        'api_keys.id as key_id',
        'api_keys.key_hash',
        'api_keys.scopes',
        'api_keys.revoked_at',
        'accounts.id as account_id',
        'accounts.email',
      ])
      .where('api_keys.key_prefix', '=', prefix)
      .execute();

    for (const candidate of candidates) {
      if (candidate.revoked_at) continue;
      const matches = await verifyApiKeySecret(secret, candidate.key_hash);
      if (!matches) continue;

      void this.touchLastUsed(candidate.key_id);
      return {
        keyId: candidate.key_id,
        account: { id: candidate.account_id, email: candidate.email },
        scopes: candidate.scopes,
      };
    }
    return undefined;
  }

  async revokeApiKey(keyId: number): Promise<void> {
    await this.db
      .updateTable('api_keys')
      .set({ revoked_at: new Date().toISOString() })
      .where('id', '=', keyId)
      .execute();
  }

  /** Lists non-secret key metadata for an account, for a privacy-export request. */
  async listApiKeys(accountId: number): Promise<Array<{ prefix: string; createdAt: Date; lastUsedAt: Date | null; revoked: boolean }>> {
    const rows = await this.db
      .selectFrom('api_keys')
      .select(['key_prefix', 'created_at', 'last_used_at', 'revoked_at'])
      .where('account_id', '=', accountId)
      .execute();
    return rows.map((r) => ({
      prefix: r.key_prefix,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      revoked: r.revoked_at !== null,
    }));
  }

  /** Cascades via DB foreign keys (api_keys references accounts.id). */
  async deleteAccount(accountId: number): Promise<void> {
    await this.db.deleteFrom('accounts').where('id', '=', accountId).execute();
  }

  private async touchLastUsed(keyId: number): Promise<void> {
    await this.db
      .updateTable('api_keys')
      .set({ last_used_at: new Date().toISOString() })
      .where('id', '=', keyId)
      .execute();
  }
}
