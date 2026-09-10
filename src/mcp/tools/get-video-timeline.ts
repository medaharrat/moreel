import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from 'pino';
import { buildTimeline } from '../../app/timeline.js';
import type { VideoStore } from '../../app/video-store.js';
import { ErrorCode, MoreelError, isMoreelError, toMoreelError } from '../../domain/errors.js';

const inputSchema = {
  video_id: z.string().describe('A video id previously returned by understand_video or transcribe_video.'),
};

const eventSchema = z.object({
  timestamp: z.number(),
  end_timestamp: z.number().optional(),
  source: z.enum([
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
  ]),
  text: z.string(),
  confidence: z.number().optional(),
  frame_id: z.string().optional(),
});

const outputSchema = {
  video_id: z.string(),
  duration_seconds: z.number(),
  events: z.array(eventSchema).describe('Every speech and visual event, merged and sorted chronologically.'),
};

const TOOL_DESCRIPTION = `Returns the full chronological, merged timeline of a previously-understood video — every spoken segment interleaved with every visual observation, in time order. This is the underlying structure search_video and find_moment query; use it when you need the complete picture rather than a single answer (e.g. "walk through everything that happens in this video").

Requires a "video_id" from a prior understand_video or transcribe_video call.`;

export function registerGetVideoTimelineTool(server: McpServer, videoStore: VideoStore, logger: Logger): void {
  server.registerTool(
    'get_video_timeline',
    {
      title: 'Get Video Timeline',
      description: TOOL_DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Get Video Timeline',
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

        const mapData = { entities: record.entities, interactions: record.interactions, references: record.references };
        const events = buildTimeline(record.transcript, record.visualObservations, mapData).map((event) => ({
          timestamp: event.timestamp,
          ...(event.endTimestamp !== undefined ? { end_timestamp: event.endTimestamp } : {}),
          source: event.source,
          text: event.text,
          ...(event.confidence !== undefined ? { confidence: event.confidence } : {}),
          ...(event.frameId !== undefined ? { frame_id: event.frameId } : {}),
        }));

        const output = { video_id, duration_seconds: record.durationSeconds, events };
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        const moreelError = isMoreelError(error) ? error : toMoreelError(error);
        logger.error({ video_id, errorCode: moreelError.code }, 'get_video_timeline tool call failed');
        const clientView = moreelError.toClientView();
        return {
          isError: true,
          content: [{ type: 'text', text: `Get timeline failed: ${clientView.message} (code: ${clientView.code})` }],
          structuredContent: { ...clientView },
        };
      }
    },
  );
}
