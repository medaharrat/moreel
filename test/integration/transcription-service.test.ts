import { describe, expect, it, vi } from 'vitest';
import type { VideoAsset } from '../../src/domain/transcript.js';
import { ErrorCode, isMoreelError, MoreelError } from '../../src/domain/errors.js';
import type { FrameAsset, FrameSampler } from '../../src/media/frames/frame-sampler.js';
import type { Transcriber } from '../../src/transcription/transcriber.js';
import type { VisionProvider } from '../../src/vision/vision-provider.js';
import { buildTranscriptionService, FakeInstagramProvider } from '../helpers/service-fakes.js';

describe('TranscriptionService (integration)', () => {
  it('runs the full pipeline and returns the exact transcribe_video result shape', async () => {
    const { service } = buildTranscriptionService();

    const result = await service.transcribeVideo({
      url: 'https://www.instagram.com/reel/CzTest123/',
      requestId: 'req-1',
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      video_id: expect.any(String),
      source: 'instagram',
      url: 'https://www.instagram.com/reel/CzTest123/',
      duration_seconds: 53.28,
      language: 'en',
      low_confidence: false,
      segments: [{ start: 0, end: 2.44, text: '10 out of 10 unusual hobbies.' }],
      text: '10 out of 10 unusual hobbies.',
    });
  });

  it('rejects an unsupported URL with UNSUPPORTED_SOURCE without invoking any provider', async () => {
    const { service, provider } = buildTranscriptionService();

    await expect(
      service.transcribeVideo({
        url: 'https://www.youtube.com/watch?v=abc',
        requestId: 'req-2',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SOURCE' });
    expect((provider as FakeInstagramProvider).fetchCalls).toBe(0);
  });

  it('rejects a malformed URL with INVALID_URL', async () => {
    const { service } = buildTranscriptionService();
    await expect(
      service.transcribeVideo({
        url: 'not a url',
        requestId: 'req-3',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_URL' });
  });

  it('propagates a typed error from the provider (e.g. private content)', async () => {
    const provider = new FakeInstagramProvider(async () => {
      throw new MoreelError(ErrorCode.AUTHENTICATION_REQUIRED);
    });
    const { service } = buildTranscriptionService({ provider });

    await expect(
      service.transcribeVideo({
        url: 'https://www.instagram.com/reel/private/',
        requestId: 'req-4',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
  });

  it('wraps an unexpected error as INTERNAL_ERROR without leaking internals', async () => {
    const provider = new FakeInstagramProvider(async () => {
      throw new Error('/secret/internal/path exploded');
    });
    const { service } = buildTranscriptionService({ provider });

    try {
      await service.transcribeVideo({
        url: 'https://www.instagram.com/reel/oops/',
        requestId: 'req-5',
        signal: new AbortController().signal,
      });
      expect.unreachable();
    } catch (error) {
      expect(isMoreelError(error)).toBe(true);
      if (isMoreelError(error)) {
        expect(error.code).toBe('INTERNAL_ERROR');
        expect(JSON.stringify(error.toClientView())).not.toContain('/secret/internal/path');
      }
    }
  });

  it('serves a second identical request from cache without calling the provider again', async () => {
    const { service, provider } = buildTranscriptionService();
    const request = {
      url: 'https://www.instagram.com/reel/CacheMe/',
      requestId: 'req-6',
      signal: new AbortController().signal,
    };

    const first = await service.transcribeVideo(request);
    const second = await service.transcribeVideo({ ...request, requestId: 'req-7' });

    expect(second).toEqual(first);
    expect((provider as FakeInstagramProvider).fetchCalls).toBe(1);
  });

  it('does not use the cache when caching is disabled', async () => {
    const { service, provider } = buildTranscriptionService({ cacheEnabled: false });
    const request = {
      url: 'https://www.instagram.com/reel/NoCache/',
      requestId: 'req-8',
      signal: new AbortController().signal,
    };

    await service.transcribeVideo(request);
    await service.transcribeVideo({ ...request, requestId: 'req-9' });

    expect((provider as FakeInstagramProvider).fetchCalls).toBe(2);
  });

  it('fails fast with RATE_LIMITED once concurrency capacity is exhausted', async () => {
    let releaseFirst!: () => void;
    const provider = new FakeInstagramProvider(
      () =>
        new Promise<VideoAsset>((resolve) => {
          releaseFirst = () =>
            resolve({
              filePath: '/tmp/fake-video.mp4',
              contentType: 'video/mp4',
              sizeBytes: 1,
              durationSeconds: 1,
              source: 'instagram',
              sourceUrl: 'https://www.instagram.com/reel/Slow/',
            });
        }),
    );
    const { service } = buildTranscriptionService({ provider, maxConcurrentRequests: 1 });

    const firstCall = service.transcribeVideo({
      url: 'https://www.instagram.com/reel/Slow/',
      requestId: 'req-10',
      signal: new AbortController().signal,
    });

    await vi.waitFor(() => expect((provider as FakeInstagramProvider).fetchCalls).toBe(1));

    await expect(
      service.transcribeVideo({
        url: 'https://www.instagram.com/reel/AlsoSlow/',
        requestId: 'req-11',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    releaseFirst();
    await firstCall;
  });

  it('records a usage event on success', async () => {
    const { service, usageRecorder } = buildTranscriptionService();
    await service.transcribeVideo({
      url: 'https://www.instagram.com/reel/UsageTest/',
      requestId: 'req-12',
      signal: new AbortController().signal,
    });

    const events = usageRecorder.all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      requestId: 'req-12',
      source: 'instagram',
      videoDurationSeconds: 53.28,
      success: true,
      transcriptionProvider: 'fake',
      transcriptionModel: 'fake-model',
    });
  });

  it('propagates client cancellation as an AbortError rather than a MoreelError', async () => {
    const controller = new AbortController();
    const provider = new FakeInstagramProvider(
      (_url, options) =>
        new Promise<VideoAsset>((_resolve, reject) => {
          if (options.signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          options.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const { service } = buildTranscriptionService({ provider });

    const call = service.transcribeVideo({
      url: 'https://www.instagram.com/reel/CancelMe/',
      requestId: 'req-13',
      signal: controller.signal,
    });

    queueMicrotask(() => controller.abort());

    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
  });

  describe('vision pipeline', () => {
    const fakeFrames: FrameAsset[] = [
      { timestamp: 0, filePath: '/tmp/frame-000.jpg', contentType: 'image/jpeg', sizeBytes: 10 },
      { timestamp: 5, filePath: '/tmp/frame-005.jpg', contentType: 'image/jpeg', sizeBytes: 10 },
    ];

    function fakeFrameSampler(frames: FrameAsset[] = fakeFrames): FrameSampler {
      return { sample: async () => frames };
    }

    function fakeVisionProvider(
      analyze: VisionProvider['analyze'] = async () => [
        { timestamp: 0, type: 'on_screen_text', text: 'FIRST TIME FOUNDER', confidence: 0.9 },
      ],
    ): VisionProvider {
      return { provider: 'openai', model: 'gpt-4o-mini', analyze };
    }

    it('attaches visual observations to the result when vision is enabled', async () => {
      const { service } = buildTranscriptionService({
        visionEnabled: true,
        frameSampler: fakeFrameSampler(),
        visionProvider: fakeVisionProvider(),
      });

      const result = await service.transcribeVideo({
        url: 'https://www.instagram.com/reel/VisionTest/',
        requestId: 'req-vision-1',
        signal: new AbortController().signal,
      });

      expect(result.visual?.observations).toEqual([
        { timestamp: 0, type: 'on_screen_text', text: 'FIRST TIME FOUNDER', confidence: 0.9 },
      ]);
    });

    it('defaults to running vision when includeVisual is omitted (existing callers unaffected)', async () => {
      const analyze = vi.fn(async () => [{ timestamp: 0, type: 'on_screen_text' as const, text: 'seen' }]);
      const { service } = buildTranscriptionService({
        visionEnabled: true,
        frameSampler: fakeFrameSampler(),
        visionProvider: fakeVisionProvider(analyze),
      });

      const result = await service.transcribeVideo({
        url: 'https://www.instagram.com/reel/VisionDefault/',
        requestId: 'req-vision-default',
        signal: new AbortController().signal,
      });

      expect(analyze).toHaveBeenCalled();
      expect(result.visual?.observations).toEqual([{ timestamp: 0, type: 'on_screen_text', text: 'seen' }]);
    });

    it('skips vision for this request when includeVisual is explicitly false, even though the server supports it', async () => {
      const analyze = vi.fn(async () => [
        { timestamp: 0, type: 'on_screen_text' as const, text: 'should not appear' },
      ]);
      const { service } = buildTranscriptionService({
        visionEnabled: true,
        frameSampler: fakeFrameSampler(),
        visionProvider: fakeVisionProvider(analyze),
      });

      const result = await service.transcribeVideo({
        url: 'https://www.instagram.com/reel/VisionOptOut/',
        requestId: 'req-vision-optout',
        signal: new AbortController().signal,
        includeVisual: false,
      });

      expect(analyze).not.toHaveBeenCalled();
      expect(result.visual).toBeUndefined();
    });

    it('never runs the vision pipeline when VISION_ENABLED is false, even if a provider is supplied', async () => {
      const analyze = vi.fn(async () => [
        { timestamp: 0, type: 'on_screen_text' as const, text: 'should not appear' },
      ]);
      const { service } = buildTranscriptionService({
        visionEnabled: false,
        frameSampler: fakeFrameSampler(),
        visionProvider: fakeVisionProvider(analyze),
      });

      const result = await service.transcribeVideo({
        url: 'https://www.instagram.com/reel/VisionOff/',
        requestId: 'req-vision-2',
        signal: new AbortController().signal,
      });

      expect(result.visual).toBeUndefined();
      expect(analyze).not.toHaveBeenCalled();
    });

    it('passes the spoken transcript text as context to the vision provider', async () => {
      const analyze = vi.fn(async () => []);
      const { service } = buildTranscriptionService({
        visionEnabled: true,
        frameSampler: fakeFrameSampler(),
        visionProvider: fakeVisionProvider(analyze),
      });

      await service.transcribeVideo({
        url: 'https://www.instagram.com/reel/VisionContext/',
        requestId: 'req-vision-3',
        signal: new AbortController().signal,
      });

      expect(analyze).toHaveBeenCalledWith(
        fakeFrames,
        expect.objectContaining({ transcriptText: '10 out of 10 unusual hobbies.' }),
      );
    });

    it('omits the transcript text from vision context when it is low-confidence (possibly fabricated)', async () => {
      // A low-confidence transcript is often outright hallucinated (Whisper
      // inventing words on music/game audio/near-silence), not just
      // uncertain — passing that as trusted "what was said" context can
      // only mislead the vision model's judgment, never help it.
      const analyze = vi.fn(async () => []);
      const unreliableTranscriber: Transcriber = {
        provider: 'fake',
        model: 'fake-model',
        transcribe: async () => ({
          text: 'Minecraft Qu cochie Or until 1924 Thanks for watching',
          segments: [{ start: 7.84, end: 8.16, text: 'Minecraft Qu cochie Or until 1924 Thanks for watching' }],
          language: 'en',
          durationSeconds: 16.34,
          lowConfidence: true,
        }),
      };
      const { service } = buildTranscriptionService({
        visionEnabled: true,
        transcriber: unreliableTranscriber,
        frameSampler: fakeFrameSampler(),
        visionProvider: fakeVisionProvider(analyze),
      });

      await service.transcribeVideo({
        url: 'https://www.instagram.com/reel/UnreliableTranscript/',
        requestId: 'req-vision-unreliable',
        signal: new AbortController().signal,
      });

      expect(analyze).toHaveBeenCalledWith(fakeFrames, expect.objectContaining({ transcriptText: '' }));
    });

    it('swallows a vision provider failure and still returns the spoken transcript', async () => {
      const { service } = buildTranscriptionService({
        visionEnabled: true,
        frameSampler: fakeFrameSampler(),
        visionProvider: fakeVisionProvider(async () => {
          throw new Error('vision provider exploded');
        }),
      });

      const result = await service.transcribeVideo({
        url: 'https://www.instagram.com/reel/VisionFails/',
        requestId: 'req-vision-4',
        signal: new AbortController().signal,
      });

      expect(result.text).toBe('10 out of 10 unusual hobbies.');
      expect(result.visual).toBeUndefined();
    });

    it('swallows a frame sampling failure and still returns the spoken transcript', async () => {
      const failingSampler: FrameSampler = {
        sample: async () => {
          throw new Error('ffmpeg exploded');
        },
      };
      const { service } = buildTranscriptionService({
        visionEnabled: true,
        frameSampler: failingSampler,
        visionProvider: fakeVisionProvider(),
      });

      const result = await service.transcribeVideo({
        url: 'https://www.instagram.com/reel/FramesFail/',
        requestId: 'req-vision-5',
        signal: new AbortController().signal,
      });

      expect(result.text).toBe('10 out of 10 unusual hobbies.');
      expect(result.visual).toBeUndefined();
    });

    it('assigns frameId from onFramesSampled, matched by observation timestamp', async () => {
      const { service } = buildTranscriptionService({
        visionEnabled: true,
        frameSampler: fakeFrameSampler(),
        visionProvider: fakeVisionProvider(async () => [
          { timestamp: 0, type: 'on_screen_text', text: 'first' },
          { timestamp: 5, type: 'on_screen_text', text: 'second' },
        ]),
      });

      const result = await service.transcribeVideo({
        url: 'https://www.instagram.com/reel/FrameIds/',
        requestId: 'req-vision-6',
        signal: new AbortController().signal,
        onFramesSampled: (frames) => new Map(frames.map((f) => [f.timestamp, `stored-${f.timestamp}`])),
      });

      expect(result.visual?.observations).toEqual([
        { timestamp: 0, type: 'on_screen_text', text: 'first', frameId: 'stored-0' },
        { timestamp: 5, type: 'on_screen_text', text: 'second', frameId: 'stored-5' },
      ]);
    });
  });
});
