import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildVideoMap } from '../../src/app/video-map-builder.js';
import type { Transcript } from '../../src/domain/transcript.js';
import type { VideoAsset } from '../../src/domain/transcript.js';
import type { FrameAsset, FrameSampler, SampleAtOptions } from '../../src/media/frames/frame-sampler.js';
import type {
  InteractionAnalysisResult,
  InteractionAnalyzeOptions,
  InteractionWindow,
  VideoInteractionAnalyzer,
} from '../../src/vision/video-interaction-analyzer.js';

function transcript(segments: Array<{ start: number; end: number; text: string }>): Transcript {
  return {
    text: segments.map((s) => s.text).join(' '),
    segments,
    language: 'en',
    durationSeconds: (segments[segments.length - 1]?.end ?? 0) + 5,
    lowConfidence: false,
  };
}

class FakeAnalyzer implements VideoInteractionAnalyzer {
  readonly provider = 'fake';
  readonly model = 'fake-model';
  calls: InteractionWindow[][] = [];

  constructor(private readonly result: InteractionAnalysisResult) {}

  async analyze(windows: InteractionWindow[], _options: InteractionAnalyzeOptions): Promise<InteractionAnalysisResult> {
    this.calls.push(windows);
    return this.result;
  }
}

class FakeFrameSampler implements FrameSampler {
  sampleAtCalls: number[][] = [];
  constructor(private readonly extracted: FrameAsset[]) {}

  async sample(): Promise<FrameAsset[]> {
    throw new Error('not used in these tests');
  }

  async sampleAt(_video: VideoAsset, timestamps: number[], _options: SampleAtOptions): Promise<FrameAsset[]> {
    this.sampleAtCalls.push(timestamps);
    return this.extracted;
  }
}

const video: VideoAsset = {
  filePath: '/tmp/fake.mp4',
  contentType: 'video/mp4',
  sizeBytes: 100,
  durationSeconds: 60,
  source: 'instagram',
  sourceUrl: 'https://www.instagram.com/reel/abc/',
};

describe('buildVideoMap', () => {
  let workDir: string;
  let frame: FrameAsset;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'moreel-map-test-'));
    const filePath = path.join(workDir, 'frame.jpg');
    await writeFile(filePath, Buffer.alloc(64, 1));
    frame = { timestamp: 4, filePath, contentType: 'image/jpeg', sizeBytes: 64 };
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  function baseOptions() {
    return { video, workDir, signal: new AbortController().signal, timeoutMs: 10_000, maxWindows: 8 };
  }

  it('resolves an entity, interaction, and reference for a "this one" + pointing scenario', async () => {
    // Scenario 1 from the benchmark list: person pointing at a product while saying "this one".
    const t = transcript([{ start: 4, end: 6, text: 'This one is incredible.' }]);
    const analyzer = new FakeAnalyzer({
      entities: [{ label: 'pink phone case', type: 'product', confidence: 0.9 }],
      interactions: [
        { windowTimestamp: 4, type: 'points_at', targetLabel: 'pink phone case', evidenceLevel: 'observed', confidence: 0.92 },
      ],
      references: [
        {
          windowTimestamp: 4,
          phrase: 'this one',
          targetLabel: 'pink phone case',
          relation: 'refers_to',
          evidenceLevel: 'observed',
          confidence: 0.88,
        },
      ],
    });

    const result = await buildVideoMap({ ...baseOptions(), transcript: t, existingFrames: [frame], analyzer });

    expect(result.entities).toHaveLength(1);
    const entity = result.entities[0]!;
    expect(entity.label).toBe('pink phone case');
    expect(entity.type).toBe('product');

    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0]).toMatchObject({ type: 'points_at', targetEntityId: entity.id, evidenceLevel: 'observed' });

    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({
      phrase: 'this one',
      targetEntityId: entity.id,
      relation: 'refers_to',
      segmentIndex: 0,
    });
  });

  it('reuses the same entity id when the analyzer repeats the same label across windows (entity resolution)', async () => {
    // Scenario 5/7 from the benchmark list: an object recurring across
    // multiple moments should resolve to one entity, not several.
    const t = transcript([
      { start: 2, end: 3, text: 'Look at this product.' },
      { start: 20, end: 21, text: 'Here it is again, this product.' },
    ]);
    const secondFrame: FrameAsset = { ...frame, timestamp: 20 };
    const analyzer = new FakeAnalyzer({
      entities: [{ label: 'blue sneaker', type: 'product', confidence: 0.9 }],
      interactions: [
        { windowTimestamp: 2, type: 'shows', targetLabel: 'blue sneaker', evidenceLevel: 'observed', confidence: 0.9 },
        { windowTimestamp: 20, type: 'holds', targetLabel: 'blue sneaker', evidenceLevel: 'observed', confidence: 0.85 },
      ],
      references: [],
    });

    const result = await buildVideoMap({
      ...baseOptions(),
      transcript: t,
      existingFrames: [frame, secondFrame],
      analyzer,
    });

    expect(result.entities).toHaveLength(1);
    const [entity] = result.entities;
    expect(result.interactions).toHaveLength(2);
    expect(result.interactions.every((i) => i.targetEntityId === entity!.id)).toBe(true);
    // firstSeen/lastSeen widen to cover every timestamp the entity was referenced at.
    expect(entity!.firstSeen).toBe(2);
    expect(entity!.lastSeen).toBe(20);
  });

  it('never fabricates a target when evidence_level is uncertain', async () => {
    const t = transcript([{ start: 4, end: 6, text: 'That one, maybe?' }]);
    const analyzer = new FakeAnalyzer({
      entities: [],
      interactions: [],
      references: [
        {
          windowTimestamp: 4,
          phrase: 'that one',
          // The analyzer itself is defensively parsed too (see
          // openai-video-interaction-analyzer.test.ts) — this test covers
          // the builder's own contract: an uncertain reference with no
          // targetLabel must never end up with a targetEntityId.
          relation: 'refers_to',
          evidenceLevel: 'uncertain',
          confidence: 0.3,
        },
      ],
    });

    const result = await buildVideoMap({ ...baseOptions(), transcript: t, existingFrames: [frame], analyzer });

    expect(result.entities).toEqual([]);
    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.targetEntityId).toBeUndefined();
    expect(result.references[0]?.evidenceLevel).toBe('uncertain');
  });

  it('defensively creates an entity for a target label the analyzer used but never declared up front', async () => {
    const t = transcript([{ start: 4, end: 6, text: 'This is my favorite.' }]);
    const analyzer = new FakeAnalyzer({
      entities: [], // Model forgot to declare it in "entities" but still used it as a target.
      interactions: [
        { windowTimestamp: 4, type: 'holds', targetLabel: 'red mug', evidenceLevel: 'observed', confidence: 0.7 },
      ],
      references: [],
    });

    const result = await buildVideoMap({ ...baseOptions(), transcript: t, existingFrames: [frame], analyzer });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.label).toBe('red mug');
    expect(result.interactions[0]?.targetEntityId).toBe(result.entities[0]?.id);
  });

  it('reuses an existing nearby sampled frame instead of extracting a new one', async () => {
    const t = transcript([{ start: 4, end: 6, text: 'This one is incredible.' }]);
    const analyzer = new FakeAnalyzer({ entities: [], interactions: [], references: [] });
    const sampler = new FakeFrameSampler([]);

    await buildVideoMap({ ...baseOptions(), transcript: t, existingFrames: [frame], analyzer, frameSampler: sampler });

    expect(sampler.sampleAtCalls).toHaveLength(0);
    expect(analyzer.calls).toHaveLength(1);
    expect(analyzer.calls[0]?.[0]?.frames).toEqual([frame]);
  });

  it('extracts a targeted frame only for windows with no nearby existing frame', async () => {
    const t = transcript([
      { start: 4, end: 6, text: 'This one is incredible.' }, // covered by `frame` at t=4
      { start: 40, end: 42, text: 'Look at that camera.' }, // nothing nearby
    ]);
    const extracted: FrameAsset = { timestamp: 40, filePath: frame.filePath, contentType: 'image/jpeg', sizeBytes: 64 };
    const analyzer = new FakeAnalyzer({ entities: [], interactions: [], references: [] });
    const sampler = new FakeFrameSampler([extracted]);

    await buildVideoMap({ ...baseOptions(), transcript: t, existingFrames: [frame], analyzer, frameSampler: sampler });

    expect(sampler.sampleAtCalls).toEqual([[40]]);
    expect(analyzer.calls[0]).toHaveLength(2);
  });

  it('skips a window entirely (never calls the analyzer for it) when no frame is available at all', async () => {
    const t = transcript([{ start: 40, end: 42, text: 'Look at that camera.' }]);
    const analyzer = new FakeAnalyzer({ entities: [], interactions: [], references: [] });

    // No existingFrames nearby, and no frameSampler provided at all.
    const result = await buildVideoMap({ ...baseOptions(), transcript: t, existingFrames: [], analyzer });

    expect(analyzer.calls).toEqual([]);
    expect(result.interactions).toEqual([]);
    expect(result.references).toEqual([]);
  });

  it('returns empty results without calling the analyzer when the transcript has no trigger phrases', async () => {
    const t = transcript([{ start: 0, end: 2, text: 'Hello everyone, welcome back to the channel.' }]);
    const analyzer = new FakeAnalyzer({ entities: [], interactions: [], references: [] });

    const result = await buildVideoMap({ ...baseOptions(), transcript: t, existingFrames: [frame], analyzer });

    expect(analyzer.calls).toEqual([]);
    expect(result.entities).toEqual([]);
    expect(result.interactions).toEqual([]);
    expect(result.references).toEqual([]);
  });

  it('derives scenes from sorted existing-frame boundaries at zero extra cost', async () => {
    const t = transcript([{ start: 0, end: 25, text: 'no trigger here' }]);
    const analyzer = new FakeAnalyzer({ entities: [], interactions: [], references: [] });
    const frames: FrameAsset[] = [
      { timestamp: 10, filePath: frame.filePath, contentType: 'image/jpeg', sizeBytes: 1 },
      { timestamp: 0, filePath: frame.filePath, contentType: 'image/jpeg', sizeBytes: 1 },
      { timestamp: 20, filePath: frame.filePath, contentType: 'image/jpeg', sizeBytes: 1 },
    ];

    const result = await buildVideoMap({ ...baseOptions(), transcript: t, existingFrames: frames, analyzer });

    expect(result.scenes.map((s) => [s.startTimestamp, s.endTimestamp])).toEqual([
      [0, 10],
      [10, 20],
      [20, t.durationSeconds],
    ]);
  });
});
