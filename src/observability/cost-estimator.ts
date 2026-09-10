/**
 * Estimates what Moreel pays the upstream provider per request (for cost
 * observability, not customer billing — Moreel doesn't charge for usage).
 * Keyed by `${provider}:${model}` since price varies by both; an
 * unrecognized pairing returns `undefined` rather than a guessed number,
 * since a silently-wrong cost figure is worse than a visibly-missing one
 * on a cost dashboard.
 */

// Cents per minute of audio, at the provider's published per-minute rate.
// Source: OpenAI's Whisper API pricing (openai.com/pricing) — $0.006/min.
const CENTS_PER_MINUTE: Record<string, number> = {
  'openai:whisper-1': 0.6,
};

export function estimateTranscriptionCostCents(provider: string, model: string, durationSeconds: number): number | undefined {
  const rate = CENTS_PER_MINUTE[`${provider}:${model}`];
  if (rate === undefined) return undefined;
  return (durationSeconds / 60) * rate;
}

// Cents per image sent to a vision model — a different unit basis than
// per-minute transcription pricing, since vision billing is per-input-image
// (tokenized by resolution) rather than duration. Approximate: OpenAI doesn't
// publish a flat per-image rate for gpt-4o-mini, so this estimates from the
// published per-token input rate ($0.15/1M tokens) at a typical ~1500 tokens
// for an "auto"-detail image, i.e. an estimate, not an exact figure — good
// enough for a COGS dashboard trend line, not an invoice.
const CENTS_PER_IMAGE: Record<string, number> = {
  'openai:gpt-4o-mini': 0.0225,
};

export function estimateVisionCostCents(provider: string, model: string, imageCount: number): number | undefined {
  const rate = CENTS_PER_IMAGE[`${provider}:${model}`];
  if (rate === undefined) return undefined;
  return imageCount * rate;
}
