import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './db-schema.js';

export interface DbOptions {
  connectionString: string;
  /**
   * Per-replica pool cap. With N replicas all pointed at the same managed
   * Postgres instance, keep `poolMax * N` comfortably under the instance's
   * connection limit — see docs/deployment.md for the worked example.
   */
  poolMax: number;
}

export function createDb(options: DbOptions): Kysely<Database> {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.poolMax,
  });

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}

export async function pingDb(db: Kysely<Database>): Promise<boolean> {
  try {
    await db.selectFrom('accounts').select('id').limit(1).execute();
    return true;
  } catch {
    return false;
  }
}
