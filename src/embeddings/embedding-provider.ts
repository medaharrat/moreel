export interface EmbedOptions {
  signal: AbortSignal;
  timeoutMs: number;
}

/**
 * Turns text into vectors for semantic search — `search_video`/`find_moment`
 * matching a query like "cost" against on-screen text that says "pricing",
 * which lexical (substring/token) matching alone cannot do. Mirrors
 * `VisionProvider`/`Transcriber`: knows nothing about videos or timelines,
 * just text in, vectors out, so the vendor is swappable.
 */
export interface EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  /** Returns one vector per input text, in the same order. */
  embed(texts: string[], options: EmbedOptions): Promise<number[][]>;
}
