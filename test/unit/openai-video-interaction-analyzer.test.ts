import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAiVideoInteractionAnalyzer } from '../../src/vision/openai/openai-video-interaction-analyzer.js';
import type { FrameAsset } from '../../src/media/frames/frame-sampler.js';
import type { InteractionWindow } from '../../src/vision/video-interaction-analyzer.js';

function chatResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), { status });
}

describe('OpenAiVideoInteractionAnalyzer', () => {
  let workDir: string;
  let windows: InteractionWindow[];

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'moreel-interaction-test-'));
    const filePath = path.join(workDir, 'frame-001.jpg');
    await writeFile(filePath, Buffer.alloc(64, 1));
    const frame: FrameAsset = { timestamp: 4, filePath, contentType: 'image/jpeg', sizeBytes: 64 };
    windows = [{ timestamp: 4, transcriptText: 'This one is incredible.', frames: [frame] }];
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  const options = { signal: new AbortController().signal, timeoutMs: 10_000 };

  it('sends a single batched request across all windows and returns parsed results', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
      return chatResponse({
        entities: [{ label: 'pink phone case', type: 'product', confidence: 0.9 }],
        interactions: [
          { window_timestamp: 4, type: 'points_at', target_label: 'pink phone case', evidence_level: 'observed', confidence: 0.9 },
        ],
        references: [
          {
            window_timestamp: 4,
            phrase: 'this one',
            target_label: 'pink phone case',
            relation: 'refers_to',
            evidence_level: 'observed',
            confidence: 0.85,
          },
        ],
      });
    });

    const analyzer = new OpenAiVideoInteractionAnalyzer({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await analyzer.analyze(windows, options);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.entities).toEqual([{ label: 'pink phone case', type: 'product', confidence: 0.9 }]);
    expect(result.interactions).toEqual([
      { windowTimestamp: 4, type: 'points_at', targetLabel: 'pink phone case', evidenceLevel: 'observed', confidence: 0.9 },
    ]);
    expect(result.references).toEqual([
      {
        windowTimestamp: 4,
        phrase: 'this one',
        targetLabel: 'pink phone case',
        relation: 'refers_to',
        evidenceLevel: 'observed',
        confidence: 0.85,
      },
    ]);
  });

  it('returns empty results when given no windows, without calling the API', async () => {
    const fetchImpl = vi.fn();
    const analyzer = new OpenAiVideoInteractionAnalyzer({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(await analyzer.analyze([], options)).toEqual({ entities: [], interactions: [], references: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('strips the target from an interaction/reference marked uncertain, even if the model still included one', async () => {
    // The anti-hallucination contract enforced at the parsing layer, not
    // just the prompt — see the analyzer's own doc comment.
    const fetchImpl = vi.fn(async () =>
      chatResponse({
        entities: [],
        interactions: [
          { window_timestamp: 4, type: 'points_at', target_label: 'something', evidence_level: 'uncertain', confidence: 0.4 },
        ],
        references: [
          {
            window_timestamp: 4,
            phrase: 'this one',
            target_label: 'something',
            relation: 'refers_to',
            evidence_level: 'uncertain',
            confidence: 0.3,
          },
        ],
      }),
    );

    const analyzer = new OpenAiVideoInteractionAnalyzer({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await analyzer.analyze(windows, options);
    expect(result.interactions[0]?.targetLabel).toBeUndefined();
    expect(result.interactions[0]?.evidenceLevel).toBe('uncertain');
    expect(result.references[0]?.targetLabel).toBeUndefined();
  });

  it('drops entries with an unknown interaction type or reference relation rather than failing the whole call', async () => {
    const fetchImpl = vi.fn(async () =>
      chatResponse({
        entities: [],
        interactions: [
          { window_timestamp: 4, type: 'winks_at', evidence_level: 'observed', confidence: 0.9 },
          { window_timestamp: 5, type: 'shows', evidence_level: 'observed', confidence: 0.8 },
        ],
        references: [
          { window_timestamp: 4, phrase: 'huh', relation: 'gazes_upon', evidence_level: 'observed', confidence: 0.9 },
        ],
      }),
    );

    const analyzer = new OpenAiVideoInteractionAnalyzer({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await analyzer.analyze(windows, options);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0]?.type).toBe('shows');
    expect(result.references).toEqual([]);
  });

  it('defaults to evidence_level "uncertain" when the field is missing or invalid', async () => {
    const fetchImpl = vi.fn(async () =>
      chatResponse({
        entities: [],
        interactions: [{ window_timestamp: 4, type: 'shows', target_label: 'thing', confidence: 0.9 }],
        references: [],
      }),
    );

    const analyzer = new OpenAiVideoInteractionAnalyzer({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await analyzer.analyze(windows, options);
    expect(result.interactions[0]?.evidenceLevel).toBe('uncertain');
    expect(result.interactions[0]?.targetLabel).toBeUndefined();
  });

  it('retries on a 500 and succeeds on the next attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('server error', { status: 500 }))
      .mockResolvedValueOnce(chatResponse({ entities: [], interactions: [], references: [] }));

    const analyzer = new OpenAiVideoInteractionAnalyzer({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 3,
    });

    await analyzer.analyze(windows, options);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps a 429 to RATE_LIMITED after exhausting retries', async () => {
    const fetchImpl = vi.fn(async () => new Response('too many requests', { status: 429 }));
    const analyzer = new OpenAiVideoInteractionAnalyzer({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 2,
    });

    await expect(analyzer.analyze(windows, options)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
