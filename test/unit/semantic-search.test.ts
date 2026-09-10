import { describe, expect, it } from 'vitest';
import { cosineSimilarity, embeddingKey, indexEmbeddings } from '../../src/app/semantic-search.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it('returns 0 for a zero-length vector rather than dividing by zero', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('returns 0 for empty or mismatched-length vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe('indexEmbeddings / embeddingKey', () => {
  it('keys entries by (source, timestamp) so lookups do not depend on array order', () => {
    const map = indexEmbeddings([
      { timestamp: 5, source: 'speech', vector: [1, 0] },
      { timestamp: 5, source: 'on_screen_text', vector: [0, 1] },
    ]);

    expect(map.get(embeddingKey(5, 'speech'))).toEqual([1, 0]);
    expect(map.get(embeddingKey(5, 'on_screen_text'))).toEqual([0, 1]);
    expect(map.get(embeddingKey(5, 'chart'))).toBeUndefined();
  });
});
