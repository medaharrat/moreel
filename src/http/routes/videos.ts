import type { FastifyInstance } from 'fastify';
import { buildTimeline } from '../../app/timeline.js';
import type { VideoStore } from '../../app/video-store.js';
import { resolveSemanticSearch } from '../../app/query-embedding.js';
import { searchVideo } from '../../app/video-search.js';
import { findMissedMoments } from '../../app/what-did-i-miss.js';
import { ErrorCode } from '../../domain/errors.js';
import type { EmbeddingProvider } from '../../embeddings/embedding-provider.js';
import type { MediaStore } from '../../media/media-store.js';

export interface VideosRouteOptions {
  /** Resolves a stored frame id into a servable `/media/:id` URL, when it's still available. */
  mediaStore?: MediaStore;
  /** Absent when SEARCH_EMBEDDINGS_ENABLED=false — `/search` falls back to lexical-only matching. */
  embeddingProvider?: EmbeddingProvider;
  embeddingTimeoutMs?: number;
}

function frameUrl(mediaStore: MediaStore | undefined, frameId: string | undefined): string | undefined {
  if (!frameId || !mediaStore?.get(frameId)) return undefined;
  return `/media/${frameId}`;
}

/**
 * The HTTP twin of the `search_video`/`find_moment`/`get_video_timeline` MCP
 * tools — same `VideoStore`, same query logic, exposed for the web UI's
 * in-transcript search and "What did I miss?" panel. Every route needs a
 * `video_id` already produced by a prior `POST /transcribe` call (see
 * transcribe.ts, which now returns `videoId` in its response).
 */
export function registerVideosRoutes(app: FastifyInstance, videoStore: VideoStore, options: VideosRouteOptions = {}): void {
  const { mediaStore, embeddingProvider, embeddingTimeoutMs = 20_000 } = options;

  app.get('/videos/:id/timeline', async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = await videoStore.getById(id);
    if (!record) {
      reply.code(404);
      return { error: { code: ErrorCode.VIDEO_NOT_FOUND, message: 'No processed video found for this id.', retryable: false } };
    }

    const mapData = { entities: record.entities, interactions: record.interactions, references: record.references };
    const events = buildTimeline(record.transcript, record.visualObservations, mapData).map((event) => ({
      timestamp: event.timestamp,
      endTimestamp: event.endTimestamp,
      source: event.source,
      text: event.text,
      confidence: event.confidence,
      frameUrl: frameUrl(mediaStore, event.frameId),
    }));

    return { videoId: id, durationSeconds: record.durationSeconds, events };
  });

  app.get('/videos/:id/search', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { q } = request.query as { q?: string };
    if (!q || q.trim().length === 0) {
      reply.code(400);
      return { error: { code: ErrorCode.INVALID_URL, message: 'Query parameter "q" is required.', retryable: false } };
    }

    const record = await videoStore.getById(id);
    if (!record) {
      reply.code(404);
      return { error: { code: ErrorCode.VIDEO_NOT_FOUND, message: 'No processed video found for this id.', retryable: false } };
    }

    const controller = new AbortController();
    const semantic = await resolveSemanticSearch(embeddingProvider, record, q, {
      signal: controller.signal,
      timeoutMs: embeddingTimeoutMs,
    });

    const searchMapData = { entities: record.entities, interactions: record.interactions, references: record.references };
    const results = searchVideo(record.transcript, record.visualObservations, q, semantic, searchMapData).map((result) => ({
      timestamp: result.timestamp,
      endTimestamp: result.endTimestamp,
      source: result.source,
      text: result.text,
      confidence: result.confidence,
      frameUrl: frameUrl(mediaStore, result.frameId),
    }));

    return { videoId: id, query: q, results };
  });

  app.get('/videos/:id/missed', async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = await videoStore.getById(id);
    if (!record) {
      reply.code(404);
      return { error: { code: ErrorCode.VIDEO_NOT_FOUND, message: 'No processed video found for this id.', retryable: false } };
    }

    const missedMapData = { interactions: record.interactions, references: record.references, entities: record.entities };
    const missed = findMissedMoments(record.transcript, record.visualObservations, undefined, missedMapData).map((moment) => ({
      timestamp: moment.timestamp,
      endTimestamp: moment.endTimestamp,
      type: moment.type,
      category: moment.category,
      text: moment.text,
      confidence: moment.confidence,
      frameUrl: frameUrl(mediaStore, moment.frameId),
    }));

    return { videoId: id, missed };
  });

  app.get('/videos/:id/map', async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = await videoStore.getById(id);
    if (!record) {
      reply.code(404);
      return { error: { code: ErrorCode.VIDEO_NOT_FOUND, message: 'No processed video found for this id.', retryable: false } };
    }

    return {
      videoId: id,
      scenes: (record.scenes ?? []).map((scene) => ({
        id: scene.id,
        startTimestamp: scene.startTimestamp,
        endTimestamp: scene.endTimestamp,
        frameUrl: frameUrl(mediaStore, scene.frameId),
        description: scene.description,
      })),
      entities: (record.entities ?? []).map((entity) => ({
        id: entity.id,
        type: entity.type,
        label: entity.label,
        description: entity.description,
        firstSeen: entity.firstSeen,
        lastSeen: entity.lastSeen,
        confidence: entity.confidence,
      })),
      interactions: (record.interactions ?? []).map((interaction) => ({
        id: interaction.id,
        type: interaction.type,
        timestamp: interaction.timestamp,
        endTimestamp: interaction.endTimestamp,
        actorEntityId: interaction.actorEntityId,
        targetEntityId: interaction.targetEntityId,
        evidenceLevel: interaction.evidenceLevel,
        confidence: interaction.confidence,
      })),
      references: (record.references ?? []).map((reference) => ({
        id: reference.id,
        timestamp: reference.timestamp,
        phrase: reference.phrase,
        targetEntityId: reference.targetEntityId,
        relation: reference.relation,
        evidenceLevel: reference.evidenceLevel,
        confidence: reference.confidence,
      })),
    };
  });
}
