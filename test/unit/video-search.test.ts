import { describe, expect, it } from 'vitest';
import { searchVideo } from '../../src/app/video-search.js';
import type { Transcript } from '../../src/domain/transcript.js';
import type { VisualObservation } from '../../src/domain/vision.js';

const transcript: Transcript = {
  text: 'Our pricing is fair. Revenue grew a lot this quarter.',
  segments: [
    { start: 0, end: 3, text: 'Our pricing is fair.' },
    { start: 3, end: 8, text: 'Revenue grew a lot this quarter.' },
  ],
  language: 'en',
  durationSeconds: 30,
  lowConfidence: false,
};

const visualObservations: VisualObservation[] = [
  { timestamp: 5, type: 'chart', text: 'Revenue chart showing 3x growth' },
  { timestamp: 12, type: 'on_screen_text', text: '$49/month' },
  { timestamp: 20, type: 'scene', text: 'Person walking on a beach' },
];

describe('searchVideo', () => {
  it('finds an exact phrase match in speech', () => {
    const results = searchVideo(transcript, visualObservations, 'pricing is fair');
    expect(results[0]).toMatchObject({ source: 'speech', text: 'Our pricing is fair.' });
  });

  it('finds matches across speech AND visual observations for the same query term', () => {
    const results = searchVideo(transcript, visualObservations, 'revenue');
    const sources = results.map((r) => r.source);
    expect(sources).toContain('speech');
    expect(sources).toContain('chart');
  });

  it('finds on-screen text the transcript never mentions', () => {
    const results = searchVideo(transcript, visualObservations, '$49');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ source: 'on_screen_text', text: '$49/month' });
  });

  it('ranks exact phrase matches above partial token matches', () => {
    const results = searchVideo(transcript, visualObservations, 'revenue grew a lot');
    expect(results[0]?.text).toBe('Revenue grew a lot this quarter.');
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it('returns no results for a query that matches nothing', () => {
    expect(searchVideo(transcript, visualObservations, 'xylophone')).toEqual([]);
  });

  it('returns no results for an empty query', () => {
    expect(searchVideo(transcript, visualObservations, '   ')).toEqual([]);
  });
});

describe('searchVideo with semantic matching', () => {
  // "Cost" never appears in either the transcript or observations above —
  // only a lexical search would miss it entirely. A semantic option with a
  // vector engineered to be similar to the "$49/month" observation's vector
  // simulates what a real embedding model would produce for a paraphrase.
  const priceVector = [1, 0, 0];
  const unrelatedVector = [0, 1, 0];

  function withSemanticVectors() {
    return {
      queryVector: priceVector,
      entries: [
        { timestamp: 0, source: 'speech' as const, vector: unrelatedVector },
        { timestamp: 3, source: 'speech' as const, vector: unrelatedVector },
        { timestamp: 5, source: 'chart' as const, vector: unrelatedVector },
        { timestamp: 12, source: 'on_screen_text' as const, vector: priceVector },
        { timestamp: 20, source: 'scene' as const, vector: unrelatedVector },
      ],
    };
  }

  it('surfaces a semantically similar event even with zero lexical overlap', () => {
    const results = searchVideo(transcript, visualObservations, 'cost', withSemanticVectors());
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ source: 'on_screen_text', text: '$49/month' });
  });

  it('does not surface events below the semantic-only similarity threshold', () => {
    const results = searchVideo(transcript, visualObservations, 'cost', {
      queryVector: priceVector,
      entries: [{ timestamp: 12, source: 'on_screen_text', vector: unrelatedVector }],
    });
    expect(results).toEqual([]);
  });

  it('ranks an exact lexical match above a semantic-only match for a different query', () => {
    // "revenue" already matches lexically (score 100); "$49/month" only
    // matches semantically here — lexical must still win.
    const semantic = {
      queryVector: priceVector,
      entries: [
        { timestamp: 0, source: 'speech' as const, vector: unrelatedVector },
        { timestamp: 3, source: 'speech' as const, vector: unrelatedVector },
        { timestamp: 5, source: 'chart' as const, vector: unrelatedVector },
        { timestamp: 12, source: 'on_screen_text' as const, vector: priceVector },
        { timestamp: 20, source: 'scene' as const, vector: unrelatedVector },
      ],
    };
    const results = searchVideo(transcript, visualObservations, 'revenue', semantic);
    expect(results[0]?.source).toBe('speech');
  });

  it('behaves exactly like lexical-only search when semantic options are omitted', () => {
    expect(searchVideo(transcript, visualObservations, 'pricing is fair')).toEqual(
      searchVideo(transcript, visualObservations, 'pricing is fair', undefined),
    );
  });
});

describe('searchVideo with Video Map data', () => {
  // Proves the core capability end to end: a query for the literal deictic
  // phrase "this one" — meaningless as a lexical search term on its own —
  // resolves to the concrete visual target via the folded-in reference event.
  it('finds "this one" and surfaces the resolved visual target', () => {
    const mapData = {
      entities: [
        { id: 'e1', type: 'product' as const, label: 'pink phone case', firstSeen: 5, lastSeen: 5, frameIds: [], confidence: 0.9 },
      ],
      references: [
        {
          id: 'r1',
          timestamp: 5,
          phrase: 'this one',
          segmentIndex: 0,
          targetEntityId: 'e1',
          relation: 'refers_to' as const,
          evidenceLevel: 'observed' as const,
          confidence: 0.85,
        },
      ],
    };

    const results = searchVideo(transcript, visualObservations, 'this one', undefined, mapData);
    expect(results[0]).toMatchObject({ source: 'reference', text: '"this one" → pink phone case' });
  });

  it('finds what someone is pointing at via an interaction event', () => {
    const mapData = {
      entities: [
        { id: 'e1', type: 'product' as const, label: 'rhode phone case', firstSeen: 5, lastSeen: 5, frameIds: [], confidence: 0.9 },
      ],
      interactions: [
        { id: 'i1', type: 'points_at' as const, timestamp: 5, targetEntityId: 'e1', evidenceLevel: 'observed' as const, confidence: 0.9 },
      ],
    };

    const results = searchVideo(transcript, visualObservations, 'points_at', undefined, mapData);
    expect(results[0]).toMatchObject({ source: 'interaction', text: 'points_at → rhode phone case' });
  });
});
