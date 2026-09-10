import { describe, expect, it } from 'vitest';
import { buildTimeline, eventsInRange } from '../../src/app/timeline.js';
import type { Transcript } from '../../src/domain/transcript.js';
import type { VisualObservation } from '../../src/domain/vision.js';

const transcript: Transcript = {
  text: 'Hello world. This changed my business.',
  segments: [
    { start: 0, end: 2, text: 'Hello world.' },
    { start: 10, end: 13, text: 'This changed my business.' },
  ],
  language: 'en',
  durationSeconds: 20,
  lowConfidence: false,
};

const visualObservations: VisualObservation[] = [
  { timestamp: 1, type: 'on_screen_text', text: 'WELCOME', confidence: 0.9 },
  { timestamp: 11, endTimestamp: 14, type: 'on_screen_text', text: 'FIRST TIME FOUNDER -> THIRD TIME FOUNDER' },
];

describe('buildTimeline', () => {
  it('merges speech and visual events into one chronological list, tagged by source', () => {
    const timeline = buildTimeline(transcript, visualObservations);

    expect(timeline.map((e) => e.source)).toEqual(['speech', 'on_screen_text', 'speech', 'on_screen_text']);
    expect(timeline.map((e) => e.timestamp)).toEqual([0, 1, 10, 11]);
  });

  it('never mixes visual text into a speech event or vice versa', () => {
    const timeline = buildTimeline(transcript, visualObservations);
    const speechEvents = timeline.filter((e) => e.source === 'speech');
    const visualEvents = timeline.filter((e) => e.source !== 'speech');

    expect(speechEvents.map((e) => e.text)).toEqual(['Hello world.', 'This changed my business.']);
    expect(visualEvents.map((e) => e.text)).toEqual(['WELCOME', 'FIRST TIME FOUNDER -> THIRD TIME FOUNDER']);
  });

  it('carries endTimestamp through for observations that span a range', () => {
    const timeline = buildTimeline(transcript, visualObservations);
    const spanning = timeline.find((e) => e.text.startsWith('FIRST TIME FOUNDER'));
    expect(spanning?.endTimestamp).toBe(14);
  });

  it('produces an empty timeline for an empty transcript and no observations', () => {
    const empty = buildTimeline(
      { text: '', segments: [], language: undefined, durationSeconds: 0, lowConfidence: false },
      [],
    );
    expect(empty).toEqual([]);
  });
});

describe('buildTimeline with Video Map data', () => {
  const mapData = {
    entities: [{ id: 'entity_1', type: 'product' as const, label: 'pink phone case', firstSeen: 4, lastSeen: 4, frameIds: [], confidence: 0.9 }],
    interactions: [
      {
        id: 'interaction_1',
        type: 'points_at' as const,
        timestamp: 4,
        targetEntityId: 'entity_1',
        evidenceLevel: 'observed' as const,
        confidence: 0.9,
      },
    ],
    references: [
      {
        id: 'reference_1',
        timestamp: 4,
        phrase: 'this one',
        segmentIndex: 0,
        targetEntityId: 'entity_1',
        relation: 'refers_to' as const,
        evidenceLevel: 'observed' as const,
        confidence: 0.85,
      },
    ],
  };

  it('folds resolved interactions/references into the timeline with the entity label inline', () => {
    const timeline = buildTimeline(transcript, [], mapData);
    const interactionEvent = timeline.find((e) => e.source === 'interaction');
    const referenceEvent = timeline.find((e) => e.source === 'reference');

    expect(interactionEvent?.text).toBe('points_at → pink phone case');
    expect(referenceEvent?.text).toBe('"this one" → pink phone case');
  });

  it('marks an unresolved reference as uncertain instead of a fabricated target', () => {
    const timeline = buildTimeline(transcript, [], {
      references: [
        {
          id: 'reference_2',
          timestamp: 1,
          phrase: 'that',
          segmentIndex: 0,
          relation: 'refers_to' as const,
          evidenceLevel: 'uncertain' as const,
          confidence: 0.2,
        },
      ],
    });
    const referenceEvent = timeline.find((e) => e.source === 'reference');
    expect(referenceEvent?.text).toBe('"that" (uncertain)');
  });

  it('behaves exactly like the two-argument call when mapData is omitted', () => {
    expect(buildTimeline(transcript, visualObservations)).toEqual(buildTimeline(transcript, visualObservations, undefined));
  });
});

describe('eventsInRange', () => {
  it('returns events overlapping the given window, including spans that only partially overlap', () => {
    const timeline = buildTimeline(transcript, visualObservations);
    const events = eventsInRange(timeline, 9, 12);
    expect(events.map((e) => e.text)).toEqual(['This changed my business.', 'FIRST TIME FOUNDER -> THIRD TIME FOUNDER']);
  });

  it('excludes events entirely outside the window', () => {
    const timeline = buildTimeline(transcript, visualObservations);
    expect(eventsInRange(timeline, 100, 200)).toEqual([]);
  });
});
