import type { Kysely } from 'kysely';
import type { Redis } from 'ioredis';
import type { EmbeddingEntry, VideoRecord } from '../domain/video.js';
import type { SourceId, Transcript } from '../domain/transcript.js';
import type { VisualObservation } from '../domain/vision.js';
import type { Interaction, LinguisticReference, Scene, VisualEntity } from '../domain/video-map.js';
import { TtlCache } from '../cache/cache.js';
import type { Database } from '../infra/db-schema.js';

/** The four Video Map collections, persisted together as one jsonb blob — see the `video_map` migration's own header for why. */
interface StoredVideoMap {
  scenes?: Scene[];
  entities?: VisualEntity[];
  interactions?: Interaction[];
  references?: LinguisticReference[];
}

function videoMapOf(record: VideoRecord): StoredVideoMap | undefined {
  if (!record.scenes && !record.entities && !record.interactions && !record.references) return undefined;
  return {
    ...(record.scenes ? { scenes: record.scenes } : {}),
    ...(record.entities ? { entities: record.entities } : {}),
    ...(record.interactions ? { interactions: record.interactions } : {}),
    ...(record.references ? { references: record.references } : {}),
  };
}

/**
 * Persists processed videos by id so `search_video`/`find_moment`/
 * `get_video_timeline` can query a video that was `understand_video`'d in a
 * previous call — the whole point of these tools is that an agent doesn't
 * re-submit the URL every time it wants to ask something new. Deliberately
 * narrow (get/save by id only): `computeVideoId` is deterministic from the
 * source URL, so there's no need for a separate URL→id index or a search-by-
 * URL method.
 */
export interface VideoStore {
  save(record: VideoRecord): Promise<void>;
  getById(id: string): Promise<VideoRecord | undefined>;
}

export interface InMemoryVideoStoreOptions {
  ttlMs: number;
  maxEntries: number;
}

/**
 * Single-process fallback for local dev / no-Redis deployments. Correct
 * within one process only — MCP (stdio) and HTTP run as separate processes
 * either way, so this never claims to be a substitute for `RedisVideoStore`
 * in a multi-replica or multi-transport deployment, only a functional
 * default when Redis isn't configured at all.
 */
export class InMemoryVideoStore implements VideoStore {
  private readonly cache: TtlCache<VideoRecord>;

  constructor(options: InMemoryVideoStoreOptions) {
    this.cache = new TtlCache<VideoRecord>(options);
  }

  async save(record: VideoRecord): Promise<void> {
    this.cache.set(record.id, record);
  }

  async getById(id: string): Promise<VideoRecord | undefined> {
    return this.cache.get(id);
  }
}

export interface RedisVideoStoreOptions {
  ttlMs: number;
  keyPrefix?: string;
}

/** Shared, cross-process/cross-replica video store — the real backing for production. */
export class RedisVideoStore implements VideoStore {
  private readonly keyPrefix: string;

  constructor(
    private readonly redis: Redis,
    private readonly options: RedisVideoStoreOptions,
  ) {
    this.keyPrefix = options.keyPrefix ?? 'video';
  }

  private key(id: string): string {
    return `${this.keyPrefix}:${id}`;
  }

  async save(record: VideoRecord): Promise<void> {
    await this.redis.set(this.key(record.id), JSON.stringify(record), 'PX', this.options.ttlMs);
  }

  async getById(id: string): Promise<VideoRecord | undefined> {
    const raw = await this.redis.get(this.key(id));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as VideoRecord;
    } catch {
      return undefined;
    }
  }
}

export interface PostgresVideoStoreOptions {
  /** Same TTL semantics as the Redis/in-memory stores — this is a bounded-retention cache, not a transcript archive. See docs/privacy.md and the `videos` migration's own header. */
  ttlMs: number;
}

/**
 * Durable, cross-replica video store for deployments that run Postgres —
 * which most production deployments here already do, for accounts/auth —
 * without requiring Redis as well. Every row carries an explicit
 * `expires_at`; `getById` filters on it, so an expired row reads back as a
 * miss exactly like a Redis key past its TTL, even before any purge job
 * reclaims the row's storage.
 */
export class PostgresVideoStore implements VideoStore {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly options: PostgresVideoStoreOptions,
  ) {}

  async save(record: VideoRecord): Promise<void> {
    const expiresAt = new Date(Date.now() + this.options.ttlMs);
    const row = {
      id: record.id,
      source: record.source,
      source_url: record.sourceUrl,
      title: record.title ?? null,
      creator_name: record.creatorName ?? null,
      creator_url: record.creatorUrl ?? null,
      duration_seconds: record.durationSeconds,
      transcript: JSON.stringify(record.transcript),
      visual_observations: JSON.stringify(record.visualObservations),
      embeddings: record.embeddings ? JSON.stringify(record.embeddings) : null,
      video_map: (() => {
        const map = videoMapOf(record);
        return map ? JSON.stringify(map) : null;
      })(),
      expires_at: expiresAt,
    };

    await this.db
      .insertInto('videos')
      .values(row)
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          title: row.title,
          creator_name: row.creator_name,
          creator_url: row.creator_url,
          duration_seconds: row.duration_seconds,
          transcript: row.transcript,
          visual_observations: row.visual_observations,
          embeddings: row.embeddings,
          video_map: row.video_map,
          expires_at: row.expires_at,
        }),
      )
      .execute();
  }

  async getById(id: string): Promise<VideoRecord | undefined> {
    const row = await this.db
      .selectFrom('videos')
      .selectAll()
      .where('id', '=', id)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    if (!row) return undefined;

    const videoMap = row.video_map ? parseJsonColumn<StoredVideoMap>(row.video_map) : undefined;

    return {
      id: row.id,
      source: row.source as SourceId,
      sourceUrl: row.source_url,
      title: row.title ?? undefined,
      creatorName: row.creator_name ?? undefined,
      creatorUrl: row.creator_url ?? undefined,
      durationSeconds: row.duration_seconds,
      createdAt: row.created_at.toISOString(),
      transcript: parseJsonColumn<Transcript>(row.transcript),
      visualObservations: parseJsonColumn<VisualObservation[]>(row.visual_observations) ?? [],
      ...(row.embeddings ? { embeddings: parseJsonColumn<EmbeddingEntry[]>(row.embeddings) } : {}),
      ...(videoMap?.scenes ? { scenes: videoMap.scenes } : {}),
      ...(videoMap?.entities ? { entities: videoMap.entities } : {}),
      ...(videoMap?.interactions ? { interactions: videoMap.interactions } : {}),
      ...(videoMap?.references ? { references: videoMap.references } : {}),
    };
  }
}

/** node-postgres parses jsonb columns into JS objects by default, but tolerate a raw string too (e.g. a driver/config that doesn't register that type parser). */
function parseJsonColumn<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}
