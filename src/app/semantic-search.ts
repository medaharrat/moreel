import type { EmbeddingEntry } from '../domain/video.js';

/** Cosine similarity in [-1, 1]; 0 when either vector is degenerate (zero-length or all-zero). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Keys an EmbeddingEntry list by (timestamp, source) so a timeline event can look up its own vector without assuming array order matches. */
export function indexEmbeddings(entries: EmbeddingEntry[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const entry of entries) {
    map.set(embeddingKey(entry.timestamp, entry.source), entry.vector);
  }
  return map;
}

export function embeddingKey(timestamp: number, source: string): string {
  return `${source}|${timestamp}`;
}
