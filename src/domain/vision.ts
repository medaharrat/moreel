/**
 * The visual layer is deliberately its own model, never merged into
 * `TranscriptSegment` — spoken content and visual content are different
 * kinds of information produced by different pipelines, and the UI must be
 * free to render (or omit) them independently. See `TranscribeVideoResult.visual`.
 */

export type VisualObservationType =
  | 'on_screen_text'
  | 'visual_context'
  | 'scene'
  | 'object'
  | 'ui'
  | 'chart'
  | 'document'
  | 'product'
  | 'logo';

export interface VisualObservation {
  /** Seconds from the start of the media this observation belongs to. */
  timestamp: number;
  /**
   * Seconds this observation remains on screen, when it persists for a
   * span rather than a single instant (e.g. on-screen text visible for
   * several seconds gets one observation covering the whole span instead
   * of one per sampled frame). Omitted when the observation is effectively
   * a single moment.
   */
  endTimestamp?: number;
  type: VisualObservationType;
  /** Detected/described content, preserved verbatim — never "corrected". */
  text: string;
  /** Confidence in [0, 1], when the vision provider reports one. */
  confidence?: number;
  /** Key into the media store this frame was captured to, servable via GET /media/:id. */
  frameId?: string;
}
