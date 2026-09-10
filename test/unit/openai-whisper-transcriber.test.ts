import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAiWhisperTranscriber } from '../../src/transcription/whisper/openai-whisper-transcriber.js';
import type { AudioAsset } from '../../src/domain/transcript.js';

describe('OpenAiWhisperTranscriber', () => {
  let workDir: string;
  let audio: AudioAsset;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'moreel-whisper-test-'));
    const filePath = path.join(workDir, 'audio.wav');
    await writeFile(filePath, Buffer.alloc(1024, 1));
    audio = { filePath, format: 'wav', durationSeconds: 5, sizeBytes: 1024 };
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  const options = { signal: new AbortController().signal, timeoutMs: 10_000 };

  it('sends the audio file and returns a normalized transcript on success', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
      return new Response(
        JSON.stringify({
          text: 'hello world',
          language: 'en',
          duration: 5,
          segments: [
            { start: 0, end: 5, text: 'hello world', avg_logprob: -0.2, no_speech_prob: 0.01 },
          ],
        }),
        { status: 200 },
      );
    });

    const transcriber = new OpenAiWhisperTranscriber({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const transcript = await transcriber.transcribe(audio, options);
    expect(transcript.text).toBe('hello world');
    expect(transcript.language).toBe('en');
    expect(transcript.segments).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to top-level text when no segments are returned (very short clips)', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ text: 'hi', language: 'en', duration: 0.6 }), {
          status: 200,
        }),
    );
    const transcriber = new OpenAiWhisperTranscriber({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const transcript = await transcriber.transcribe(audio, options);
    expect(transcript.text).toBe('hi');
    expect(transcript.segments).toHaveLength(1);
  });

  it('retries on a 500 and succeeds on the next attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('server error', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: 'ok', segments: [{ start: 0, end: 1, text: 'ok' }] }), {
          status: 200,
        }),
      );

    const transcriber = new OpenAiWhisperTranscriber({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 3,
    });

    const transcript = await transcriber.transcribe(audio, options);
    expect(transcript.text).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps a 429 to RATE_LIMITED after exhausting retries', async () => {
    const fetchImpl = vi.fn(async () => new Response('too many requests', { status: 429 }));
    const transcriber = new OpenAiWhisperTranscriber({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 2,
    });

    await expect(transcriber.transcribe(audio, options)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400 client error and maps it to TRANSCRIPTION_FAILED', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad file', { status: 400 }));
    const transcriber = new OpenAiWhisperTranscriber({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 3,
    });

    await expect(transcriber.transcribe(audio, options)).rejects.toMatchObject({
      code: 'TRANSCRIPTION_FAILED',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('drops low-confidence, likely-silent segments rather than inventing text', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            text: 'real speech (music)',
            duration: 4,
            segments: [
              { start: 0, end: 2, text: 'real speech', avg_logprob: -0.1, no_speech_prob: 0.02 },
              { start: 2, end: 4, text: '(music)', avg_logprob: -0.3, no_speech_prob: 0.95 },
            ],
          }),
          { status: 200 },
        ),
    );

    const transcriber = new OpenAiWhisperTranscriber({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const transcript = await transcriber.transcribe(audio, options);
    expect(transcript.text).toBe('real speech');
    expect(transcript.lowConfidence).toBe(true);
  });

  it('requests both segment and word timestamp granularities', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      expect(form.getAll('timestamp_granularities[]')).toEqual(['segment', 'word']);
      return new Response(
        JSON.stringify({ text: 'hi', segments: [{ start: 0, end: 1, text: 'hi' }] }),
        { status: 200 },
      );
    });

    const transcriber = new OpenAiWhisperTranscriber({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await transcriber.transcribe(audio, options);
  });

  it('adaptively re-chunks a segment using word timestamps (a slow single phrase)', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            text: 'This changed my business',
            duration: 6,
            segments: [
              { start: 0, end: 6, text: 'This changed my business', avg_logprob: -0.2, no_speech_prob: 0.01 },
            ],
            words: [
              { word: 'This', start: 0, end: 0.4 },
              { word: 'changed', start: 1.5, end: 2.0 },
              { word: 'my', start: 3.2, end: 3.4 },
              { word: 'business', start: 4.8, end: 5.5 },
            ],
          }),
          { status: 200 },
        ),
    );

    const transcriber = new OpenAiWhisperTranscriber({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const transcript = await transcriber.transcribe(audio, options);
    // The single 6s Whisper segment becomes several finer, pause-anchored
    // sub-segments — the whole point of resegmentByWords.
    expect(transcript.segments.length).toBeGreaterThan(1);
    expect(transcript.segments.map((s) => s.text)).toEqual(['This', 'changed', 'my', 'business']);
    expect(transcript.text).toBe('This changed my business');
  });

  it('does not re-chunk when the model returns no word timestamps (unaffected fallback)', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            text: 'a long sentence with no words array at all',
            segments: [{ start: 0, end: 8, text: 'a long sentence with no words array at all' }],
          }),
          { status: 200 },
        ),
    );

    const transcriber = new OpenAiWhisperTranscriber({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const transcript = await transcriber.transcribe(audio, options);
    expect(transcript.segments).toHaveLength(1);
  });
});
