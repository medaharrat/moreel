import type { Logger } from 'pino';
import type { Cache } from '../cache/cache.js';
import { computeVideoId, transcriptCacheKey } from '../cache/keys.js';
import type { MoreelConfig } from '../config/index.js';
import { ErrorCode, MoreelError, toMoreelError } from '../domain/errors.js';
import type { Transcript, TranscribeVideoResult, VideoAsset } from '../domain/transcript.js';
import { transcriptToToolResult } from '../domain/transcript.js';
import type { VisualObservation } from '../domain/vision.js';
import type { AudioExtractor } from '../media/audio/audio-extractor.js';
import type { FrameAsset, FrameSampler } from '../media/frames/frame-sampler.js';
import { probeMediaDurationSeconds } from '../media/probe-duration.js';
import { withRequestWorkspace } from '../media/workspace.js';
import type { EmbeddingProvider } from '../embeddings/embedding-provider.js';
import type { EmbeddingEntry } from '../domain/video.js';
import { buildTimeline } from './timeline.js';
import { buildVideoMap, type VideoMapResult } from './video-map-builder.js';
import type { VideoStore } from './video-store.js';
import type { VideoInteractionAnalyzer } from '../vision/video-interaction-analyzer.js';
import type { Metrics } from '../observability/metrics.js';
import {
  cacheHitsTotal,
  cacheMissesTotal,
  minutesProcessedTotal,
  transcriptionCostCents,
  transcriptionLatency,
  transcriptionsTotal,
  visionCostCents as visionCostCentsMetric,
  visionLatency,
  visionObservationsTotal,
  visionsTotal,
} from '../observability/prom-metrics.js';
import { estimateTranscriptionCostCents, estimateVisionCostCents } from '../observability/cost-estimator.js';
import type { ProviderRegistry } from '../providers/provider.js';
import { parseAndValidateUrl } from '../providers/url-validation.js';
import type { Transcriber } from '../transcription/transcriber.js';
import type { UsageRecorder } from '../usage/usage-recorder.js';
import type { CommandRunner } from '../util/subprocess.js';
import { Semaphore } from '../util/semaphore.js';
import type { VisionProvider } from '../vision/vision-provider.js';

export interface TranscriptionServiceDeps {
  providerRegistry: ProviderRegistry;
  audioExtractor: AudioExtractor;
  transcriber: Transcriber;
  cache: Cache<TranscribeVideoResult>;
  usageRecorder: UsageRecorder;
  metrics: Metrics;
  logger: Logger;
  config: MoreelConfig;
  semaphore?: Semaphore;
  /** Absent (not just disabled) when VISION_ENABLED=false — see build-transcription-service.ts. */
  frameSampler?: FrameSampler;
  visionProvider?: VisionProvider;
  /** Used as a best-effort fallback to probe a video's real duration via ffmpeg when the platform's own metadata doesn't report one — see probe-duration.ts. Absent (not just disabled) when VISION_ENABLED=false, since nothing needs it otherwise. */
  commandRunner?: CommandRunner;
  /** Persists a queryable `VideoRecord` per processed video so `search_video`/`find_moment`/`get_video_timeline` can look it back up by id. Best-effort — a store failure never fails transcription. */
  videoStore?: VideoStore;
  /** Absent when SEARCH_EMBEDDINGS_ENABLED=false. When present, powers semantic search on top of lexical matching — best-effort, a failure here never fails transcription or falls back to anything worse than lexical-only search. */
  embeddingProvider?: EmbeddingProvider;
  /** Absent when VIDEO_MAP_ENABLED=false. Resolves references/interactions on top of the sampled vision frames — best-effort, never blocks the rest of the result. */
  videoInteractionAnalyzer?: VideoInteractionAnalyzer;
}

export interface TranscribeVideoRequest {
  url: string;
  requestId: string;
  /** Propagates MCP-level cancellation down through download/ffmpeg/transcription. */
  signal: AbortSignal;
  /**
   * Fired right after the video is downloaded, while it still exists on
   * disk — the only point at which a caller can capture a copy before
   * `withRequestWorkspace` deletes the per-request temp dir. HTTP-only
   * concern (media playback in the browser); the MCP transport never
   * passes this. Best-effort: a failure here must never fail transcription.
   */
  onVideoDownloaded?: (asset: VideoAsset) => Promise<void> | void;
  /**
   * Fired right after frames are sampled, while they still exist on disk —
   * the only point a caller can capture copies before `withRequestWorkspace`
   * deletes the per-request temp dir. Returns a map of frame timestamp to a
   * stable storage id, used to set each returned observation's `frameId` so
   * it's servable via GET /media/:id. HTTP-only, like `onVideoDownloaded`;
   * best-effort — a failure here must never fail transcription, it just
   * means observations come back without frame images.
   */
  onFramesSampled?: (frames: FrameAsset[]) => Promise<Map<number, string>> | Map<number, string>;
  /**
   * Per-request opt-in for the vision pipeline, on top of the server-level
   * `VISION_ENABLED` gate — the config flag controls whether vision is
   * available at all (cost/latency rollout safety), this controls whether
   * a given caller actually wants it for this specific video. Defaults to
   * `true` when omitted, so existing callers unaware of this field (MCP,
   * older API clients) keep today's behavior — the web UI is the first
   * caller to pass this explicitly, off by default in its own "advanced
   * options" toggle.
   */
  includeVisual?: boolean;
  /**
   * Per-request opt-in for the Video Map (resolving "this"/"that"/pointing
   * references to a specific visual entity), on top of the server-level
   * `VIDEO_MAP_ENABLED` gate — same pattern as `includeVisual`. Has no
   * effect when vision itself didn't run for this request (`includeVisual
   * === false`, or vision unavailable server-side): the map is an
   * enrichment on top of sampled frames, not a standalone stage. Defaults
   * to `true` when omitted, so existing callers unaware of this field keep
   * today's behavior once an operator enables `VIDEO_MAP_ENABLED` —
   * the web UI is the first caller to pass this explicitly, off by default
   * in its own "advanced options" toggle.
   */
  includeVideoMap?: boolean;
}

/**
 * The application/service layer: the only place that knows the full
 * pipeline shape (validate → resolve provider → fetch → extract audio →
 * transcribe → normalize) and wires cross-cutting concerns (timeouts,
 * cancellation, caching, concurrency limits, metrics, usage) around it.
 * The MCP layer calls this and nothing else; it never touches providers,
 * media, or transcription directly.
 */
export class TranscriptionService {
  private readonly semaphore: Semaphore;

  constructor(private readonly deps: TranscriptionServiceDeps) {
    this.semaphore = deps.semaphore ?? new Semaphore(deps.config.maxConcurrentRequests);
  }

  async transcribeVideo(request: TranscribeVideoRequest): Promise<TranscribeVideoResult> {
    const { config, logger, metrics } = this.deps;
    const log = logger.child({ requestId: request.requestId });
    const startedAt = performance.now();

    metrics.increment('transcription_requests_total');

    try {
      const urlValidationStart = performance.now();
      const url = parseAndValidateUrl(request.url);
      metrics.observeLatency('url_validation_ms', performance.now() - urlValidationStart);

      const providerResolutionStart = performance.now();
      const provider = this.deps.providerRegistry.resolve(url);
      metrics.observeLatency('provider_resolution_ms', performance.now() - providerResolutionStart);
      if (!provider) {
        throw new MoreelError(ErrorCode.UNSUPPORTED_SOURCE);
      }

      const timeoutSignal = AbortSignal.timeout(config.requestTimeoutMs);
      const combinedSignal = AbortSignal.any([request.signal, timeoutSignal]);

      const videoId = computeVideoId(provider, url);
      const cacheKey = transcriptCacheKey(provider, url);
      const cached = config.cacheEnabled ? this.deps.cache.get(cacheKey) : undefined;
      if (cached) {
        metrics.increment('transcription_cache_hit_total');
        metrics.increment('transcription_success_total');
        cacheHitsTotal.inc({ layer: 'transcript' });
        transcriptionsTotal.inc({ outcome: 'cache_hit', model: this.deps.transcriber.model });
        log.info({ provider: provider.id, cacheHit: true }, 'transcription served from cache');

        // A cache hit skips transcription (the expensive part) but this
        // request still wants a playable copy of the video — re-download
        // it (best-effort, bounded by the same request timeout) so the
        // frontend gets our own streamed player instead of falling back
        // to a third-party embed just because the text was cached.
        if (request.onVideoDownloaded) {
          try {
            await this.semaphore.runOrReject(() =>
              withRequestWorkspace(config.tempDir, async (workDir) => {
                const video = await provider.fetch(url, {
                  signal: combinedSignal,
                  workDir,
                  maxSizeBytes: config.maxVideoSizeBytes,
                  maxDurationSeconds: config.maxVideoDurationSeconds,
                  timeoutMs: config.downloadTimeoutMs,
                });
                await request.onVideoDownloaded!(video);
              }),
            );
          } catch (hookError) {
            log.warn({ err: hookError }, 'cache-hit media re-fetch failed, serving transcript without playable media');
          }
        }

        return cached;
      }

      if (config.cacheEnabled) {
        cacheMissesTotal.inc({ layer: 'transcript' });
      }

      // The pipeline promise below only settles early if every inner step
      // (provider fetch, ffmpeg, transcriber) actually checks `combinedSignal`
      // and rejects — true for the real subprocess-backed provider/extractor
      // (execFile's `signal` option kills the process), but nothing stops a
      // future step, or a bug, from ignoring it. Racing against a promise
      // that rejects purely from the timeout firing means the caller always
      // gets REQUEST_TIMEOUT within `requestTimeoutMs`, never an indefinite
      // hang, regardless of whether the pipeline internals cooperate. The
      // pipeline itself keeps running in the background until its own
      // abort-aware steps unwind — this bounds the caller-facing latency,
      // it doesn't forcibly kill uncooperative work.
      const timeoutRace = new Promise<never>((_, reject) => {
        const onTimeout = () => reject(new DOMException('Aborted', 'AbortError'));
        if (timeoutSignal.aborted) onTimeout();
        else timeoutSignal.addEventListener('abort', onTimeout, { once: true });
      });

      const pipeline = this.semaphore.runOrReject(() =>
        withRequestWorkspace(config.tempDir, async (workDir) => {
          // Kicked off alongside the download so the transcriber's TLS
          // connection is already warm by the time audio is ready to send.
          void this.deps.transcriber.warmUp?.(combinedSignal);

          const video = await metrics.time('media_download_ms', () =>
            provider.fetch(url, {
              signal: combinedSignal,
              workDir,
              maxSizeBytes: config.maxVideoSizeBytes,
              maxDurationSeconds: config.maxVideoDurationSeconds,
              timeoutMs: config.downloadTimeoutMs,
            }),
          );

          try {
            await request.onVideoDownloaded?.(video);
          } catch (hookError) {
            log.warn({ err: hookError }, 'onVideoDownloaded hook failed, continuing without media capture');
          }

          // Frame sampling (when the vision pipeline is enabled) reads from
          // the same downloaded file and doesn't depend on audio extraction
          // or vice versa, so they run side by side. Vision *analysis* (the
          // actual model call) waits until the transcript exists, below —
          // it needs the spoken text as context, so it can't join this race.
          const visionActive =
            config.visionEnabled &&
            !!this.deps.frameSampler &&
            !!this.deps.visionProvider &&
            request.includeVisual !== false;

          // Some platforms' own metadata doesn't report a duration at all
          // (confirmed in practice for at least some Instagram Reels via
          // yt-dlp) — without it, adaptive sampling below silently falls
          // back to the fixed configured interval, exactly defeating the
          // point for the short/sparse videos it exists to help. A quick
          // ffmpeg probe of the file we already downloaded fills that gap;
          // skipped entirely when the platform already told us, or vision
          // isn't running at all, so this never adds latency in the common
          // case.
          const effectiveVideoDuration =
            visionActive && video.durationSeconds === undefined && this.deps.commandRunner
              ? await probeMediaDurationSeconds(video.filePath, this.deps.commandRunner, config.ffmpegPath, {
                  timeoutMs: Math.min(5_000, config.downloadTimeoutMs),
                  signal: combinedSignal,
                })
              : video.durationSeconds;

          const [audio, frames] = await Promise.all([
            metrics.time('audio_extraction_ms', () =>
              this.deps.audioExtractor.extract(video, {
                signal: combinedSignal,
                workDir,
                maxDurationSeconds: config.maxVideoDurationSeconds,
                timeoutMs: config.downloadTimeoutMs,
              }),
            ),
            visionActive
              ? this.deps
                  .frameSampler!.sample(video, {
                    workDir,
                    maxFrames: config.maxFramesPerVideo,
                    intervalSeconds: computeFrameSampleInterval(
                      effectiveVideoDuration,
                      config.frameSampleIntervalSeconds,
                      config.maxFramesPerVideo,
                    ),
                    timeoutMs: config.downloadTimeoutMs,
                    signal: combinedSignal,
                  })
                  .catch((err) => {
                    log.warn({ err }, 'frame sampling failed, continuing without visual observations');
                    return [] as FrameAsset[];
                  })
              : Promise.resolve([] as FrameAsset[]),
          ]);

          let frameIdByTimestamp = new Map<number, string>();
          if (frames.length > 0 && request.onFramesSampled) {
            try {
              frameIdByTimestamp = (await request.onFramesSampled(frames)) ?? new Map();
            } catch (hookError) {
              log.warn({ err: hookError }, 'onFramesSampled hook failed, continuing without frame images');
            }
          }

          const transcriptionStart = performance.now();
          const transcript = await this.deps.transcriber.transcribe(audio, {
            signal: combinedSignal,
            timeoutMs: config.transcriptionTimeoutMs,
          });
          const transcriptionMs = performance.now() - transcriptionStart;
          metrics.observeLatency('transcription_ms', transcriptionMs);

          // Vision analysis is supplementary by definition — the spoken
          // transcript is the product regardless of whether this succeeds,
          // so every failure here is logged and swallowed, never thrown.
          let visualObservations: VisualObservation[] | undefined;
          let visionMs: number | undefined;
          let visionCostCentsValue: number | undefined;
          if (visionActive && frames.length > 0) {
            const visionStart = performance.now();
            try {
              // A low-confidence transcript is often outright fabricated
              // (Whisper hallucinating on music/game audio/near-silence,
              // not just uncertain) — feeding that text to the vision model
              // as "what was said" can only mislead its judgment, never
              // help it, on exactly the videos where vision matters most
              // (little or no real speech). Omit it rather than pass known
              // garbage as trusted context; the provider's own prompt
              // already handles an empty transcript.
              const observations = await this.deps.visionProvider!.analyze(frames, {
                transcriptText: transcript.lowConfidence ? '' : transcript.text,
                signal: combinedSignal,
                timeoutMs: config.visionTimeoutMs,
              });
              visionMs = performance.now() - visionStart;
              visualObservations = observations.map((obs) => {
                const frameId = frameIdByTimestamp.get(obs.timestamp);
                return frameId ? { ...obs, frameId } : obs;
              });

              const visionModel = this.deps.visionProvider!.model;
              visionsTotal.inc({ outcome: 'success', model: visionModel });
              visionLatency.observe({ model: visionModel }, visionMs);
              visionObservationsTotal.inc({ model: visionModel }, visualObservations.length);
              visionCostCentsValue = estimateVisionCostCents(
                this.deps.visionProvider!.provider,
                visionModel,
                frames.length,
              );
              if (visionCostCentsValue !== undefined) {
                visionCostCentsMetric.inc(
                  { provider: this.deps.visionProvider!.provider, model: visionModel },
                  visionCostCentsValue,
                );
              }
            } catch (err) {
              visionsTotal.inc({ outcome: 'failure', model: this.deps.visionProvider!.model });
              log.warn({ err }, 'vision analysis failed, continuing without visual observations');
            }
          }

          const embeddings = this.deps.videoStore
            ? await this.computeEmbeddings(transcript, visualObservations ?? [], combinedSignal, log)
            : undefined;
          const videoMapActive = visionActive && request.includeVideoMap !== false;
          const videoMap = this.deps.videoStore
            ? await this.buildVideoMap(transcript, frames, video, workDir, combinedSignal, videoMapActive, log)
            : undefined;

          const normalizationStart = performance.now();
          const finalResult = transcriptToToolResult(
            provider.id as TranscribeVideoResult['source'],
            url.toString(),
            transcript,
            {
              videoId,
              caption: video.caption,
              creatorName: video.creatorName,
              creatorUrl: video.creatorUrl,
              likeCount: video.likeCount,
              commentCount: video.commentCount,
              postedAt: video.postedAt,
              ...(visualObservations ? { visual: { observations: visualObservations } } : {}),
              ...(videoMap && (videoMap.interactions.length > 0 || videoMap.references.length > 0)
                ? { map: summarizeVideoMap(videoMap) }
                : {}),
            },
          );
          metrics.observeLatency('normalization_ms', performance.now() - normalizationStart);

          if (this.deps.videoStore) {
            try {
              await this.deps.videoStore.save({
                id: videoId,
                source: provider.id as TranscribeVideoResult['source'],
                sourceUrl: url.toString(),
                title: video.caption,
                creatorName: video.creatorName,
                creatorUrl: video.creatorUrl,
                durationSeconds: transcript.durationSeconds,
                createdAt: new Date().toISOString(),
                transcript,
                visualObservations: visualObservations ?? [],
                ...(embeddings ? { embeddings } : {}),
                ...(videoMap ? videoMap : {}),
              });
            } catch (err) {
              log.warn({ err }, 'failed to persist video record, search/timeline lookups for this video will miss');
            }
          }

          const costCents = estimateTranscriptionCostCents(
            this.deps.transcriber.provider,
            this.deps.transcriber.model,
            audio.durationSeconds,
          );

          transcriptionsTotal.inc({ outcome: 'success', model: this.deps.transcriber.model });
          transcriptionLatency.observe({ model: this.deps.transcriber.model }, transcriptionMs);
          minutesProcessedTotal.inc(audio.durationSeconds / 60);
          if (costCents !== undefined) {
            transcriptionCostCents.inc(
              { provider: this.deps.transcriber.provider, model: this.deps.transcriber.model },
              costCents,
            );
          }

          this.deps.usageRecorder.record({
            requestId: request.requestId,
            source: video.source,
            videoDurationSeconds: audio.durationSeconds,
            transcriptionMs,
            totalLatencyMs: performance.now() - startedAt,
            transcriptionProvider: this.deps.transcriber.provider,
            transcriptionModel: this.deps.transcriber.model,
            success: true,
            cacheHit: false,
            occurredAt: new Date().toISOString(),
            ...(costCents !== undefined ? { estimatedCostCents: costCents } : {}),
            ...(visionMs !== undefined ? { visionMs } : {}),
            ...(visionCostCentsValue !== undefined ? { visionCostCents: visionCostCentsValue } : {}),
            ...(visualObservations !== undefined ? { visionObservationCount: visualObservations.length } : {}),
          });

          if (config.cacheEnabled) {
            this.deps.cache.set(cacheKey, finalResult);
          }

          return finalResult;
        }),
      );

      // If `timeoutRace` wins, `pipeline` is still running and will settle
      // later with nothing left awaiting it — without this, that eventual
      // rejection becomes an unhandled promise rejection and crashes the
      // process (see `unhandledRejection` in src/http/main.ts / src/mcp/server.ts).
      pipeline.catch(() => {});

      const result = await Promise.race([pipeline, timeoutRace]);

      metrics.increment('transcription_success_total');
      log.info(
        {
          provider: provider.id,
          durationSeconds: result.duration_seconds,
          totalLatencyMs: Math.round(performance.now() - startedAt),
          lowConfidence: result.low_confidence,
        },
        'transcription succeeded',
      );
      return result;
    } catch (error) {
      metrics.increment('transcription_failures_total');
      transcriptionsTotal.inc({ outcome: 'failure', model: this.deps.transcriber.model });

      if (error instanceof DOMException && error.name === 'AbortError') {
        if (request.signal.aborted) {
          log.info('request cancelled by client');
          throw error;
        }
        const timeoutError = new MoreelError(ErrorCode.REQUEST_TIMEOUT, undefined, {
          details: { requestTimeoutMs: config.requestTimeoutMs },
        });
        log.warn({ errorCode: timeoutError.code }, 'request exceeded overall timeout');
        throw timeoutError;
      }

      const moreelError = toMoreelError(error);
      log.warn(
        {
          errorCode: moreelError.code,
          errorMessage: moreelError.message,
          cause: describeCause(moreelError.cause),
        },
        'transcription failed',
      );
      throw moreelError;
    }
  }

  /**
   * Best-effort: embeds the text of every timeline event (speech + visual)
   * for semantic search, keyed by (timestamp, source) so results can be
   * matched back without assuming array order. Returns `undefined` — never
   * throws — when no embedding provider is configured or the call fails;
   * `search_video`/`find_moment` degrade to lexical-only for this video,
   * they don't fail.
   */
  private async computeEmbeddings(
    transcript: Transcript,
    visualObservations: VisualObservation[],
    signal: AbortSignal,
    log: Logger,
  ): Promise<EmbeddingEntry[] | undefined> {
    if (!this.deps.embeddingProvider) return undefined;

    const timeline = buildTimeline(transcript, visualObservations);
    if (timeline.length === 0) return undefined;

    try {
      const vectors = await this.deps.embeddingProvider.embed(
        timeline.map((event) => event.text),
        { signal, timeoutMs: this.deps.config.searchEmbeddingTimeoutMs },
      );
      return timeline.map((event, index) => ({
        timestamp: event.timestamp,
        source: event.source,
        vector: vectors[index]!,
      }));
    } catch (err) {
      log.warn({ err }, 'embedding generation failed, search for this video will be lexical-only');
      return undefined;
    }
  }

  /**
   * Best-effort: resolves references/interactions on top of the sampled
   * vision frames (see video-map-builder.ts). Returns `undefined` — never
   * throws — when disabled, vision didn't run for this request, or the
   * analysis itself fails; the rest of the `VideoRecord` is unaffected.
   */
  private async buildVideoMap(
    transcript: Transcript,
    frames: FrameAsset[],
    video: VideoAsset,
    workDir: string,
    signal: AbortSignal,
    mapActive: boolean,
    log: Logger,
  ): Promise<VideoMapResult | undefined> {
    if (!mapActive || !this.deps.videoInteractionAnalyzer) return undefined;

    try {
      return await buildVideoMap({
        transcript,
        existingFrames: frames,
        analyzer: this.deps.videoInteractionAnalyzer,
        maxWindows: this.deps.config.videoMapMaxWindows,
        ...(this.deps.frameSampler ? { frameSampler: this.deps.frameSampler } : {}),
        video,
        workDir,
        signal,
        timeoutMs: this.deps.config.videoMapTimeoutMs,
      });
    } catch (err) {
      log.warn({ err }, 'video map analysis failed, continuing without it');
      return undefined;
    }
  }
}

/** Below this many sampled frames, a short/action-heavy video is too sparsely covered for the vision model to reliably catch the notable moment — most of the clip's duration was never even sampled. */
const MIN_FRAMES_FOR_DENSE_COVERAGE = 8;

/**
 * The configured `FRAME_SAMPLE_INTERVAL_SECONDS` is tuned for typical
 * (30-60s+) videos; applied unchanged to a short clip, it can sample as
 * few as 3-4 frames total, leaving most of the video's duration
 * unobserved — if whatever's notable happens between samples, vision has
 * nothing to work with, no matter how good the model is. Tightens the
 * interval (never widens it) so a short video gets at least
 * `MIN_FRAMES_FOR_DENSE_COVERAGE` samples, still bounded by the existing
 * `maxFramesPerVideo` cap — cost is unaffected for normal-length videos,
 * where the configured interval already clears this bar easily.
 */
export function computeFrameSampleInterval(
  durationSeconds: number | undefined,
  configuredIntervalSeconds: number,
  maxFramesPerVideo: number,
): number {
  if (!durationSeconds || durationSeconds <= 0) return configuredIntervalSeconds;

  const targetFrameCount = Math.min(maxFramesPerVideo, MIN_FRAMES_FOR_DENSE_COVERAGE);
  const denseInterval = Math.floor(durationSeconds / targetFrameCount);
  return Math.max(1, Math.min(configuredIntervalSeconds, denseInterval || 1));
}

function describeCause(cause: unknown): string | undefined {
  if (cause instanceof Error) return cause.message;
  if (cause === undefined) return undefined;
  return String(cause);
}

/**
 * Flattens the Video Map's interactions/references (with entity labels
 * resolved inline) into the shape `TranscribeVideoResult.map` exposes —
 * the transport-facing summary, distinct from the full `VideoRecord.
 * {entities,interactions,references}` structure persisted for
 * search_video/get_video_map. Only interactions/references with a
 * resolved target are worth surfacing here; uncertain ones (no target)
 * add nothing actionable to a flat per-request response and are omitted —
 * they're still queryable via get_video_map for anyone who wants the full
 * picture including uncertainty.
 */
function summarizeVideoMap(videoMap: VideoMapResult): NonNullable<TranscribeVideoResult['map']> {
  const labelById = new Map(videoMap.entities.map((entity) => [entity.id, entity.label]));

  return {
    interactions: videoMap.interactions
      .filter((interaction) => interaction.targetEntityId)
      .map((interaction) => ({
        timestamp: round2(interaction.timestamp),
        type: interaction.type,
        targetLabel: labelById.get(interaction.targetEntityId!) ?? interaction.targetEntityId!,
        confidence: interaction.confidence,
      })),
    references: videoMap.references
      .filter((reference) => reference.targetEntityId)
      .map((reference) => ({
        timestamp: round2(reference.timestamp),
        phrase: reference.phrase,
        targetLabel: labelById.get(reference.targetEntityId!) ?? reference.targetEntityId!,
        confidence: reference.confidence,
      })),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
