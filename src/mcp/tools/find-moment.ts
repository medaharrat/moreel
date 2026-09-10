import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from 'pino';
import type { VideoStore } from '../../app/video-store.js';
import { resolveSemanticSearch } from '../../app/query-embedding.js';
import { searchVideo } from '../../app/video-search.js';
import { ErrorCode, MoreelError, isMoreelError, toMoreelError } from '../../domain/errors.js';
import type { SearchResult } from '../../domain/search.js';
import type { VideoRecord } from '../../domain/video.js';
import type { EmbeddingProvider } from '../../embeddings/embedding-provider.js';

interface InteractionDetail {
  type: string;
  target_entity_id?: string;
  target_label?: string;
}

/**
 * When the best search hit is a resolved interaction/reference, surfaces
 * the structured target behind it — this is the "speech → reference →
 * visual target" capability made concrete in the tool's output, not just
 * a templated text string. Matched back to the source record by
 * (timestamp, source) since `SearchResult` itself doesn't carry the
 * originating interaction/reference id (it's derived, transient, via
 * buildTimeline — see app/timeline.ts).
 */
function resolveInteractionDetail(best: SearchResult, record: VideoRecord): InteractionDetail | undefined {
  const labelFor = (entityId: string | undefined) =>
    entityId ? record.entities?.find((entity) => entity.id === entityId)?.label : undefined;

  if (best.source === 'interaction') {
    const match = record.interactions?.find((interaction) => interaction.timestamp === best.timestamp);
    if (!match) return undefined;
    const label = labelFor(match.targetEntityId);
    return {
      type: match.type,
      ...(match.targetEntityId ? { target_entity_id: match.targetEntityId } : {}),
      ...(label ? { target_label: label } : {}),
    };
  }

  if (best.source === 'reference') {
    const match = record.references?.find((reference) => reference.timestamp === best.timestamp);
    if (!match) return undefined;
    const label = labelFor(match.targetEntityId);
    return {
      type: match.relation,
      ...(match.targetEntityId ? { target_entity_id: match.targetEntityId } : {}),
      ...(label ? { target_label: label } : {}),
    };
  }

  return undefined;
}

const inputSchema = {
  video_id: z.string().describe('A video id previously returned by understand_video or transcribe_video.'),
  query: z.string().describe('The specific thing to find — e.g. "pricing", "the revenue slide", "the dashboard".'),
};

const outputSchema = {
  video_id: z.string(),
  query: z.string(),
  found: z.boolean().describe('False when nothing in the video matched the query at all.'),
  timestamp: z.number().optional().describe('Seconds from the start of the video where the best evidence occurs.'),
  end_timestamp: z.number().optional(),
  source: z
    .enum([
      'speech',
      'on_screen_text',
      'visual_context',
      'scene',
      'object',
      'ui',
      'chart',
      'document',
      'product',
      'logo',
      'interaction',
      'reference',
    ])
    .optional(),
  text: z.string().optional().describe('The exact evidence — what was said or what was shown.'),
  /** A short direct answer when the evidence resolves to a specific thing — the entity's label when the match is an interaction/reference with a resolved target, otherwise the same as "text". */
  answer: z.string().optional(),
  confidence: z.number().optional(),
  frame_id: z.string().optional().describe('When present, fetch the evidence frame via GET /media/:frame_id on the HTTP API.'),
  /** Present when the evidence is a resolved interaction or reference from the Video Map (see get_video_map) — the structured "what/who was this pointing at" behind the text. */
  interaction: z
    .object({
      type: z.string().describe('The interaction type (e.g. "points_at") or reference relation (e.g. "refers_to").'),
      target_entity_id: z.string().optional(),
      target_label: z.string().optional().describe('The resolved entity\'s label, e.g. "pink phone case". Absent when evidence was insufficient to resolve a target.'),
    })
    .optional(),
};

const TOOL_DESCRIPTION = `Returns the single best timestamped piece of evidence in a previously-understood video for a specific question — precise, verifiable, and anchored to one moment, unlike search_video which returns every match.

Requires a "video_id" from a prior understand_video or transcribe_video call. Use this when you need one authoritative answer with proof (e.g. "does the creator show pricing anywhere?", "what is he pointing at when he says 'this one'?") rather than a list of every mention. When the best match resolves to a specific visual entity (a pointing gesture, a "this"/"that" reference), the "interaction" field gives the structured target — absent when evidence was too weak to confidently resolve one, never a fabricated guess.`;

export function registerFindMomentTool(
  server: McpServer,
  videoStore: VideoStore,
  logger: Logger,
  embeddingProvider?: EmbeddingProvider,
  embeddingTimeoutMs = 20_000,
): void {
  server.registerTool(
    'find_moment',
    {
      title: 'Find Moment',
      description: TOOL_DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Find Moment',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ video_id, query }, extra): Promise<CallToolResult> => {
      try {
        const record = await videoStore.getById(video_id);
        if (!record) {
          throw new MoreelError(ErrorCode.VIDEO_NOT_FOUND);
        }

        const semantic = await resolveSemanticSearch(embeddingProvider, record, query, {
          signal: extra.signal,
          timeoutMs: embeddingTimeoutMs,
        });

        const mapData = { entities: record.entities, interactions: record.interactions, references: record.references };
        const [best] = searchVideo(record.transcript, record.visualObservations, query, semantic, mapData);
        const interactionDetail = best ? resolveInteractionDetail(best, record) : undefined;

        const output = best
          ? {
              video_id,
              query,
              found: true,
              timestamp: best.timestamp,
              ...(best.endTimestamp !== undefined ? { end_timestamp: best.endTimestamp } : {}),
              source: best.source,
              text: best.text,
              answer: interactionDetail?.target_label ?? best.text,
              ...(best.confidence !== undefined ? { confidence: best.confidence } : {}),
              ...(best.frameId !== undefined ? { frame_id: best.frameId } : {}),
              ...(interactionDetail ? { interaction: interactionDetail } : {}),
            }
          : { video_id, query, found: false };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        const moreelError = isMoreelError(error) ? error : toMoreelError(error);
        logger.error({ video_id, errorCode: moreelError.code }, 'find_moment tool call failed');
        const clientView = moreelError.toClientView();
        return {
          isError: true,
          content: [{ type: 'text', text: `Find moment failed: ${clientView.message} (code: ${clientView.code})` }],
          structuredContent: { ...clientView },
        };
      }
    },
  );
}
