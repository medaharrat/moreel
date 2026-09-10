import { copyFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { TranscriptionService } from '../../app/transcription-service.js';
import type { VideoAsset } from '../../domain/transcript.js';
import { ErrorCode, isMoreelError, toMoreelError } from '../../domain/errors.js';
import type { MediaStore } from '../../media/media-store.js';
import type { FrameAsset } from '../../media/frames/frame-sampler.js';
import { newRequestId } from '../../observability/logger.js';
import { generateShortId } from '../../util/short-id.js';

const bodySchema = z.object({
  url: z.string().min(1, 'url is required'),
  /** Per-request opt-in for the (server-gated) vision pipeline — the web UI's "advanced options" toggle. Omitted keeps existing behavior. */
  includeVisual: z.boolean().optional(),
  /** Per-request opt-in for the (server-gated) Video Map — the web UI's "advanced options" toggle. Has no effect when includeVisual is false. Omitted keeps existing behavior. */
  includeVideoMap: z.boolean().optional(),
});

const STATUS_BY_CODE: Record<string, number> = {
  [ErrorCode.INVALID_URL]: 400,
  [ErrorCode.UNSUPPORTED_SOURCE]: 400,
  [ErrorCode.CONTENT_UNAVAILABLE]: 422,
  [ErrorCode.AUTHENTICATION_REQUIRED]: 422,
  [ErrorCode.MEDIA_TOO_LARGE]: 413,
  [ErrorCode.MEDIA_TOO_LONG]: 413,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.REQUEST_TIMEOUT]: 504,
  [ErrorCode.TRANSCRIPTION_TIMEOUT]: 504,
  [ErrorCode.PROVIDER_UNAVAILABLE]: 503,
  [ErrorCode.DOWNLOAD_FAILED]: 502,
  [ErrorCode.AUDIO_EXTRACTION_FAILED]: 502,
  [ErrorCode.FRAME_EXTRACTION_FAILED]: 502,
  [ErrorCode.VISION_ANALYSIS_FAILED]: 502,
  [ErrorCode.TRANSCRIPTION_FAILED]: 502,
  [ErrorCode.INTERNAL_ERROR]: 500,
};

export interface TranscribeRouteOptions {
  /** Enables `mediaUrl` in the response — the downloaded video, briefly playable via GET /media/:id. */
  mediaStore?: MediaStore;
  /** Where captured media is copied to, outside any per-request workspace dir that gets deleted. Defaults to the OS temp dir. */
  mediaDir?: string;
  redis?: Redis;
}

/**
 * The HTTP twin of the `transcribe_video` MCP tool — same
 * `TranscriptionService`, same typed error taxonomy, different transport
 * (a browser frontend rather than an MCP client).
 */
export function registerTranscribeRoute(
  app: FastifyInstance,
  transcriptionService: TranscriptionService,
  requestTimeoutMs: number,
  options: TranscribeRouteOptions = {},
): void {
  const { mediaStore, mediaDir = path.join(tmpdir(), 'moreel-media'), redis } = options;

  app.post('/transcribe', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: {
          code: ErrorCode.INVALID_URL,
          message: parsed.error.issues[0]?.message ?? 'Invalid request body.',
          retryable: false,
        },
      };
    }

    // `requestId` is the internal correlation id (logs/tracing) — stays a
    // UUID. `shareId` is what the user actually sees (permalink, media
    // path), so it's short and easy to read/type/share.
    const requestId = newRequestId();
    const shareId = generateShortId();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    // Captures a copy of the downloaded video, outside the per-request temp
    // dir `withRequestWorkspace` deletes, so it can be streamed back for
    // playback for MediaStore's short TTL. Best-effort — a capture failure
    // must never fail transcription itself.
    const captureMedia = mediaStore
      ? async (asset: VideoAsset) => {
          await mkdir(mediaDir, { recursive: true });
          const destPath = path.join(mediaDir, `${shareId}-${generateShortId()}`);
          await copyFile(asset.filePath, destPath);
          const { size } = await stat(destPath);
          mediaStore.put(shareId, {
            filePath: destPath,
            contentType: asset.contentType || 'video/mp4',
            sizeBytes: size,
          });
        }
      : undefined;

    // Same idea as `captureMedia`, for the (much smaller) set of sampled
    // frames — only relevant when the vision pipeline actually ran. Each
    // frame becomes its own MediaStore entry, servable at GET /media/:id
    // exactly like the video itself, no new route needed.
    const captureFrames = mediaStore
      ? async (frames: FrameAsset[]) => {
          await mkdir(mediaDir, { recursive: true });
          const frameIdByTimestamp = new Map<number, string>();
          for (const frame of frames) {
            const frameId = `${shareId}-frame-${generateShortId()}`;
            const destPath = path.join(mediaDir, frameId);
            await copyFile(frame.filePath, destPath);
            const { size } = await stat(destPath);
            mediaStore.put(frameId, { filePath: destPath, contentType: frame.contentType, sizeBytes: size });
            frameIdByTimestamp.set(frame.timestamp, frameId);
          }
          return frameIdByTimestamp;
        }
      : undefined;

    try {
      const result = await transcriptionService.transcribeVideo({
        url: parsed.data.url,
        requestId,
        signal: controller.signal,
        ...(captureMedia ? { onVideoDownloaded: captureMedia } : {}),
        ...(captureFrames ? { onFramesSampled: captureFrames } : {}),
        ...(parsed.data.includeVisual !== undefined ? { includeVisual: parsed.data.includeVisual } : {}),
        ...(parsed.data.includeVideoMap !== undefined ? { includeVideoMap: parsed.data.includeVideoMap } : {}),
      });

      const out = {
        id: shareId,
        videoId: result.video_id,
        source: result.source,
        url: result.url,
        durationSeconds: result.duration_seconds,
        language: result.language,
        lowConfidence: result.low_confidence,
        text: result.text,
        caption: result.caption,
        creatorName: result.creatorName,
        creatorUrl: result.creatorUrl,
        likeCount: result.likeCount,
        commentCount: result.commentCount,
        postedAt: result.postedAt,
        segments: result.segments.map((segment, index) => ({
          id: `${shareId}-${index}`,
          start: segment.start,
          end: segment.end,
          text: segment.text,
        })),
        ...(mediaStore?.get(shareId) ? { mediaUrl: `/media/${shareId}` } : {}),
        ...(result.visual
          ? {
              visual: {
                observations: result.visual.observations.map((obs) => ({
                  timestamp: obs.timestamp,
                  ...(obs.endTimestamp !== undefined ? { endTimestamp: obs.endTimestamp } : {}),
                  type: obs.type,
                  text: obs.text,
                  ...(obs.confidence !== undefined ? { confidence: obs.confidence } : {}),
                  ...(obs.frameId && mediaStore?.get(obs.frameId) ? { frameUrl: `/media/${obs.frameId}` } : {}),
                })),
              },
            }
          : {}),
        ...(result.map ? { map: result.map } : {}),
      };

      // Persist the transcript for re-access via /transcripts/:id when Redis is available.
      try {
        if (redis) {
          const ttl = Number(process.env.TRANSCRIPT_TTL_SECONDS ?? 86400);
          await redis.set(`transcript:${shareId}`, JSON.stringify(out), 'EX', ttl);
        }
      } catch (e) {
        request.log.warn({ err: e }, 'failed to persist transcript to redis');
      }

      return out;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        reply.code(504);
        return {
          error: {
            code: ErrorCode.REQUEST_TIMEOUT,
            message: 'The request took too long to process.',
            retryable: true,
          },
        };
      }

      const moreelError = isMoreelError(error) ? error : toMoreelError(error);
      request.log.error(
        { requestId, errorCode: moreelError.code, err: moreelError.message },
        'transcribe request failed',
      );
      reply.code(STATUS_BY_CODE[moreelError.code] ?? 500);
      return { error: moreelError.toClientView() };
    } finally {
      clearTimeout(timeout);
    }
  });
}
