/**
 * Durable, cross-replica video store — backs search_video/find_moment/
 * get_video_timeline when DATABASE_URL is configured (falls back to Redis,
 * then an in-process cache; see src/app/video-store.ts).
 *
 * This is still a bounded-retention CACHE, not a transcript archive: every
 * row carries `expires_at` and reads filter on it, matching the same
 * "process the minimum data necessary, retain it for the minimum time
 * necessary" principle applied to the existing transcript cache (see
 * docs/privacy.md). No periodic purge job exists yet to reclaim expired
 * rows' disk space — a known gap, called out in that doc.
 */
exports.up = (pgm) => {
  pgm.createTable('videos', {
    id: { type: 'text', notNull: true, primaryKey: true },
    source: { type: 'text', notNull: true },
    source_url: { type: 'text', notNull: true },
    title: { type: 'text' },
    creator_name: { type: 'text' },
    creator_url: { type: 'text' },
    duration_seconds: { type: 'double precision', notNull: true },
    // Full nested transcript/observation/embedding data — jsonb, not a
    // normalized schema, since nothing here is queried by field, only
    // fetched whole by id and processed in application code.
    transcript: { type: 'jsonb', notNull: true },
    visual_observations: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    embeddings: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
  });
  pgm.createIndex('videos', 'expires_at');
};

exports.down = (pgm) => {
  pgm.dropTable('videos');
};
