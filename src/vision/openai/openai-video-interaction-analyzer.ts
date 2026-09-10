import { readFile } from 'node:fs/promises';
import { ErrorCode, MoreelError } from '../../domain/errors.js';
import type { EntityType, EvidenceLevel, InteractionType, ReferenceRelation } from '../../domain/video-map.js';
import { withRetry } from '../../util/retry.js';
import type {
  InteractionAnalysisResult,
  InteractionAnalyzeOptions,
  InteractionWindow,
  RawEntity,
  RawInteraction,
  RawReference,
  VideoInteractionAnalyzer,
} from '../video-interaction-analyzer.js';

export interface OpenAiVideoInteractionAnalyzerOptions {
  apiKey: string;
  baseUrl: string;
  model?: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
}

const ENTITY_TYPES: ReadonlySet<EntityType> = new Set([
  'person',
  'product',
  'brand',
  'logo',
  'website',
  'app',
  'document',
  'slide',
  'chart',
  'phone',
  'camera',
  'ui_element',
  'object',
]);

const INTERACTION_TYPES: ReadonlySet<InteractionType> = new Set([
  'points_at',
  'shows',
  'holds',
  'looks_at',
  'touches',
  'opens',
  'closes',
  'clicks',
  'scrolls',
  'types',
  'switches_to',
  'demonstrates',
]);

const REFERENCE_RELATIONS: ReadonlySet<ReferenceRelation> = new Set(['refers_to', 'points_to', 'shows', 'looks_at']);
const EVIDENCE_LEVELS: ReadonlySet<EvidenceLevel> = new Set(['observed', 'inferred', 'uncertain']);

/**
 * The anti-hallucination contract is enforced twice: here in the prompt
 * (so the model is actually asked to behave this way) AND again in
 * `parseResult` below (so a model that ignores the instruction still can't
 * produce a confident-looking fabricated target — see the `evidenceLevel
 * === 'uncertain'` handling there).
 */
const SYSTEM_PROMPT = `You are resolving what a person is doing and referring to at specific moments in a video, given short sequences of frames around each moment plus the transcript spoken near it.

For each window (labeled with its timestamp), identify:

INTERACTIONS — a person visibly doing one of exactly these things to something: points_at, shows, holds, looks_at, touches, opens, closes, clicks, scrolls, types, switches_to, demonstrates. Do not report anything outside this list (no generic "gestures", no facial expressions, no posture).

REFERENCES — a linguistic phrase in the transcript near this window ("this", "that", "this one", "here", "this product", etc.) that refers to something visible in the frames.

For every interaction/reference, if and only if you can confidently identify the specific target (a specific product, person, screen element, etc. — not "something"), give it a short, concrete, reusable label (e.g. "pink phone case", "pricing slide", "blue sneaker") and set evidence_level to "observed" (directly visible, e.g. a hand clearly on the object) or "inferred" (not directly visible but a strong contextual inference, e.g. the only object introduced moments earlier). If you cannot confidently identify the target, OMIT target_label entirely and set evidence_level to "uncertain" — this is the expected, correct answer when evidence is weak; never invent a plausible-sounding target just to fill the field.

CRITICAL for entity consistency: if the same object/person/screen recurs across multiple windows, reuse the EXACT SAME label string every time (e.g. always "pink phone case", never alternating with "the phone" or "her phone"), so occurrences of the same thing can be linked together. List every distinct label you used, once each, in "entities" with its type and a one-line description.

Respond with strict JSON only, no prose, matching exactly:
{
  "entities": [{"label": "<string>", "type": "person"|"product"|"brand"|"logo"|"website"|"app"|"document"|"slide"|"chart"|"phone"|"camera"|"ui_element"|"object", "description": "<string, optional>", "confidence": <0-1>}],
  "interactions": [{"window_timestamp": <number>, "type": "points_at"|"shows"|"holds"|"looks_at"|"touches"|"opens"|"closes"|"clicks"|"scrolls"|"types"|"switches_to"|"demonstrates", "actor_label": "<string, optional>", "target_label": "<string, optional>", "evidence_level": "observed"|"inferred"|"uncertain", "confidence": <0-1>}],
  "references": [{"window_timestamp": <number>, "phrase": "<string>", "target_label": "<string, optional>", "relation": "refers_to"|"points_to"|"shows"|"looks_at", "evidence_level": "observed"|"inferred"|"uncertain", "confidence": <0-1>}]
}

Return empty arrays for anything not present. A window with nothing worth reporting contributes nothing — do not force an entry per window.`;

interface RawApiResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * `VideoInteractionAnalyzer` backed by OpenAI's chat completions vision
 * support — one batched call across every pre-selected window (same
 * call-count-independent-of-window-count shape as `OpenAiVisionProvider`),
 * each window's frames labeled with its own timestamp so the model can
 * reason about temporal context within a window.
 */
export class OpenAiVideoInteractionAnalyzer implements VideoInteractionAnalyzer {
  readonly provider = 'openai';
  readonly model: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;

  constructor(options: OpenAiVideoInteractionAnalyzerOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model ?? 'gpt-4o-mini';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  async analyze(windows: InteractionWindow[], options: InteractionAnalyzeOptions): Promise<InteractionAnalysisResult> {
    if (windows.length === 0) return { entities: [], interactions: [], references: [] };

    const content = await this.buildContent(windows);

    let raw: RawApiResponse;
    try {
      raw = await withRetry(() => this.callApi(content, options), {
        maxAttempts: this.maxAttempts,
        baseDelayMs: 300,
        maxDelayMs: 4_000,
        signal: options.signal,
        isRetryable: (error) => error instanceof RetryableAnalysisError,
      });
    } catch (error) {
      if (error instanceof RetryableAnalysisError) {
        throw new MoreelError(error.moreelCode, undefined, { cause: error });
      }
      throw error;
    }

    return parseResult(raw);
  }

  private async buildContent(windows: InteractionWindow[]): Promise<Array<Record<string, unknown>>> {
    const parts: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: 'Analyze the following moments. Each window is labeled with its timestamp, the transcript text spoken near it, and its frames in chronological order.',
      },
    ];

    for (const window of windows) {
      parts.push({
        type: 'text',
        text: `Window at ${window.timestamp}s. Transcript near this moment: "${window.transcriptText || '(no speech)'}"`,
      });
      for (const frame of window.frames) {
        const buffer = await readFile(frame.filePath);
        const dataUrl = `data:${frame.contentType};base64,${buffer.toString('base64')}`;
        parts.push({ type: 'image_url', image_url: { url: dataUrl } });
      }
    }

    return parts;
  }

  private async callApi(content: Array<Record<string, unknown>>, options: InteractionAnalyzeOptions): Promise<RawApiResponse> {
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
        throw new MoreelError(ErrorCode.VISION_ANALYSIS_FAILED, 'Interaction analysis timed out.', { cause: error });
      }
      if ((error as Error).name === 'AbortError') {
        throw error;
      }
      throw new RetryableAnalysisError('Network error calling interaction analyzer.', { cause: error });
    }

    if (response.status === 429) {
      throw new RetryableAnalysisError('Interaction analyzer rate-limited the request.', {
        code: ErrorCode.RATE_LIMITED,
      });
    }
    if (response.status >= 500) {
      throw new RetryableAnalysisError('Interaction analyzer returned a server error.');
    }
    if (!response.ok) {
      const body = await safeReadText(response);
      throw new MoreelError(ErrorCode.VISION_ANALYSIS_FAILED, undefined, {
        details: { httpStatus: response.status },
        cause: new Error(body),
      });
    }

    return (await response.json()) as RawApiResponse;
  }
}

/**
 * Defensive parsing, mirroring OpenAiVisionProvider: a malformed individual
 * entry is dropped, never a reason to fail the whole call. The second half
 * of the anti-hallucination contract lives here — regardless of what the
 * model claims, any interaction/reference whose `evidence_level` isn't
 * exactly "observed" or "inferred" has its target stripped, so an
 * "uncertain" entry can never carry a target through to the rest of the
 * system.
 */
function parseResult(raw: RawApiResponse): InteractionAnalysisResult {
  const text = raw.choices?.[0]?.message?.content;
  if (!text) return { entities: [], interactions: [], references: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { entities: [], interactions: [], references: [] };
  }

  const obj = parsed as Record<string, unknown>;
  return {
    entities: parseEntities(obj.entities),
    interactions: parseInteractions(obj.interactions),
    references: parseReferences(obj.references),
  };
}

function parseEntities(value: unknown): RawEntity[] {
  if (!Array.isArray(value)) return [];
  const entities: RawEntity[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const candidate = item as Record<string, unknown>;
    const label = candidate.label;
    const type = candidate.type;
    if (typeof label !== 'string' || label.trim().length === 0) continue;
    if (typeof type !== 'string' || !ENTITY_TYPES.has(type as EntityType)) continue;
    const confidence = typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence) ? candidate.confidence : 0.5;
    const description = typeof candidate.description === 'string' ? candidate.description : undefined;
    entities.push({
      label: label.trim(),
      type: type as EntityType,
      confidence,
      ...(description ? { description } : {}),
    });
  }
  return entities;
}

function parseEvidenceLevel(value: unknown): EvidenceLevel {
  return typeof value === 'string' && EVIDENCE_LEVELS.has(value as EvidenceLevel) ? (value as EvidenceLevel) : 'uncertain';
}

function parseInteractions(value: unknown): RawInteraction[] {
  if (!Array.isArray(value)) return [];
  const interactions: RawInteraction[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const candidate = item as Record<string, unknown>;
    const windowTimestamp = candidate.window_timestamp;
    const type = candidate.type;
    if (typeof windowTimestamp !== 'number' || !Number.isFinite(windowTimestamp)) continue;
    if (typeof type !== 'string' || !INTERACTION_TYPES.has(type as InteractionType)) continue;

    const evidenceLevel = parseEvidenceLevel(candidate.evidence_level);
    const rawTarget = typeof candidate.target_label === 'string' ? candidate.target_label.trim() : undefined;
    // A target is only ever kept alongside sufficient evidence — see this
    // function's doc comment.
    const targetLabel = evidenceLevel === 'uncertain' ? undefined : rawTarget || undefined;
    const actorLabel = typeof candidate.actor_label === 'string' ? candidate.actor_label.trim() || undefined : undefined;
    const confidence = typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence) ? candidate.confidence : 0.5;

    interactions.push({
      windowTimestamp,
      type: type as InteractionType,
      evidenceLevel,
      confidence,
      ...(actorLabel ? { actorLabel } : {}),
      ...(targetLabel ? { targetLabel } : {}),
    });
  }
  return interactions;
}

function parseReferences(value: unknown): RawReference[] {
  if (!Array.isArray(value)) return [];
  const references: RawReference[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const candidate = item as Record<string, unknown>;
    const windowTimestamp = candidate.window_timestamp;
    const phrase = candidate.phrase;
    const relation = candidate.relation;
    if (typeof windowTimestamp !== 'number' || !Number.isFinite(windowTimestamp)) continue;
    if (typeof phrase !== 'string' || phrase.trim().length === 0) continue;
    if (typeof relation !== 'string' || !REFERENCE_RELATIONS.has(relation as ReferenceRelation)) continue;

    const evidenceLevel = parseEvidenceLevel(candidate.evidence_level);
    const rawTarget = typeof candidate.target_label === 'string' ? candidate.target_label.trim() : undefined;
    const targetLabel = evidenceLevel === 'uncertain' ? undefined : rawTarget || undefined;
    const confidence = typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence) ? candidate.confidence : 0.5;

    references.push({
      windowTimestamp,
      phrase: phrase.trim(),
      relation: relation as ReferenceRelation,
      evidenceLevel,
      confidence,
      ...(targetLabel ? { targetLabel } : {}),
    });
  }
  return references;
}

class RetryableAnalysisError extends Error {
  readonly moreelCode: (typeof ErrorCode)[keyof typeof ErrorCode];
  constructor(message: string, opts: { cause?: unknown; code?: (typeof ErrorCode)[keyof typeof ErrorCode] } = {}) {
    super(message);
    this.name = 'RetryableAnalysisError';
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
