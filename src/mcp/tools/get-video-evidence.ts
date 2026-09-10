import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from 'pino';
import type { VideoStore } from '../../app/video-store.js';
import { ErrorCode, MoreelError, isMoreelError, toMoreelError } from '../../domain/errors.js';

const inputSchema = {
  video_id: z.string().describe('A video id previously returned by understand_video or transcribe_video.'),
  evidence_id: z
    .string()
    .describe('An entity/interaction/reference id, from get_video_map, get_video_entity, search_video, or find_moment.'),
};

const outputSchema = {
  video_id: z.string(),
  evidence_id: z.string(),
  found: z.boolean(),
  kind: z.enum(['entity', 'interaction', 'reference']).optional(),
  timestamp: z.number().optional(),
  modality: z.string().optional().describe('What kind of fact this is — an entity type, interaction type, or reference relation.'),
  evidence_level: z.enum(['observed', 'inferred', 'uncertain']).optional(),
  confidence: z.number().optional(),
  detail: z.record(z.string(), z.unknown()).optional().describe('The full underlying record for this id.'),
};

const TOOL_DESCRIPTION = `Looks up the full evidence behind a single Video Map fact by id — never invents detail beyond what was actually recorded (see get_video_map, get_video_entity). Use this to double-check a specific claim before treating it as authoritative, e.g. confirming a reference's evidence_level before repeating its resolved target as fact.`;

export function registerGetVideoEvidenceTool(server: McpServer, videoStore: VideoStore, logger: Logger): void {
  server.registerTool(
    'get_video_evidence',
    {
      title: 'Get Video Evidence',
      description: TOOL_DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Get Video Evidence',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ video_id, evidence_id }): Promise<CallToolResult> => {
      try {
        const record = await videoStore.getById(video_id);
        if (!record) {
          throw new MoreelError(ErrorCode.VIDEO_NOT_FOUND);
        }

        const entity = record.entities?.find((candidate) => candidate.id === evidence_id);
        const interaction = record.interactions?.find((candidate) => candidate.id === evidence_id);
        const reference = record.references?.find((candidate) => candidate.id === evidence_id);

        let output: Record<string, unknown>;
        if (entity) {
          output = {
            video_id,
            evidence_id,
            found: true,
            kind: 'entity',
            timestamp: entity.firstSeen,
            modality: entity.type,
            confidence: entity.confidence,
            detail: entity,
          };
        } else if (interaction) {
          output = {
            video_id,
            evidence_id,
            found: true,
            kind: 'interaction',
            timestamp: interaction.timestamp,
            modality: interaction.type,
            evidence_level: interaction.evidenceLevel,
            confidence: interaction.confidence,
            detail: interaction,
          };
        } else if (reference) {
          output = {
            video_id,
            evidence_id,
            found: true,
            kind: 'reference',
            timestamp: reference.timestamp,
            modality: reference.relation,
            evidence_level: reference.evidenceLevel,
            confidence: reference.confidence,
            detail: reference,
          };
        } else {
          output = { video_id, evidence_id, found: false };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        const moreelError = isMoreelError(error) ? error : toMoreelError(error);
        logger.error({ video_id, evidence_id, errorCode: moreelError.code }, 'get_video_evidence tool call failed');
        const clientView = moreelError.toClientView();
        return {
          isError: true,
          content: [{ type: 'text', text: `Get video evidence failed: ${clientView.message} (code: ${clientView.code})` }],
          structuredContent: { ...clientView },
        };
      }
    },
  );
}
