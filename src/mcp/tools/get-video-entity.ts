import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from 'pino';
import type { VideoStore } from '../../app/video-store.js';
import { ErrorCode, MoreelError, isMoreelError, toMoreelError } from '../../domain/errors.js';

const inputSchema = {
  video_id: z.string().describe('A video id previously returned by understand_video or transcribe_video.'),
  entity_id: z.string().describe('An entity id from get_video_map, or a target_entity_id from search_video/find_moment.'),
};

const outputSchema = {
  video_id: z.string(),
  entity_id: z.string(),
  found: z.boolean(),
  type: z.string().optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  first_seen: z.number().optional(),
  last_seen: z.number().optional(),
  confidence: z.number().optional(),
  interactions: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        timestamp: z.number(),
        evidence_level: z.enum(['observed', 'inferred', 'uncertain']),
        confidence: z.number(),
        role: z.enum(['actor', 'target']),
      }),
    )
    .describe('Every interaction this entity was the actor or target of, chronologically.'),
  references: z
    .array(
      z.object({
        id: z.string(),
        timestamp: z.number(),
        phrase: z.string(),
        relation: z.string(),
        evidence_level: z.enum(['observed', 'inferred', 'uncertain']),
        confidence: z.number(),
      }),
    )
    .describe('Every linguistic reference resolved to this entity, chronologically.'),
};

const TOOL_DESCRIPTION = `Returns everything the Video Map knows about one specific entity (a person/product/object) from get_video_map — every interaction it was involved in and every linguistic reference resolved to it, in chronological order.

Use this after get_video_map or search_video/find_moment surfaces an entity id, to see its full history across the video (e.g. "every time the product was pointed at or referred to") rather than one isolated moment.`;

export function registerGetVideoEntityTool(server: McpServer, videoStore: VideoStore, logger: Logger): void {
  server.registerTool(
    'get_video_entity',
    {
      title: 'Get Video Entity',
      description: TOOL_DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Get Video Entity',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ video_id, entity_id }): Promise<CallToolResult> => {
      try {
        const record = await videoStore.getById(video_id);
        if (!record) {
          throw new MoreelError(ErrorCode.VIDEO_NOT_FOUND);
        }

        const entity = record.entities?.find((candidate) => candidate.id === entity_id);
        if (!entity) {
          const output = { video_id, entity_id, found: false };
          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        }

        const interactions = (record.interactions ?? [])
          .filter((interaction) => interaction.actorEntityId === entity_id || interaction.targetEntityId === entity_id)
          .sort((a, b) => a.timestamp - b.timestamp)
          .map((interaction) => ({
            id: interaction.id,
            type: interaction.type,
            timestamp: interaction.timestamp,
            evidence_level: interaction.evidenceLevel,
            confidence: interaction.confidence,
            role: interaction.actorEntityId === entity_id ? ('actor' as const) : ('target' as const),
          }));

        const references = (record.references ?? [])
          .filter((reference) => reference.targetEntityId === entity_id)
          .sort((a, b) => a.timestamp - b.timestamp)
          .map((reference) => ({
            id: reference.id,
            timestamp: reference.timestamp,
            phrase: reference.phrase,
            relation: reference.relation,
            evidence_level: reference.evidenceLevel,
            confidence: reference.confidence,
          }));

        const output = {
          video_id,
          entity_id,
          found: true,
          type: entity.type,
          label: entity.label,
          ...(entity.description ? { description: entity.description } : {}),
          first_seen: entity.firstSeen,
          last_seen: entity.lastSeen,
          confidence: entity.confidence,
          interactions,
          references,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        const moreelError = isMoreelError(error) ? error : toMoreelError(error);
        logger.error({ video_id, entity_id, errorCode: moreelError.code }, 'get_video_entity tool call failed');
        const clientView = moreelError.toClientView();
        return {
          isError: true,
          content: [{ type: 'text', text: `Get video entity failed: ${clientView.message} (code: ${clientView.code})` }],
          structuredContent: { ...clientView },
        };
      }
    },
  );
}
