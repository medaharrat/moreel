import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from 'pino';
import type { VideoStore } from '../../app/video-store.js';
import { ErrorCode, MoreelError, isMoreelError, toMoreelError } from '../../domain/errors.js';

const inputSchema = {
  video_id: z.string().describe('A video id previously returned by understand_video or transcribe_video.'),
};

const entitySchema = z.object({
  id: z.string(),
  type: z.enum([
    'person',
    'product',
    'brand',
    'logo',
    'website',
    'app',
    'document',
    'slide',
    'chart',
    'phone',
    'camera',
    'ui_element',
    'object',
  ]),
  label: z.string(),
  description: z.string().optional(),
  first_seen: z.number(),
  last_seen: z.number(),
  confidence: z.number(),
});

const interactionSchema = z.object({
  id: z.string(),
  type: z.enum([
    'points_at',
    'shows',
    'holds',
    'looks_at',
    'touches',
    'opens',
    'closes',
    'clicks',
    'scrolls',
    'types',
    'switches_to',
    'demonstrates',
  ]),
  timestamp: z.number(),
  end_timestamp: z.number().optional(),
  actor_entity_id: z.string().optional(),
  target_entity_id: z.string().optional().describe('Absent when evidence was insufficient to resolve a target — never a fabricated guess.'),
  evidence_level: z.enum(['observed', 'inferred', 'uncertain']),
  confidence: z.number(),
});

const referenceSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  phrase: z.string().describe('The linguistic reference as spoken, e.g. "this one".'),
  target_entity_id: z.string().optional(),
  relation: z.enum(['refers_to', 'points_to', 'shows', 'looks_at']),
  evidence_level: z.enum(['observed', 'inferred', 'uncertain']),
  confidence: z.number(),
});

const sceneSchema = z.object({
  id: z.string(),
  start_timestamp: z.number(),
  end_timestamp: z.number(),
  description: z.string().optional(),
});

const outputSchema = {
  video_id: z.string(),
  scenes: z.array(sceneSchema),
  entities: z.array(entitySchema).describe('Every distinct person/product/object the analysis identified, with a stable id reusable across interactions and references.'),
  interactions: z.array(interactionSchema).describe('Things the person visibly did — pointing, showing, holding, etc.'),
  references: z.array(referenceSchema).describe('Linguistic references ("this", "that one") resolved to a specific entity, when evidence was sufficient.'),
};

const TOOL_DESCRIPTION = `Returns the Video Map: the semantic layer connecting what was SAID to what was VISIBLE and what the person DID — entities (people/products/objects that recur across the video), interactions (points_at, shows, holds, etc.), and references (what "this"/"that one" actually meant).

This is what resolves "speech → reference → visual target" — a transcript alone cannot tell you what "this one" refers to; this can, when the visual evidence was strong enough. Every interaction/reference has an "evidence_level" (observed/inferred/uncertain) and a "confidence" — absent "target_entity_id" means the evidence was too weak to confidently resolve a target, which is the CORRECT and expected answer in that case, not a failure.

Requires a "video_id" from a prior understand_video call with visual analysis enabled. Returns empty arrays (not an error) when the Video Map feature wasn't enabled or found nothing — use search_video/find_moment for the underlying speech/visual search either way.`;

export function registerGetVideoMapTool(server: McpServer, videoStore: VideoStore, logger: Logger): void {
  server.registerTool(
    'get_video_map',
    {
      title: 'Get Video Map',
      description: TOOL_DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Get Video Map',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ video_id }): Promise<CallToolResult> => {
      try {
        const record = await videoStore.getById(video_id);
        if (!record) {
          throw new MoreelError(ErrorCode.VIDEO_NOT_FOUND);
        }

        const output = {
          video_id,
          scenes: (record.scenes ?? []).map((scene) => ({
            id: scene.id,
            start_timestamp: scene.startTimestamp,
            end_timestamp: scene.endTimestamp,
            ...(scene.description ? { description: scene.description } : {}),
          })),
          entities: (record.entities ?? []).map((entity) => ({
            id: entity.id,
            type: entity.type,
            label: entity.label,
            ...(entity.description ? { description: entity.description } : {}),
            first_seen: entity.firstSeen,
            last_seen: entity.lastSeen,
            confidence: entity.confidence,
          })),
          interactions: (record.interactions ?? []).map((interaction) => ({
            id: interaction.id,
            type: interaction.type,
            timestamp: interaction.timestamp,
            ...(interaction.endTimestamp !== undefined ? { end_timestamp: interaction.endTimestamp } : {}),
            ...(interaction.actorEntityId ? { actor_entity_id: interaction.actorEntityId } : {}),
            ...(interaction.targetEntityId ? { target_entity_id: interaction.targetEntityId } : {}),
            evidence_level: interaction.evidenceLevel,
            confidence: interaction.confidence,
          })),
          references: (record.references ?? []).map((reference) => ({
            id: reference.id,
            timestamp: reference.timestamp,
            phrase: reference.phrase,
            ...(reference.targetEntityId ? { target_entity_id: reference.targetEntityId } : {}),
            relation: reference.relation,
            evidence_level: reference.evidenceLevel,
            confidence: reference.confidence,
          })),
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        const moreelError = isMoreelError(error) ? error : toMoreelError(error);
        logger.error({ video_id, errorCode: moreelError.code }, 'get_video_map tool call failed');
        const clientView = moreelError.toClientView();
        return {
          isError: true,
          content: [{ type: 'text', text: `Get video map failed: ${clientView.message} (code: ${clientView.code})` }],
          structuredContent: { ...clientView },
        };
      }
    },
  );
}
