import type { MoreelConfig } from '../config/index.js';
import { OpenAiVideoInteractionAnalyzer } from './openai/openai-video-interaction-analyzer.js';
import { OpenAiVisionProvider } from './openai/openai-vision-provider.js';
import type { VideoInteractionAnalyzer } from './video-interaction-analyzer.js';
import type { VisionProvider } from './vision-provider.js';

/**
 * Builds the configured `VisionProvider`, or `undefined` when the vision
 * pipeline is disabled — callers just skip the step entirely rather than
 * branching on a feature flag everywhere. Mirrors `transcription/factory.ts`.
 */
export function createVisionProvider(config: MoreelConfig): VisionProvider | undefined {
  if (!config.visionEnabled) return undefined;

  switch (config.visionProvider) {
    case 'openai': {
      if (!config.openaiApiKey) {
        throw new Error(
          'OPENAI_API_KEY is required when VISION_ENABLED=true and VISION_PROVIDER=openai. Set it in your environment or .env file.',
        );
      }
      return new OpenAiVisionProvider({
        apiKey: config.openaiApiKey,
        baseUrl: config.openaiBaseUrl,
        model: config.visionModel,
      });
    }
    default: {
      const exhaustive: never = config.visionProvider;
      throw new Error(`Unsupported VISION_PROVIDER: ${String(exhaustive)}`);
    }
  }
}

/**
 * Builds the configured `VideoInteractionAnalyzer` (the Video Map's
 * targeted analysis stage), or `undefined` when it's disabled — same
 * pattern as `createVisionProvider`. Requires vision to be enabled too:
 * the map is an enrichment on top of sampled frames, not a standalone
 * pipeline stage.
 */
export function createVideoInteractionAnalyzer(config: MoreelConfig): VideoInteractionAnalyzer | undefined {
  if (!config.videoMapEnabled || !config.visionEnabled) return undefined;

  if (!config.openaiApiKey) {
    throw new Error(
      'OPENAI_API_KEY is required when VIDEO_MAP_ENABLED=true. Set it in your environment or .env file.',
    );
  }

  return new OpenAiVideoInteractionAnalyzer({
    apiKey: config.openaiApiKey,
    baseUrl: config.openaiBaseUrl,
    model: config.videoMapModel,
  });
}
