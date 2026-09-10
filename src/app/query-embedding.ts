import type { VideoRecord } from '../domain/video.js';
import type { EmbeddingProvider } from '../embeddings/embedding-provider.js';
import type { SemanticSearchOptions } from './video-search.js';

/**
 * Best-effort: embeds the query text and pairs it with the video's
 * precomputed embeddings, for callers of `searchVideo`. Returns `undefined`
 * — never throws — when there's no embedding provider configured, the video
 * has no stored embeddings (e.g. it was processed before this feature was
 * enabled, or embedding generation failed at process time), or the query
 * embedding call itself fails. Callers fall back to lexical-only search;
 * they never fail the request over this.
 */
export async function resolveSemanticSearch(
  embeddingProvider: EmbeddingProvider | undefined,
  record: VideoRecord,
  query: string,
  options: { signal: AbortSignal; timeoutMs: number },
): Promise<SemanticSearchOptions | undefined> {
  if (!embeddingProvider || !record.embeddings?.length) return undefined;
  try {
    const [queryVector] = await embeddingProvider.embed([query], options);
    if (!queryVector) return undefined;
    return { queryVector, entries: record.embeddings };
  } catch {
    return undefined;
  }
}
