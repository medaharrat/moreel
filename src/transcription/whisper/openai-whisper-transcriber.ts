import { readFile } from 'node:fs/promises';
import { ErrorCode, MoreelError } from '../../domain/errors.js';
import type { AudioAsset, Transcript } from '../../domain/transcript.js';
import type { RawSegment } from '../normalization.js';
import { normalizeTranscript } from '../normalization.js';
import type { RawWord } from '../resegmentation.js';
import { resegmentByWords } from '../resegmentation.js';
import type { TranscribeOptions, Transcriber } from '../transcriber.js';
import { withRetry } from '../../util/retry.js';

export interface OpenAiWhisperTranscriberOptions {
  apiKey: string;
  baseUrl: string;
  model?: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
}

/** Content types Whisper's endpoint recognizes by extension. */
const AUDIO_MIME_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
};

interface OpenAiVerboseTranscription {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
    avg_logprob?: number;
    no_speech_prob?: number;
  }>;
  /** Present only when the model supports `timestamp_granularities[]=word` (whisper-1 does). Used to adaptively re-chunk segments — see resegmentation.ts. */
  words?: Array<{ word: string; start: number; end: number }>;
}

/**
 * `Transcriber` backed by OpenAI's `/audio/transcriptions` endpoint
 * (Whisper). Chosen as the v0.1 default for a reasonable accuracy/latency
 * balance without operating our own GPU inference. The `Transcriber`
 * interface is the seam for adding a local/self-hosted faster-whisper
 * tier later without touching anything above it.
 */
export class OpenAiWhisperTranscriber implements Transcriber {
  readonly provider = 'openai';
  readonly model: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;

  constructor(options: OpenAiWhisperTranscriberOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model ?? 'whisper-1';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  /**
   * Fires a cheap authenticated request to the same origin so the TLS
   * connection is already warm by the time the real transcription POST
   * goes out. Best-effort: any failure here is swallowed since it can
   * only make the real request as slow as it would have been anyway.
   */
  async warmUp(signal: AbortSignal): Promise<void> {
    try {
      await this.fetchImpl(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal,
      });
    } catch {
      // Best-effort only — ignored.
    }
  }

  async transcribe(audio: AudioAsset, options: TranscribeOptions): Promise<Transcript> {
    const fileBuffer = await readFile(audio.filePath);
    const form = new FormData();
    const mimeType = AUDIO_MIME_TYPES[audio.format] ?? 'application/octet-stream';
    form.set('file', new Blob([fileBuffer], { type: mimeType }), `audio.${audio.format}`);
    form.set('model', this.model);
    form.set('response_format', 'verbose_json');
    // Both granularities requested together: segments still carry Whisper's
    // own confidence signals (avg_logprob/no_speech_prob), which per-word
    // timestamps don't have — words are used only to re-chunk segments
    // adaptively (see resegmentByWords), not to replace them.
    form.append('timestamp_granularities[]', 'segment');
    form.append('timestamp_granularities[]', 'word');

    let response: OpenAiVerboseTranscription;
    try {
      response = await withRetry(() => this.callApi(form, options), {
        maxAttempts: this.maxAttempts,
        baseDelayMs: 300,
        maxDelayMs: 4_000,
        signal: options.signal,
        isRetryable: (error) => error instanceof RetryableTranscriptionError,
      });
    } catch (error) {
      if (error instanceof RetryableTranscriptionError) {
        throw new MoreelError(error.moreelCode, undefined, { cause: error });
      }
      throw error;
    }

    let rawSegments: RawSegment[] = (response.segments ?? []).map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
      ...(segment.avg_logprob !== undefined ? { avgLogProb: segment.avg_logprob } : {}),
      ...(segment.no_speech_prob !== undefined ? { noSpeechProb: segment.no_speech_prob } : {}),
    }));

    // Some very short clips return only top-level text with no segments.
    if (rawSegments.length === 0 && response.text.trim().length > 0) {
      rawSegments.push({
        start: 0,
        end: response.duration ?? audio.durationSeconds,
        text: response.text,
      });
    }

    // Whisper's own segment boundaries reflect its decode chunking, not
    // speech rate — a slow single phrase can come back as one long segment,
    // and fast run-on speech can cram several sentences into one. Given
    // word-level timestamps, re-chunk adaptively at sentence punctuation and
    // real pauses instead of trusting the provider's boundaries as-is. A
    // no-op when the model didn't return word timestamps.
    if (response.words && response.words.length > 0) {
      const words: RawWord[] = response.words.map((w) => ({ word: w.word, start: w.start, end: w.end }));
      rawSegments = resegmentByWords(rawSegments, words);
    }

    return normalizeTranscript(rawSegments, {
      language: response.language,
      durationSeconds: response.duration ?? audio.durationSeconds,
    });
  }

  private async callApi(
    form: FormData,
    options: TranscribeOptions,
  ): Promise<OpenAiVerboseTranscription> {
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const signal = AbortSignal.any([options.signal, timeoutSignal]);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal,
      });
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') {
        throw new MoreelError(ErrorCode.TRANSCRIPTION_TIMEOUT, undefined, { cause: error });
      }
      if ((error as Error).name === 'AbortError') {
        throw error;
      }
      throw new RetryableTranscriptionError('Network error calling transcription provider.', {
        cause: error,
      });
    }

    if (response.status === 429) {
      throw new RetryableTranscriptionError('Transcription provider rate-limited the request.', {
        code: ErrorCode.RATE_LIMITED,
      });
    }
    if (response.status >= 500) {
      throw new RetryableTranscriptionError('Transcription provider returned a server error.');
    }
    if (!response.ok) {
      const body = await safeReadText(response);
      throw new MoreelError(ErrorCode.TRANSCRIPTION_FAILED, undefined, {
        details: { httpStatus: response.status },
        cause: new Error(body),
      });
    }

    return (await response.json()) as OpenAiVerboseTranscription;
  }
}

/** Internal marker for errors the retry loop should retry; always converted before leaving the class. */
class RetryableTranscriptionError extends Error {
  readonly moreelCode: (typeof ErrorCode)[keyof typeof ErrorCode];
  constructor(
    message: string,
    opts: { cause?: unknown; code?: (typeof ErrorCode)[keyof typeof ErrorCode] } = {},
  ) {
    super(message);
    this.name = 'RetryableTranscriptionError';
    this.moreelCode = opts.code ?? ErrorCode.TRANSCRIPTION_FAILED;
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
