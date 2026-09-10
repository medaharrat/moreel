import { describe, expect, it, vi } from 'vitest';
import { OpenAiEmbeddingProvider } from '../../src/embeddings/openai/openai-embedding-provider.js';

function embeddingResponse(vectors: number[][], status = 200): Response {
  return new Response(
    JSON.stringify({ data: vectors.map((embedding, index) => ({ embedding, index })) }),
    { status },
  );
}

describe('OpenAiEmbeddingProvider', () => {
  const options = { signal: new AbortController().signal, timeoutMs: 10_000 };

  it('sends a single batched request for all texts and returns vectors in input order', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/embeddings');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ model: 'text-embedding-3-small', input: ['hello', 'world'] });
      return embeddingResponse([
        [0, 1],
        [1, 0],
      ]);
    });

    const provider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const vectors = await provider.embed(['hello', 'world'], options);
    expect(vectors).toEqual([
      [0, 1],
      [1, 0],
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array when given no texts, without calling the API', async () => {
    const fetchImpl = vi.fn();
    const provider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(await provider.embed([], options)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sorts vectors by the response index rather than assuming array order', async () => {
    // Deliberately out of order — the provider must sort by `index`, not trust array position.
    const outOfOrder = new Response(
      JSON.stringify({
        data: [
          { embedding: [1, 1], index: 1 },
          { embedding: [9, 9], index: 0 },
        ],
      }),
      { status: 200 },
    );
    const fetchImpl = vi.fn(async () => outOfOrder);

    const provider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const vectors = await provider.embed(['a', 'b'], options);
    expect(vectors).toEqual([
      [9, 9],
      [1, 1],
    ]);
  });

  it('fails when the response has a different vector count than the input', async () => {
    const fetchImpl = vi.fn(async () => embeddingResponse([[1, 0]]));
    const provider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.embed(['a', 'b'], options)).rejects.toMatchObject({ code: 'EMBEDDING_FAILED' });
  });

  it('retries on a 500 and succeeds on the next attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('server error', { status: 500 }))
      .mockResolvedValueOnce(embeddingResponse([[0.1, 0.2]]));

    const provider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 3,
    });

    const vectors = await provider.embed(['hello'], options);
    expect(vectors).toEqual([[0.1, 0.2]]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps a 429 to RATE_LIMITED after exhausting retries', async () => {
    const fetchImpl = vi.fn(async () => new Response('too many requests', { status: 429 }));
    const provider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 2,
    });

    await expect(provider.embed(['hello'], options)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400 client error and maps it to EMBEDDING_FAILED', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad request', { status: 400 }));
    const provider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 3,
    });

    await expect(provider.embed(['hello'], options)).rejects.toMatchObject({ code: 'EMBEDDING_FAILED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
