import type { MoreelConfig } from '../config/index.js';
import { OpenAiWhisperTranscriber } from './whisper/openai-whisper-transcriber.js';
import type { Transcriber } from './transcriber.js';

/** Builds the configured `Transcriber`. The single point that knows how `TRANSCRIPTION_PROVIDER` maps to an implementation. */
export function createTranscriber(config: MoreelConfig): Transcriber {
  switch (config.transcriptionProvider) {
    case 'openai': {
      if (!config.openaiApiKey) {
        throw new Error(
          'OPENAI_API_KEY is required when TRANSCRIPTION_PROVIDER=openai. Set it in your environment or .env file.',
        );
      }
      return new OpenAiWhisperTranscriber({
        apiKey: config.openaiApiKey,
        baseUrl: config.openaiBaseUrl,
        model: config.transcriptionModel,
      });
    }
    default: {
      const exhaustive: never = config.transcriptionProvider;
      throw new Error(`Unsupported TRANSCRIPTION_PROVIDER: ${String(exhaustive)}`);
    }
  }
}
