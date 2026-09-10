import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from 'pino';
import type { VideoStore } from '../../app/video-store.js';
import { resolveSemanticSearch } from '../../app/query-embedding.js';
import { searchVideo } from '../../app/video-search.js';
import { ErrorCode, MoreelError, isMoreelError, toMoreelError } from '../../domain/errors.js';
import type { EmbeddingProvider } from '../../embeddings/embedding-provider.js';

const inputSchema = {
  video_id: z.string().describe('A video id previously returned by understand_video or transcribe_video.'),
  query: z.string().describe('What to search for — a word, phrase, name, number, or topic.'),
};

const resultSchema = z.object({
  timestamp: z.number().describe('Seconds from the start of the video.'),
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
    .describe(
      'Which modality this match came from — "speech" means it was said, "interaction"/"reference" are resolved Video Map events (see get_video_map), anything else means it was shown.',
    ),
  text: z.string(),
  confidence: z.number().optional(),
  frame_id: z.string().optional().describe('When present, fetch the evidence frame via GET /media/:frame_id on the HTTP API.'),
});

const outputSchema = {
  video_id: z.string(),
  query: z.string(),
  results: z.array(resultSchema).describe('Ranked matches across speech AND on-screen/visual content, most relevant first.'),
};

const TOOL_DESCRIPTION = `Searches across every information channel of a previously-understood video — spoken transcript, on-screen text, and visual context — for a word, phrase, name, or topic. Returns every match with its own timestamp and which modality it came from ("speech" vs. an on-screen/visual type), ranked by relevance.

Requires a "video_id" from a prior understand_video or transcribe_video call. Use this instead of re-reading a whole transcript when you already know what you're looking for — e.g. "pricing", "$49", "the dashboard", "AI agents".`;

export function registerSearchVideoTool(
  server: McpServer,
  videoStore: VideoStore,
  logger: Logger,
  embeddingProvider?: EmbeddingProvider,
  embeddingTimeoutMs = 20_000,
): void {
  server.registerTool(
    'search_video',
    {
      title: 'Search Video',
      description: TOOL_DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Search Video',
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
        const results = searchVideo(record.transcript, record.visualObservations, query, semantic, mapData).map((result) => ({
          timestamp: result.timestamp,
          ...(result.endTimestamp !== undefined ? { end_timestamp: result.endTimestamp } : {}),
          source: result.source,
          text: result.text,
          ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
          ...(result.frameId !== undefined ? { frame_id: result.frameId } : {}),
        }));

        const output = { video_id, query, results };
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        const moreelError = isMoreelError(error) ? error : toMoreelError(error);
        logger.error({ video_id, errorCode: moreelError.code }, 'search_video tool call failed');
        const clientView = moreelError.toClientView();
        return {
          isError: true,
          content: [{ type: 'text', text: `Search failed: ${clientView.message} (code: ${clientView.code})` }],
          structuredContent: { ...clientView },
        };
      }
    },
  );
}
