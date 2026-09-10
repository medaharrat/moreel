import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeTranscript } from '../../src/transcription/normalization.js';
import type { RawSegment } from '../../src/transcription/normalization.js';
import { wordErrorRate } from '../../src/transcription/wer.js';

/**
 * Regression suite over a fixed corpus of representative scenarios (see
 * test/fixtures/regression/README.md for why these are simulated provider
 * output rather than real audio + a live API call). Each fixture pins an
 * expected transcript and a maximum acceptable WER; a change to
 * normalization logic that meaningfully regresses quality fails this
 * suite, exactly as a change against real audio would.
 */

interface RegressionFixture {
  id: string;
  description: string;
  durationSeconds: number;
  language: string | null;
  rawSegments: RawSegment[];
  expectedText: string;
  maxWer: number;
  expectLowConfidence: boolean;
  expectEmpty: boolean;
}

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/regression',
);

async function loadFixtures(): Promise<RegressionFixture[]> {
  const files = (await readdir(fixturesDir)).filter((f) => f.endsWith('.json'));
  const fixtures = await Promise.all(
    files.map(async (file) => {
      const raw = await readFile(path.join(fixturesDir, file), 'utf8');
      return JSON.parse(raw) as RegressionFixture;
    }),
  );
  return fixtures.sort((a, b) => a.id.localeCompare(b.id));
}

describe('transcription regression corpus', () => {
  it('covers every required scenario category', async () => {
    const fixtures = await loadFixtures();
    const ids = fixtures.map((f) => f.id);
    const requiredCategories = [
      'clear-english-speech',
      'accented-speech',
      'fast-speech',
      'background-music',
      'multiple-speakers',
      'silence',
      'noisy-environment',
      'very-short-video',
      'longer-video',
      'non-english-speech',
      'mixed-language',
    ];
    for (const category of requiredCategories) {
      expect(ids).toContain(category);
    }
  });

  it('produces valid, monotonically sane timestamps for every fixture', async () => {
    const fixtures = await loadFixtures();
    for (const fixture of fixtures) {
      const transcript = normalizeTranscript(fixture.rawSegments, {
        language: fixture.language ?? undefined,
        durationSeconds: fixture.durationSeconds,
      });

      for (const segment of transcript.segments) {
        expect(segment.start, `${fixture.id}: segment start >= 0`).toBeGreaterThanOrEqual(0);
        expect(segment.end, `${fixture.id}: segment end > start`).toBeGreaterThan(segment.start);
        expect(segment.end, `${fixture.id}: segment end <= duration`).toBeLessThanOrEqual(
          fixture.durationSeconds + 0.001,
        );
      }
      for (let i = 1; i < transcript.segments.length; i++) {
        expect(
          transcript.segments[i]!.start,
          `${fixture.id}: segments are chronological`,
        ).toBeGreaterThanOrEqual(transcript.segments[i - 1]!.start);
      }
    }
  });

  it('never fabricates text for an empty-expected (silent) scenario', async () => {
    const fixtures = await loadFixtures();
    for (const fixture of fixtures.filter((f) => f.expectEmpty)) {
      const transcript = normalizeTranscript(fixture.rawSegments, {
        language: fixture.language ?? undefined,
        durationSeconds: fixture.durationSeconds,
      });
      expect(transcript.text, `${fixture.id}: expected empty transcript`).toBe('');
      expect(transcript.segments, `${fixture.id}: expected no segments`).toHaveLength(0);
    }
  });

  it('flags low confidence exactly where the corpus expects it', async () => {
    const fixtures = await loadFixtures();
    for (const fixture of fixtures) {
      const transcript = normalizeTranscript(fixture.rawSegments, {
        language: fixture.language ?? undefined,
        durationSeconds: fixture.durationSeconds,
      });
      expect(transcript.lowConfidence, `${fixture.id}: low_confidence flag`).toBe(
        fixture.expectLowConfidence,
      );
    }
  });

  it('stays within the WER regression threshold for every non-empty fixture', async () => {
    const fixtures = await loadFixtures();
    const report: Array<{ id: string; wer: number; maxWer: number }> = [];

    for (const fixture of fixtures.filter((f) => !f.expectEmpty)) {
      const transcript = normalizeTranscript(fixture.rawSegments, {
        language: fixture.language ?? undefined,
        durationSeconds: fixture.durationSeconds,
      });
      const wer = wordErrorRate(fixture.expectedText, transcript.text);
      report.push({ id: fixture.id, wer, maxWer: fixture.maxWer });
      expect(
        wer,
        `${fixture.id}: WER ${wer.toFixed(3)} exceeds threshold ${fixture.maxWer}`,
      ).toBeLessThanOrEqual(fixture.maxWer);
    }
  });

  it('never produces empty output for a fixture with expected speech', async () => {
    const fixtures = await loadFixtures();
    for (const fixture of fixtures.filter((f) => !f.expectEmpty)) {
      const transcript = normalizeTranscript(fixture.rawSegments, {
        language: fixture.language ?? undefined,
        durationSeconds: fixture.durationSeconds,
      });
      expect(transcript.text.length, `${fixture.id}: unexpected empty output`).toBeGreaterThan(0);
      expect(transcript.segments.length, `${fixture.id}: unexpected zero segments`).toBeGreaterThan(
        0,
      );
    }
  });
});
