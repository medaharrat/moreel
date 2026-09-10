import { readFile } from 'node:fs/promises';
import { ErrorCode, MoreelError } from '../../domain/errors.js';
import type { VisualObservationType, VisualObservation } from '../../domain/vision.js';
import type { FrameAsset } from '../../media/frames/frame-sampler.js';
import { withRetry } from '../../util/retry.js';
import type { VisionAnalyzeOptions, VisionProvider } from '../vision-provider.js';

export interface OpenAiVisionProviderOptions {
  apiKey: string;
  baseUrl: string;
  model?: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
}

const OBSERVATION_TYPES: ReadonlySet<VisualObservationType> = new Set([
  'on_screen_text',
  'visual_context',
  'scene',
  'object',
  'ui',
  'chart',
  'document',
  'product',
  'logo',
]);

/**
 * The filtering rules are the whole point of this feature — encoded here,
 * not left to a generic "describe this image" prompt, so the model does the
 * "is this worth knowing" judgment itself instead of us post-filtering a
 * flood of trivial captions.
 */
const SYSTEM_PROMPT = `You are watching a short video alongside its spoken transcript, looking for VISUAL information a reader could not get from the transcript alone.

Report only:
- clearly readable on-screen text, slides, captions, UI, documents, charts, signs
- products being demonstrated, important objects
- meaningful scene changes or visual actions that materially affect the meaning
- people/subjects when identifying them helps understand the content
- visual references the speaker is clearly talking about

Never report trivial activity: someone blinking, a hand moving, sitting down, camera motion, what someone is wearing, or any other visual detail that would not help someone understand the video without watching it.

Prefer FEWER, higher-value observations. If in doubt, leave it out. Critically: if the SAME on-screen text or scene is still visible across multiple consecutive frames, that is ONE observation, not one per frame — report it a single time, at the timestamp where it first appears. Only report it again later if it actually changed to something new.

For on-screen text, preserve the exact characters you can read — do not correct spelling or guess at unclear text. If you're not confident in a text reading, still include it but set a lower confidence.

Respond with strict JSON only, no prose, matching exactly:
{"observations": [{"timestamp": <number, seconds>, "type": "on_screen_text"|"visual_context"|"scene"|"object"|"ui"|"chart"|"document"|"product"|"logo", "text": "<string>", "confidence": <number 0-1, optional>}]}

Each frame you're shown is labeled with its own timestamp — use that exact timestamp for observations from that frame. Return {"observations": []} if nothing meets the bar above.`;

interface RawVisionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * `VisionProvider` backed by OpenAI's chat completions vision support. One
 * call per `analyze()` — every sampled frame plus the transcript goes into
 * a single request, so API call count is ~1/video regardless of frame
 * count, and the model can cross-reference frames against each other and
 * against what's being said rather than judging each frame in isolation.
 */
export class OpenAiVisionProvider implements VisionProvider {
  readonly provider = 'openai';
  readonly model: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;

  constructor(options: OpenAiVisionProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model ?? 'gpt-4o-mini';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  async analyze(frames: FrameAsset[], options: VisionAnalyzeOptions): Promise<VisualObservation[]> {
    if (frames.length === 0) return [];

    const content = await this.buildContent(frames, options.transcriptText);

    let raw: RawVisionResponse;
    try {
      raw = await withRetry(() => this.callApi(content, options), {
        maxAttempts: this.maxAttempts,
        baseDelayMs: 300,
        maxDelayMs: 4_000,
        signal: options.signal,
        isRetryable: (error) => error instanceof RetryableVisionError,
      });
    } catch (error) {
      if (error instanceof RetryableVisionError) {
        throw new MoreelError(error.moreelCode, undefined, { cause: error });
      }
      throw error;
    }

    return dedupeConsecutive(parseObservations(raw));
  }

  private async buildContent(
    frames: FrameAsset[],
    transcriptText: string,
  ): Promise<Array<Record<string, unknown>>> {
    const parts: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: `Spoken transcript:\n${transcriptText || '(no speech detected)'}\n\nFrames follow, each labeled with its timestamp.`,
      },
    ];

    for (const frame of frames) {
      const buffer = await readFile(frame.filePath);
      const dataUrl = `data:${frame.contentType};base64,${buffer.toString('base64')}`;
      parts.push({ type: 'text', text: `Frame at ${frame.timestamp}s:` });
      parts.push({ type: 'image_url', image_url: { url: dataUrl } });
    }

    return parts;
  }

  private async callApi(
    content: Array<Record<string, unknown>>,
    options: VisionAnalyzeOptions,
  ): Promise<RawVisionResponse> {
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const signal = AbortSignal.any([options.signal, timeoutSignal]);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content },
          ],
          response_format: { type: 'json_object' },
        }),
        signal,
      });
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') {
        throw new MoreelError(ErrorCode.VISION_ANALYSIS_FAILED, 'Vision analysis timed out.', { cause: error });
      }
      if ((error as Error).name === 'AbortError') {
        throw error;
      }
      throw new RetryableVisionError('Network error calling vision provider.', { cause: error });
    }

    if (response.status === 429) {
      throw new RetryableVisionError('Vision provider rate-limited the request.', {
        code: ErrorCode.RATE_LIMITED,
      });
    }
    if (response.status >= 500) {
      throw new RetryableVisionError('Vision provider returned a server error.');
    }
    if (!response.ok) {
      const body = await safeReadText(response);
      throw new MoreelError(ErrorCode.VISION_ANALYSIS_FAILED, undefined, {
        details: { httpStatus: response.status },
        cause: new Error(body),
      });
    }

    return (await response.json()) as RawVisionResponse;
  }
}

/**
 * Parses the model's JSON reply defensively — a malformed individual
 * observation is dropped, not treated as a reason to fail the whole
 * request. Never invents/corrects text; unparseable entries are simply
 * excluded.
 */
function parseObservations(raw: RawVisionResponse): VisualObservation[] {
  const text = raw.choices?.[0]?.message?.content;
  if (!text) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  const list = (parsed as { observations?: unknown })?.observations;
  if (!Array.isArray(list)) return [];

  const observations: VisualObservation[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const candidate = item as Record<string, unknown>;
    const timestamp = candidate.timestamp;
    const type = candidate.type;
    const text = candidate.text;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) continue;
    if (typeof type !== 'string' || !OBSERVATION_TYPES.has(type as VisualObservationType)) continue;
    if (typeof text !== 'string' || text.trim().length === 0) continue;

    const confidence = candidate.confidence;
    observations.push({
      timestamp,
      type: type as VisualObservationType,
      text,
      ...(typeof confidence === 'number' && Number.isFinite(confidence) ? { confidence } : {}),
    });
  }
  return observations;
}

/**
 * Belt-and-suspenders for the "one observation per persisting moment, not
 * per frame" rule — the prompt asks for this, but a model won't always
 * comply, and a UI listing eight near-identical "Apple is so evil bro"
 * footnotes back-to-back is exactly the low-value flood this feature exists
 * to avoid. Collapses consecutive (by timestamp) observations that share
 * the same type and text into a single observation spanning the whole
 * period they were seen — `timestamp` stays the first occurrence,
 * `endTimestamp` becomes the last, so on-screen text visible for 15 seconds
 * across several sampled frames is one observation with a time range, not
 * one per frame and not a single instant that hides how long it was shown.
 */
function dedupeConsecutive(observations: VisualObservation[]): VisualObservation[] {
  const sorted = [...observations].sort((a, b) => a.timestamp - b.timestamp);
  const result: VisualObservation[] = [];
  for (const obs of sorted) {
    const prev = result[result.length - 1];
    if (prev && prev.type === obs.type && prev.text === obs.text) {
      prev.endTimestamp = obs.timestamp;
      continue;
    }
    result.push({ ...obs });
  }
  return result;
}

class RetryableVisionError extends Error {
  readonly moreelCode: (typeof ErrorCode)[keyof typeof ErrorCode];
  constructor(
    message: string,
    opts: { cause?: unknown; code?: (typeof ErrorCode)[keyof typeof ErrorCode] } = {},
  ) {
    super(message);
    this.name = 'RetryableVisionError';
    this.moreelCode = opts.code ?? ErrorCode.VISION_ANALYSIS_FAILED;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
