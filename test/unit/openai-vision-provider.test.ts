import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAiVisionProvider } from '../../src/vision/openai/openai-vision-provider.js';
import type { FrameAsset } from '../../src/media/frames/frame-sampler.js';

function chatResponse(observations: unknown[], status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ observations }) } }] }),
    { status },
  );
}

describe('OpenAiVisionProvider', () => {
  let workDir: string;
  let frames: FrameAsset[];

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'moreel-vision-test-'));
    const filePath = path.join(workDir, 'frame-001.jpg');
    await writeFile(filePath, Buffer.alloc(64, 1));
    frames = [{ timestamp: 0, filePath, contentType: 'image/jpeg', sizeBytes: 64 }];
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  const options = { signal: new AbortController().signal, timeoutMs: 10_000, transcriptText: 'hello' };

  it('sends a single batched request for all frames and returns parsed observations', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
      const body = JSON.parse(init.body as string);
      expect(body.messages).toHaveLength(2);
      // one text intro + (text label + image) per frame
      expect(body.messages[1].content).toHaveLength(1 + frames.length * 2);
      return chatResponse([{ timestamp: 0, type: 'on_screen_text', text: 'FIRST TIME FOUNDER', confidence: 0.9 }]);
    });

    const provider = new OpenAiVisionProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const observations = await provider.analyze(frames, options);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(observations).toEqual([
      { timestamp: 0, type: 'on_screen_text', text: 'FIRST TIME FOUNDER', confidence: 0.9 },
    ]);
  });

  it('returns an empty array when given no frames, without calling the API', async () => {
    const fetchImpl = vi.fn();
    const provider = new OpenAiVisionProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const observations = await provider.analyze([], options);
    expect(observations).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('drops malformed observation entries rather than failing the whole call', async () => {
    const fetchImpl = vi.fn(async () =>
      chatResponse([
        { timestamp: 0, type: 'on_screen_text', text: 'valid' },
        { timestamp: 'not-a-number', type: 'on_screen_text', text: 'bad timestamp' },
        { timestamp: 1, type: 'not_a_real_type', text: 'bad type' },
        { timestamp: 2, type: 'on_screen_text', text: '' },
        { timestamp: 3, type: 'scene' }, // missing text
      ]),
    );

    const provider = new OpenAiVisionProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const observations = await provider.analyze(frames, options);
    expect(observations).toEqual([{ timestamp: 0, type: 'on_screen_text', text: 'valid' }]);
  });

  it('collapses consecutive observations with the same type/text into one span, from earliest to latest timestamp', async () => {
    const fetchImpl = vi.fn(async () =>
      chatResponse([
        { timestamp: 0, type: 'on_screen_text', text: 'Apple is so evil bro' },
        { timestamp: 5, type: 'on_screen_text', text: 'Apple is so evil bro' },
        { timestamp: 10, type: 'on_screen_text', text: 'Apple is so evil bro' },
        { timestamp: 15, type: 'on_screen_text', text: 'iPhone 18' },
        { timestamp: 20, type: 'on_screen_text', text: 'iPhone 18' },
      ]),
    );

    const provider = new OpenAiVisionProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const observations = await provider.analyze(frames, options);
    expect(observations).toEqual([
      { timestamp: 0, endTimestamp: 10, type: 'on_screen_text', text: 'Apple is so evil bro' },
      { timestamp: 15, endTimestamp: 20, type: 'on_screen_text', text: 'iPhone 18' },
    ]);
  });

  it('does not dedupe the same text if it recurs non-consecutively (a real re-appearance)', async () => {
    const fetchImpl = vi.fn(async () =>
      chatResponse([
        { timestamp: 0, type: 'on_screen_text', text: 'A' },
        { timestamp: 5, type: 'on_screen_text', text: 'B' },
        { timestamp: 10, type: 'on_screen_text', text: 'A' },
      ]),
    );

    const provider = new OpenAiVisionProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const observations = await provider.analyze(frames, options);
    expect(observations).toEqual([
      { timestamp: 0, type: 'on_screen_text', text: 'A' },
      { timestamp: 5, type: 'on_screen_text', text: 'B' },
      { timestamp: 10, type: 'on_screen_text', text: 'A' },
    ]);
  });

  it('returns an empty array when the model returns zero observations', async () => {
    const fetchImpl = vi.fn(async () => chatResponse([]));
    const provider = new OpenAiVisionProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(await provider.analyze(frames, options)).toEqual([]);
  });

  it('retries on a 500 and succeeds on the next attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('server error', { status: 500 }))
      .mockResolvedValueOnce(chatResponse([{ timestamp: 0, type: 'scene', text: 'ok' }]));

    const provider = new OpenAiVisionProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 3,
    });

    const observations = await provider.analyze(frames, options);
    expect(observations).toEqual([{ timestamp: 0, type: 'scene', text: 'ok' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps a 429 to RATE_LIMITED after exhausting retries', async () => {
    const fetchImpl = vi.fn(async () => new Response('too many requests', { status: 429 }));
    const provider = new OpenAiVisionProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 2,
    });

    await expect(provider.analyze(frames, options)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400 client error and maps it to VISION_ANALYSIS_FAILED', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad request', { status: 400 }));
    const provider = new OpenAiVisionProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 3,
    });

    await expect(provider.analyze(frames, options)).rejects.toMatchObject({
      code: 'VISION_ANALYSIS_FAILED',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
