import type { AudioAsset, Transcript } from '../domain/transcript.js';

export interface TranscribeOptions {
  signal: AbortSignal;
  timeoutMs: number;
}

/**
 * A `Transcriber` turns audio into a normalized `Transcript`. It knows
 * nothing about video platforms — the same interface works whether the
 * audio came from Instagram, TikTok, or a local file, and multiple
 * implementations (different vendors, or fast-vs-accurate tiers of the
 * same vendor) can be benchmarked against each other interchangeably.
 */
export interface Transcriber {
  readonly provider: string;
  readonly model: string;
  transcribe(audio: AudioAsset, options: TranscribeOptions): Promise<Transcript>;
  /**
   * Optional best-effort connection warm-up, kicked off in parallel with
   * download/audio-extraction so the TLS handshake to the transcription
   * provider is already paid for by the time the real request goes out.
   * Implementations must never throw — a failed warm-up just means the
   * real `transcribe` call pays full connection setup cost as before.
   */
  warmUp?(signal: AbortSignal): Promise<void>;
}
