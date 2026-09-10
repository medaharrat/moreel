import type { SearchResult } from '../domain/search.js';
import type { Transcript } from '../domain/transcript.js';
import type { VisualObservation } from '../domain/vision.js';
import type { EmbeddingEntry } from '../domain/video.js';
import { cosineSimilarity, embeddingKey, indexEmbeddings } from './semantic-search.js';
import { buildTimeline, type VideoMapData } from './timeline.js';

/** Below this cosine similarity, a semantic-only match (no lexical overlap at all) is too weak to be worth surfacing — tuned loosely, not a hard science. */
const SEMANTIC_ONLY_THRESHOLD = 0.28;
/** Weight applied to cosine similarity when an event ALSO has a lexical match, purely for tie-breaking within already-relevant results. */
const SEMANTIC_TIEBREAK_WEIGHT = 20;
/** Scale applied to cosine similarity for a semantic-only match, kept below the lexical exact-phrase score (100) so paraphrases rank behind literal matches. */
const SEMANTIC_ONLY_SCALE = 60;

export interface SemanticSearchOptions {
  /** The query's own embedding, computed by the caller (search happens outside the pipeline, so this function stays synchronous and dependency-free). */
  queryVector: number[];
  /** The video's precomputed per-event embeddings — see VideoRecord.embeddings. */
  entries: EmbeddingEntry[];
}

/** Lowercase, strip punctuation, split on whitespace, drop empties — deliberately simple tokenization, no stemming/fuzzy matching in v1. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * Scores one timeline event's text against a query: an exact phrase match
 * (case-insensitive substring) scores highest, otherwise the event scores by
 * the fraction of distinct query tokens it contains. Zero means no match at
 * all — callers filter those out.
 */
function score(text: string, query: string, queryTokens: string[]): number {
  const normalizedText = text.toLowerCase();
  if (queryTokens.length === 0) return 0;
  if (normalizedText.includes(query.toLowerCase())) return 100;

  const textTokens = new Set(tokenize(text));
  const matched = queryTokens.filter((token) => textTokens.has(token)).length;
  if (matched === 0) return 0;
  return (matched / queryTokens.length) * 50;
}

/**
 * Searches across every modality of a processed video — spoken transcript
 * and every visual observation type — and returns results ranked by match
 * quality, each anchored to a timestamp. This is the backbone of both the
 * `search_video` MCP tool and the web UI's in-transcript search; neither
 * treats speech and on-screen/visual content as separate indexes.
 *
 * When `semantic` is provided (both the video and the query have
 * embeddings), cosine similarity is blended in on top of lexical matching:
 * it boosts/tie-breaks results that already matched lexically, and — more
 * importantly — surfaces paraphrases a substring/token match would miss
 * entirely (e.g. a query for "cost" finding on-screen text that says
 * "pricing"), scored lower than an exact/lexical hit so literal matches
 * still rank first. Omitting `semantic` (the default) leaves lexical-only
 * behavior exactly as it was before this feature existed.
 *
 * When `mapData` is provided, interactions and references are searchable
 * too — e.g. a query for "this one" matches a reference event, surfacing
 * exactly what it was resolved to (see timeline.ts for how that text is
 * built).
 */
export function searchVideo(
  transcript: Transcript,
  visualObservations: VisualObservation[],
  query: string,
  semantic?: SemanticSearchOptions,
  mapData?: VideoMapData,
): SearchResult[] {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) return [];
  const queryTokens = tokenize(trimmedQuery);

  const timeline = buildTimeline(transcript, visualObservations, mapData);
  const vectorsByKey = semantic ? indexEmbeddings(semantic.entries) : undefined;
  const results: SearchResult[] = [];

  for (const event of timeline) {
    const lexicalScore = score(event.text, trimmedQuery, queryTokens);

    let semanticSim = 0;
    if (vectorsByKey && semantic) {
      const vector = vectorsByKey.get(embeddingKey(event.timestamp, event.source));
      if (vector) semanticSim = cosineSimilarity(semantic.queryVector, vector);
    }

    let finalScore: number;
    if (lexicalScore > 0) {
      finalScore = lexicalScore + semanticSim * SEMANTIC_TIEBREAK_WEIGHT;
    } else if (semanticSim >= SEMANTIC_ONLY_THRESHOLD) {
      finalScore = semanticSim * SEMANTIC_ONLY_SCALE;
    } else {
      continue;
    }

    results.push({
      timestamp: event.timestamp,
      ...(event.endTimestamp !== undefined ? { endTimestamp: event.endTimestamp } : {}),
      source: event.source,
      text: event.text,
      ...(event.confidence !== undefined ? { confidence: event.confidence } : {}),
      ...(event.frameId !== undefined ? { frameId: event.frameId } : {}),
      score: finalScore,
    });
  }

  return results.sort((a, b) => b.score - a.score || a.timestamp - b.timestamp);
}
