import type { AudioAsset, VideoAsset } from '../../domain/transcript.js';

export interface AudioExtractionOptions {
  workDir: string;
  maxDurationSeconds: number;
  timeoutMs: number;
  signal: AbortSignal;
}

/** Extracts a transcription-ready audio track from a downloaded video/media file. */
export interface AudioExtractor {
  extract(video: VideoAsset, options: AudioExtractionOptions): Promise<AudioAsset>;
}
