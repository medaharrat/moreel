import { describe, expect, it } from 'vitest';
import { findMissedMoments } from '../../src/app/what-did-i-miss.js';
import type { Transcript } from '../../src/domain/transcript.js';
import type { VisualObservation } from '../../src/domain/vision.js';

const transcript: Transcript = {
  text: 'This completely changed my business. I started with nothing.',
  segments: [
    { start: 0, end: 4, text: 'This completely changed my business.' },
    { start: 15, end: 18, text: 'I started with nothing.' },
  ],
  language: 'en',
  durationSeconds: 30,
  lowConfidence: false,
};

describe('findMissedMoments', () => {
  it('surfaces a visual observation whose text is not mentioned nearby in speech', () => {
    const visualObservations: VisualObservation[] = [
      { timestamp: 3, type: 'on_screen_text', text: 'FIRST TIME FOUNDER -> THIRD TIME FOUNDER' },
    ];

    const missed = findMissedMoments(transcript, visualObservations);
    expect(missed).toHaveLength(1);
    expect(missed[0]).toMatchObject({ timestamp: 3, text: 'FIRST TIME FOUNDER -> THIRD TIME FOUNDER' });
  });

  it('does not surface a visual observation that overlaps with nearby speech content', () => {
    const visualObservations: VisualObservation[] = [
      // Shares "business" and "changed" with the segment at t=0..4, well within the default window.
      { timestamp: 2, type: 'on_screen_text', text: 'business changed forever' },
    ];

    const missed = findMissedMoments(transcript, visualObservations);
    expect(missed).toEqual([]);
  });

  it('surfaces an observation far outside any transcript window even if the words happen to match', () => {
    const visualObservations: VisualObservation[] = [
      // "business" appears in speech, but 200s away — well outside any reasonable window.
      { timestamp: 200, type: 'on_screen_text', text: 'business plan' },
    ];

    const missed = findMissedMoments(transcript, visualObservations, 6);
    expect(missed).toHaveLength(1);
  });

  it('sorts results chronologically', () => {
    const visualObservations: VisualObservation[] = [
      { timestamp: 25, type: 'chart', text: 'Growth chart' },
      { timestamp: 8, type: 'on_screen_text', text: 'Unrelated caption' },
    ];

    const missed = findMissedMoments(transcript, visualObservations);
    expect(missed.map((m) => m.timestamp)).toEqual([8, 25]);
  });

  it('returns nothing when there are no visual observations', () => {
    expect(findMissedMoments(transcript, [])).toEqual([]);
  });

  it('categorizes observation types correctly', () => {
    const observations: VisualObservation[] = [
      { timestamp: 3, type: 'on_screen_text', text: 'FIRST TIME FOUNDER -> THIRD TIME FOUNDER' },
      { timestamp: 8, type: 'visual_context', text: 'A pink phone case on a desk' },
      { timestamp: 25, type: 'chart', text: 'Growth chart' },
    ];
    const missed = findMissedMoments(transcript, observations);
    expect(missed.map((m) => m.category)).toEqual(['ON_SCREEN_TEXT', 'VISUAL_CONTEXT', 'NOT_SPOKEN']);
  });
});

describe('findMissedMoments with Video Map data', () => {
  // The spec's own example: the speaker never names the product by label,
  // so the resolved interaction/reference IS the missed information —
  // classified distinctly from a generic "something appeared on screen".
  it('surfaces a pointing interaction whose target is never named in nearby speech, as VISUAL_ACTION', () => {
    const missed = findMissedMoments(transcript, [], undefined, {
      interactions: [
        { id: 'i1', type: 'points_at', timestamp: 1, targetEntityId: 'e1', evidenceLevel: 'observed', confidence: 0.9 },
      ],
      entities: [{ id: 'e1', type: 'product', label: 'rhode phone case', firstSeen: 1, lastSeen: 1, frameIds: [], confidence: 0.9 }],
    });

    expect(missed).toHaveLength(1);
    expect(missed[0]).toMatchObject({ category: 'VISUAL_ACTION', text: 'points_at → rhode phone case' });
  });

  it('surfaces an unresolved "this one" reference whose target is never named, as VISUAL_REFERENCE', () => {
    const missed = findMissedMoments(transcript, [], undefined, {
      references: [
        {
          id: 'r1',
          timestamp: 1,
          phrase: 'this one',
          segmentIndex: 0,
          targetEntityId: 'e1',
          relation: 'refers_to',
          evidenceLevel: 'observed',
          confidence: 0.85,
        },
      ],
      entities: [{ id: 'e1', type: 'product', label: 'blue sneaker', firstSeen: 1, lastSeen: 1, frameIds: [], confidence: 0.9 }],
    });

    expect(missed).toHaveLength(1);
    expect(missed[0]).toMatchObject({ category: 'VISUAL_REFERENCE', text: '"this one" → blue sneaker' });
  });

  it('does not surface an interaction whose target entity is already named in nearby speech', () => {
    const missed = findMissedMoments(transcript, [], undefined, {
      interactions: [
        // "business" overlaps with the transcript segment at t=0..4.
        { id: 'i1', type: 'shows', timestamp: 1, targetEntityId: 'e1', evidenceLevel: 'observed', confidence: 0.9 },
      ],
      entities: [{ id: 'e1', type: 'document', label: 'business plan', firstSeen: 1, lastSeen: 1, frameIds: [], confidence: 0.9 }],
    });

    expect(missed).toEqual([]);
  });

  it('never reports an interaction/reference with no resolved target — nothing to compare or surface', () => {
    const missed = findMissedMoments(transcript, [], undefined, {
      interactions: [{ id: 'i1', type: 'points_at', timestamp: 1, evidenceLevel: 'uncertain', confidence: 0.3 }],
      references: [
        { id: 'r1', timestamp: 1, phrase: 'that', segmentIndex: 0, relation: 'refers_to', evidenceLevel: 'uncertain', confidence: 0.2 },
      ],
    });

    expect(missed).toEqual([]);
  });
});
