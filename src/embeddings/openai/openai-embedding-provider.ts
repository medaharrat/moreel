import { ErrorCode, MoreelError } from '../../domain/errors.js';
import { withRetry } from '../../util/retry.js';
import type { EmbedOptions, EmbeddingProvider } from '../embedding-provider.js';

export interface OpenAiEmbeddingProviderOptions {
  apiKey: string;
  baseUrl: string;
  model?: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
}

interface RawEmbeddingResponse {
  data?: Array<{ embedding?: number[]; index?: number }>;
}

/**
 * `EmbeddingProvider` backed by OpenAI's `/embeddings` endpoint. One batched
 * call per `embed()` — every text goes into a single request, same
 * call-count-independent-of-input-size shape as `OpenAiVisionProvider`.
 */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'openai';
  readonly model: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;

  constructor(options: OpenAiEmbeddingProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model ?? 'text-embedding-3-small';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  async embed(texts: string[], options: EmbedOptions): Promise<number[][]> {
    if (texts.length === 0) return [];

    let raw: RawEmbeddingResponse;
    try {
      raw = await withRetry(() => this.callApi(texts, options), {
        maxAttempts: this.maxAttempts,
        baseDelayMs: 300,
        maxDelayMs: 4_000,
        signal: options.signal,
        isRetryable: (error) => error instanceof RetryableEmbeddingError,
      });
    } catch (error) {
      if (error instanceof RetryableEmbeddingError) {
        throw new MoreelError(error.moreelCode, undefined, { cause: error });
      }
      throw error;
    }

    return parseEmbeddings(raw, texts.length);
  }

  private async callApi(texts: string[], options: EmbedOptions): Promise<RawEmbeddingResponse> {
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const signal = AbortSignal.any([options.signal, timeoutSignal]);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal,
      });
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') {
        throw new MoreelError(ErrorCode.EMBEDDING_FAILED, 'Embedding generation timed out.', { cause: error });
      }
      if ((error as Error).name === 'AbortError') {
        throw error;
      }
      throw new RetryableEmbeddingError('Network error calling embedding provider.', { cause: error });
    }

    if (response.status === 429) {
      throw new RetryableEmbeddingError('Embedding provider rate-limited the request.', {
        code: ErrorCode.RATE_LIMITED,
      });
    }
    if (response.status >= 500) {
      throw new RetryableEmbeddingError('Embedding provider returned a server error.');
    }
    if (!response.ok) {
      const body = await safeReadText(response);
      throw new MoreelError(ErrorCode.EMBEDDING_FAILED, undefined, {
        details: { httpStatus: response.status },
        cause: new Error(body),
      });
    }

    return (await response.json()) as RawEmbeddingResponse;
  }
}

/** Defensive parsing: a malformed/short response fails the whole call (unlike vision observations, a partial vector set is useless for index alignment). */
function parseEmbeddings(raw: RawEmbeddingResponse, expectedCount: number): number[][] {
  const data = raw.data;
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new MoreelError(ErrorCode.EMBEDDING_FAILED, 'Embedding provider returned an unexpected number of vectors.');
  }

  const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return sorted.map((item) => {
    if (!Array.isArray(item.embedding)) {
      throw new MoreelError(ErrorCode.EMBEDDING_FAILED, 'Embedding provider returned a malformed vector.');
    }
    return item.embedding;
  });
}

class RetryableEmbeddingError extends Error {
  readonly moreelCode: (typeof ErrorCode)[keyof typeof ErrorCode];
  constructor(
    message: string,
    opts: { cause?: unknown; code?: (typeof ErrorCode)[keyof typeof ErrorCode] } = {},
  ) {
    super(message);
    this.name = 'RetryableEmbeddingError';
    this.moreelCode = opts.code ?? ErrorCode.EMBEDDING_FAILED;
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
