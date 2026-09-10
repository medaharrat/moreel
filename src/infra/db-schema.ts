import type { ColumnType, Generated } from 'kysely';

/** Mirrors migrations/1735900000000_init.js. Kept hand-written and narrow — no ORM codegen. */
export interface Database {
  accounts: {
    id: Generated<number>;
    email: string;
    created_at: ColumnType<Date, string | undefined, never>;
  };
  api_keys: {
    id: Generated<number>;
    account_id: number;
    key_prefix: string;
    key_hash: string;
    scopes: string[];
    created_at: ColumnType<Date, string | undefined, never>;
    last_used_at: ColumnType<Date | null, string | null | undefined, string | null>;
    revoked_at: ColumnType<Date | null, string | null | undefined, string | null>;
  };
  provider_events: {
    id: Generated<number>;
    provider: string;
    classification: string;
    latency_ms: number;
    occurred_at: ColumnType<Date, string | undefined, never>;
  };
  videos: {
    id: string;
    source: string;
    source_url: string;
    title: string | null;
    creator_name: string | null;
    creator_url: string | null;
    duration_seconds: number;
    /** jsonb — a serialized Transcript. */
    transcript: unknown;
    /** jsonb — a serialized VisualObservation[]. */
    visual_observations: unknown;
    /** jsonb — a serialized EmbeddingEntry[], or null when not computed. */
    embeddings: unknown | null;
    /** jsonb — a serialized {scenes, entities, interactions, references}, or null when the Video Map didn't run. */
    video_map: unknown | null;
    created_at: ColumnType<Date, string | undefined, never>;
    expires_at: ColumnType<Date, Date | string, Date | string>;
  };
}
