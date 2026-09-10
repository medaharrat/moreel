import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresVideoStore } from '../../src/app/video-store.js';
import { createDb } from '../../src/infra/db.js';
import type { VideoRecord } from '../../src/domain/video.js';

/**
 * Runs against a real local Postgres (see docs/deployment.md for setup).
 * Skipped automatically when DATABASE_URL isn't set/reachable, mirroring
 * test/integration/auth-repository.test.ts.
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
  await sql`TRUNCATE TABLE videos`.execute(db);
});

function record(id: string, overrides: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id,
    source: 'instagram',
    sourceUrl: 'https://www.instagram.com/reel/abc123/',
    title: 'A reel',
    creatorName: 'someone',
    durationSeconds: 12.5,
    createdAt: new Date().toISOString(),
    transcript: {
      text: 'hello world',
      segments: [{ start: 0, end: 2, text: 'hello world' }],
      language: 'en',
      durationSeconds: 12.5,
      lowConfidence: false,
    },
    visualObservations: [{ timestamp: 1, type: 'on_screen_text', text: 'WELCOME', confidence: 0.9 }],
    ...overrides,
  };
}

describe.skipIf(!available)('PostgresVideoStore (real Postgres)', () => {
  it('round-trips a saved record, preserving nested transcript/observation data', async () => {
    const store = new PostgresVideoStore(db, { ttlMs: 60_000 });
    await store.save(record('vid-1'));

    const found = await store.getById('vid-1');
    expect(found?.id).toBe('vid-1');
    expect(found?.sourceUrl).toBe('https://www.instagram.com/reel/abc123/');
    expect(found?.transcript.segments).toEqual([{ start: 0, end: 2, text: 'hello world' }]);
    expect(found?.visualObservations).toEqual([
      { timestamp: 1, type: 'on_screen_text', text: 'WELCOME', confidence: 0.9 },
    ]);
  });

  it('round-trips embeddings when present, and omits the field when absent', async () => {
    const store = new PostgresVideoStore(db, { ttlMs: 60_000 });
    await store.save(record('vid-embed', { embeddings: [{ timestamp: 0, source: 'speech', vector: [0.1, 0.2] }] }));
    await store.save(record('vid-no-embed'));

    expect((await store.getById('vid-embed'))?.embeddings).toEqual([
      { timestamp: 0, source: 'speech', vector: [0.1, 0.2] },
    ]);
    expect((await store.getById('vid-no-embed'))?.embeddings).toBeUndefined();
  });

  it('round-trips Video Map fields (scenes/entities/interactions/references) when present, and omits them when absent', async () => {
    const store = new PostgresVideoStore(db, { ttlMs: 60_000 });
    await store.save(
      record('vid-map', {
        scenes: [{ id: 'scene_1', startTimestamp: 0, endTimestamp: 5 }],
        entities: [
          { id: 'entity_1', type: 'product', label: 'pink phone case', firstSeen: 4, lastSeen: 4, frameIds: [], confidence: 0.9 },
        ],
        interactions: [
          { id: 'interaction_1', type: 'points_at', timestamp: 4, targetEntityId: 'entity_1', evidenceLevel: 'observed', confidence: 0.9 },
        ],
        references: [
          {
            id: 'reference_1',
            timestamp: 4,
            phrase: 'this one',
            segmentIndex: 0,
            targetEntityId: 'entity_1',
            relation: 'refers_to',
            evidenceLevel: 'observed',
            confidence: 0.85,
          },
        ],
      }),
    );
    await store.save(record('vid-no-map'));

    const withMap = await store.getById('vid-map');
    expect(withMap?.scenes).toEqual([{ id: 'scene_1', startTimestamp: 0, endTimestamp: 5 }]);
    expect(withMap?.entities?.[0]?.label).toBe('pink phone case');
    expect(withMap?.interactions?.[0]).toMatchObject({ type: 'points_at', targetEntityId: 'entity_1' });
    expect(withMap?.references?.[0]).toMatchObject({ phrase: 'this one', targetEntityId: 'entity_1' });

    const withoutMap = await store.getById('vid-no-map');
    expect(withoutMap?.scenes).toBeUndefined();
    expect(withoutMap?.entities).toBeUndefined();
    expect(withoutMap?.interactions).toBeUndefined();
    expect(withoutMap?.references).toBeUndefined();
  });

  it('overwrites an existing record on re-save (upsert by id)', async () => {
    const store = new PostgresVideoStore(db, { ttlMs: 60_000 });
    await store.save(record('vid-2', { title: 'first' }));
    await store.save(record('vid-2', { title: 'second' }));

    const found = await store.getById('vid-2');
    expect(found?.title).toBe('second');
  });

  it('returns undefined for an id that was never saved', async () => {
    const store = new PostgresVideoStore(db, { ttlMs: 60_000 });
    expect(await store.getById('missing')).toBeUndefined();
  });

  it('treats an expired row as a miss even though it still exists in the table', async () => {
    const store = new PostgresVideoStore(db, { ttlMs: -1 });
    await store.save(record('vid-expired'));

    expect(await store.getById('vid-expired')).toBeUndefined();

    const stillInTable = await db.selectFrom('videos').select('id').where('id', '=', 'vid-expired').executeTakeFirst();
    expect(stillInTable?.id).toBe('vid-expired');
  });
});
