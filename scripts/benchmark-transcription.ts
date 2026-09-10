#!/usr/bin/env tsx
/**
 * npm run benchmark:transcription
 *
 * Quality + latency benchmark for the transcription stage, over the same
 * fixture corpus used by the regression test suite (see
 * test/fixtures/regression/README.md for why these are simulated provider
 * output rather than real audio + a live paid API call by default).
 *
 * Reports WER, CER, latency (avg/p50/p95/p99), success rate, and failure
 * categories — the baseline this project asks for before optimizing
 * anything (spec section 10). Exits non-zero if any fixture regresses
 * past its recorded WER threshold, so this can be wired into a dedicated
 * CI benchmark workflow as a quality gate.
 *
 * Live mode: set OPENAI_API_KEY and MOREEL_BENCHMARK_AUDIO_DIR (a directory
 * of "<id>.wav" + "<id>.txt" reference-transcript pairs) and pass --live to
 * benchmark against the real configured transcription provider instead of
 * the synthetic latency model. Not run in CI by default, per the "do not
 * depend on a paid external API" requirement.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTranscript } from '../src/transcription/normalization.js';
import type { RawSegment } from '../src/transcription/normalization.js';
import { characterErrorRate, wordErrorRate } from '../src/transcription/wer.js';
import { OpenAiWhisperTranscriber } from '../src/transcription/whisper/openai-whisper-transcriber.js';
import { loadConfig } from '../src/config/index.js';

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

interface FixtureRunResult {
  id: string;
  success: boolean;
  wer?: number;
  cer?: number;
  maxWer: number;
  regressed: boolean;
  latencyMs: number;
  failureCategory?: string;
}

const isLive = process.argv.includes('--live');
const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../test/fixtures/regression',
);

async function loadFixtures(): Promise<RegressionFixture[]> {
  const files = (await readdir(fixturesDir)).filter((f) => f.endsWith('.json'));
  return Promise.all(
    files.map(
      async (file) =>
        JSON.parse(await readFile(path.join(fixturesDir, file), 'utf8')) as RegressionFixture,
    ),
  );
}

/**
 * Synthetic latency model standing in for a real Whisper-class API call:
 * a fixed request overhead plus a per-second-of-audio processing cost and
 * jitter, roughly modeled on typical hosted ASR latency. Clearly labeled
 * wherever it's reported — never conflated with real measurements.
 */
function syntheticLatencyMs(durationSeconds: number): number {
  const baseOverheadMs = 250;
  const perSecondMs = 60;
  const jitterMs = Math.random() * 150;
  return baseOverheadMs + durationSeconds * perSecondMs + jitterMs;
}

async function runFixture(fixture: RegressionFixture): Promise<FixtureRunResult> {
  const start = performance.now();
  try {
    if (!isLive) {
      await sleep(syntheticLatencyMs(fixture.durationSeconds));
    }
    const transcript = normalizeTranscript(fixture.rawSegments, {
      language: fixture.language ?? undefined,
      durationSeconds: fixture.durationSeconds,
    });
    const latencyMs = performance.now() - start;

    if (fixture.expectEmpty) {
      return { id: fixture.id, success: true, maxWer: fixture.maxWer, regressed: false, latencyMs };
    }

    const wer = wordErrorRate(fixture.expectedText, transcript.text);
    const cer = characterErrorRate(fixture.expectedText, transcript.text);
    return {
      id: fixture.id,
      success: true,
      wer,
      cer,
      maxWer: fixture.maxWer,
      regressed: wer > fixture.maxWer,
      latencyMs,
    };
  } catch (error) {
    return {
      id: fixture.id,
      success: false,
      maxWer: fixture.maxWer,
      regressed: false,
      latencyMs: performance.now() - start,
      failureCategory: error instanceof Error ? error.constructor.name : 'UnknownError',
    };
  }
}

async function runFixtureLive(
  fixture: RegressionFixture,
  audioDir: string,
): Promise<FixtureRunResult> {
  const start = performance.now();
  try {
    const config = loadConfig(process.env);
    const transcriber = new OpenAiWhisperTranscriber({
      apiKey: config.openaiApiKey!,
      baseUrl: config.openaiBaseUrl,
      model: config.transcriptionModel,
    });
    const audioPath = path.join(audioDir, `${fixture.id}.wav`);
    const transcript = await transcriber.transcribe(
      {
        filePath: audioPath,
        format: 'wav',
        durationSeconds: fixture.durationSeconds,
        sizeBytes: 0,
      },
      {
        signal: AbortSignal.timeout(config.transcriptionTimeoutMs),
        timeoutMs: config.transcriptionTimeoutMs,
      },
    );
    const latencyMs = performance.now() - start;
    const wer = wordErrorRate(fixture.expectedText, transcript.text);
    const cer = characterErrorRate(fixture.expectedText, transcript.text);
    return {
      id: fixture.id,
      success: true,
      wer,
      cer,
      maxWer: fixture.maxWer,
      regressed: wer > fixture.maxWer,
      latencyMs,
    };
  } catch (error) {
    return {
      id: fixture.id,
      success: false,
      maxWer: fixture.maxWer,
      regressed: false,
      latencyMs: performance.now() - start,
      failureCategory: error instanceof Error ? error.constructor.name : 'UnknownError',
    };
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const fixtures = await loadFixtures();
  const audioDir = process.env.MOREEL_BENCHMARK_AUDIO_DIR;

  if (isLive && !audioDir) {
    console.error(
      '--live requires MOREEL_BENCHMARK_AUDIO_DIR pointing to "<id>.wav" fixture audio files.',
    );
    process.exit(1);
  }

  const results: FixtureRunResult[] = [];
  for (const fixture of fixtures) {
    results.push(isLive ? await runFixtureLive(fixture, audioDir!) : await runFixture(fixture));
  }

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const successCount = results.filter((r) => r.success).length;
  const wers = results.filter((r): r is FixtureRunResult & { wer: number } => r.wer !== undefined);
  const avgWer = wers.length > 0 ? wers.reduce((s, r) => s + r.wer, 0) / wers.length : 0;
  const avgCer =
    results.filter((r) => r.cer !== undefined).reduce((s, r) => s + (r.cer ?? 0), 0) /
      Math.max(1, results.filter((r) => r.cer !== undefined).length) || 0;
  const failureCategories = results
    .filter((r) => !r.success)
    .reduce<Record<string, number>>((acc, r) => {
      const key = r.failureCategory ?? 'Unknown';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

  console.log(`\nMoreel transcription benchmark ${isLive ? '(LIVE)' : '(synthetic latency model)'}`);
  console.log('='.repeat(72));
  console.log(
    `${'fixture'.padEnd(24)}${'WER'.padEnd(8)}${'CER'.padEnd(8)}${'latency(ms)'.padEnd(14)}${'status'}`,
  );
  for (const r of results) {
    const status = !r.success ? `FAIL (${r.failureCategory})` : r.regressed ? 'REGRESSED' : 'ok';
    console.log(
      `${r.id.padEnd(24)}${(r.wer?.toFixed(3) ?? '-').padEnd(8)}${(r.cer?.toFixed(3) ?? '-').padEnd(8)}${r.latencyMs
        .toFixed(0)
        .padEnd(14)}${status}`,
    );
  }
  console.log('='.repeat(72));
  console.log(`Fixtures:        ${results.length}`);
  console.log(`Success rate:    ${((successCount / results.length) * 100).toFixed(1)}%`);
  console.log(`Average WER:     ${avgWer.toFixed(3)}`);
  console.log(`Average CER:     ${avgCer.toFixed(3)}`);
  console.log(
    `Avg latency:     ${(latencies.reduce((s, v) => s + v, 0) / latencies.length).toFixed(1)}ms`,
  );
  console.log(`p50 latency:     ${percentile(latencies, 0.5).toFixed(1)}ms`);
  console.log(`p95 latency:     ${percentile(latencies, 0.95).toFixed(1)}ms`);
  console.log(`p99 latency:     ${percentile(latencies, 0.99).toFixed(1)}ms`);
  if (Object.keys(failureCategories).length > 0) {
    console.log(`Failure categories: ${JSON.stringify(failureCategories)}`);
  }

  const outDir = path.join(process.cwd(), 'benchmark-results');
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(
    outDir,
    `transcription-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  await writeFile(
    outFile,
    JSON.stringify(
      { mode: isLive ? 'live' : 'synthetic', generatedAt: new Date().toISOString(), results },
      null,
      2,
    ),
  );
  console.log(`\nResults written to ${path.relative(process.cwd(), outFile)}`);

  const regressed = results.filter((r) => r.regressed);
  if (regressed.length > 0) {
    console.error(
      `\nQuality regression: ${regressed.map((r) => r.id).join(', ')} exceeded their WER threshold.`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
