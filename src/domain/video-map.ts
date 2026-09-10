/**
 * The Video Map: the semantic layer built on top of the existing
 * transcript/visual-observation pipeline. Where `VisualObservation` answers
 * "what was visible", the map additionally answers "who/what persisted
 * across moments (entities)", "what did the person DO (interactions)", and
 * "what was a spoken word like 'this' actually pointing at (references)".
 *
 * None of this replaces the transcript or `VisualObservation[]` — it's an
 * additional, optional layer (absent entirely when `VIDEO_MAP_ENABLED` is
 * off, or when analysis found nothing worth recording) that resolves the
 * one thing a transcript and a flat observation list structurally cannot:
 * "this one" only means something once it's linked to a specific entity at
 * a specific moment.
 */

/** Deliberately small, closed vocabulary — see docs on why: this is not a general object-detection taxonomy. */
export type EntityType =
  | 'person'
  | 'product'
  | 'brand'
  | 'logo'
  | 'website'
  | 'app'
  | 'document'
  | 'slide'
  | 'chart'
  | 'phone'
  | 'camera'
  | 'ui_element'
  | 'object';

/**
 * Something persistent/meaningful across the video. `firstSeen`/`lastSeen`
 * are the earliest/latest timestamp any interaction, reference, or the
 * analyzer's own observation attributed to this entity — not a claim that
 * it's continuously visible in between.
 */
export interface VisualEntity {
  id: string;
  type: EntityType;
  /** Short human-readable label, e.g. "pink phone case" — never a generic "object". */
  label: string;
  description?: string | undefined;
  firstSeen: number;
  lastSeen: number;
  /** Frame ids (servable via GET /media/:id) this entity was actually seen in. */
  frameIds: string[];
  confidence: number;
}

/** Deliberately small, closed vocabulary of interactions worth modeling — not a general gesture/pose taxonomy. */
export type InteractionType =
  | 'points_at'
  | 'shows'
  | 'holds'
  | 'looks_at'
  | 'touches'
  | 'opens'
  | 'closes'
  | 'clicks'
  | 'scrolls'
  | 'types'
  | 'switches_to'
  | 'demonstrates';

/**
 * How firmly grounded a fact is — the whole point of section 17's
 * anti-hallucination requirement. `'uncertain'` facts still get recorded
 * (evidence that *something* happened, just not confidently resolved to a
 * target) but must never be presented as a confident answer.
 */
export type EvidenceLevel = 'observed' | 'inferred' | 'uncertain';

/** Something a person visibly did — pointing, showing, touching, etc. */
export interface Interaction {
  id: string;
  type: InteractionType;
  timestamp: number;
  endTimestamp?: number | undefined;
  actorEntityId?: string | undefined;
  /** Absent when evidence was insufficient to confidently resolve a target — see EvidenceLevel. Never fabricated to fill this field. */
  targetEntityId?: string | undefined;
  evidenceLevel: EvidenceLevel;
  confidence: number;
  frameId?: string | undefined;
}

export type ReferenceRelation = 'refers_to' | 'points_to' | 'shows' | 'looks_at';

/** A linguistic reference ("this", "that one", "here") linked to the visual entity it points to, when resolvable. */
export interface LinguisticReference {
  id: string;
  timestamp: number;
  phrase: string;
  /** Index into the source `Transcript.segments` array this phrase was spoken in. */
  segmentIndex: number;
  /** Absent when evidence was insufficient — see EvidenceLevel. Never fabricated. */
  targetEntityId?: string | undefined;
  relation: ReferenceRelation;
  evidenceLevel: EvidenceLevel;
  confidence: number;
  frameId?: string | undefined;
}

/** A temporally bounded visual unit — approximated from sampled-frame boundaries, not a full shot-detection model. */
export interface Scene {
  id: string;
  startTimestamp: number;
  endTimestamp: number;
  frameId?: string | undefined;
  description?: string | undefined;
}

export type MissedMomentCategory = 'NOT_SPOKEN' | 'VISUAL_CONTEXT' | 'VISUAL_ACTION' | 'ON_SCREEN_TEXT' | 'VISUAL_REFERENCE';
