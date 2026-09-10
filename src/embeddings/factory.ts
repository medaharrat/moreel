import type { MoreelConfig } from '../config/index.js';
import type { EmbeddingProvider } from './embedding-provider.js';
import { OpenAiEmbeddingProvider } from './openai/openai-embedding-provider.js';

/**
 * Builds the configured `EmbeddingProvider`, or `undefined` when semantic
 * search is disabled — callers just skip the step entirely, exactly the
 * pattern `vision/factory.ts` established for the vision pipeline.
 */
export function createEmbeddingProvider(config: MoreelConfig): EmbeddingProvider | undefined {
  if (!config.searchEmbeddingsEnabled) return undefined;

  if (!config.openaiApiKey) {
    throw new Error(
      'OPENAI_API_KEY is required when SEARCH_EMBEDDINGS_ENABLED=true. Set it in your environment or .env file.',
    );
  }

  return new OpenAiEmbeddingProvider({
    apiKey: config.openaiApiKey,
    baseUrl: config.openaiBaseUrl,
    model: config.searchEmbeddingModel,
  });
}
