import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from 'pino';
import type { TranscriptionService } from '../../app/transcription-service.js';
import { isMoreelError, toMoreelError } from '../../domain/errors.js';
import { newRequestId } from '../../observability/logger.js';

const inputSchema = {
  url: z
    .string()
    .describe(
      'A public video URL — Instagram Reel, TikTok, or YouTube/Shorts. Must point to content that does not require login to view.',
    ),
};

const segmentSchema = z.object({
  start: z.number().describe('Segment start time in seconds.'),
  end: z.number().describe('Segment end time in seconds.'),
  text: z.string().describe('Transcribed text spoken during this segment.'),
});

const visualObservationSchema = z.object({
  timestamp: z.number().describe('Seconds from the start of the video this observation belongs to.'),
  endTimestamp: z.number().optional().describe('Seconds this observation remains visible, when it spans a range.'),
  type: z
    .enum(['on_screen_text', 'visual_context', 'scene', 'object', 'ui', 'chart', 'document', 'product', 'logo'])
    .describe('The kind of visual information detected.'),
  text: z.string().describe('The detected/described content, preserved verbatim.'),
  confidence: z.number().optional().describe('Confidence in [0, 1], when reported.'),
});

const outputSchema = {
  video_id: z
    .string()
    .optional()
    .describe('Stable id for this video — pass this to search_video, find_moment, and get_video_timeline.'),
  source: z.enum(['instagram', 'tiktok', 'youtube']),
  url: z.string(),
  duration_seconds: z.number(),
  language: z.string().optional(),
  low_confidence: z.boolean(),
  segments: z.array(segmentSchema),
  text: z.string(),
  visual: z
    .object({ observations: z.array(visualObservationSchema) })
    .optional()
    .describe('Visual observations detected — on-screen text, charts, products, scene context, etc.'),
  map: z
    .object({
      interactions: z.array(
        z.object({ timestamp: z.number(), type: z.string(), targetLabel: z.string(), confidence: z.number() }),
      ),
      references: z.array(
        z.object({ timestamp: z.number(), phrase: z.string(), targetLabel: z.string(), confidence: z.number() }),
      ),
    })
    .optional()
    .describe(
      'Present only when the Video Map (VIDEO_MAP_ENABLED) resolved at least one "this"/"that"/pointing reference to a specific visual target. Use get_video_map for the full picture including unresolved/uncertain ones.',
    ),
};

const TOOL_DESCRIPTION = `Watches a public video end to end and returns a full multimodal understanding of it: the spoken transcript AND the meaningful visual information it shows (on-screen text, charts, products, UI, scene context) — always with visual analysis requested, unlike transcribe_video where it's opt-in.

Use this as the entry point for any question that isn't purely "what was said" — anything about what was shown, displayed, or visible. The returned "video_id" can then be passed to search_video (find every mention of a topic across both speech and on-screen content), find_moment (get the single best timestamped piece of evidence for a question), and get_video_timeline (the full chronological merge of both modalities) — without re-submitting the URL or re-processing the video.

WHAT IT DOES NOT DO
- Same platform/access limitations as transcribe_video: no private/login-gated/deleted content, no platforms beyond Instagram Reels, TikTok, and YouTube videos/Shorts.
- Does not itself answer free-form questions — call search_video or find_moment on the returned video_id for that.`;

export function registerUnderstandVideoTool(
  server: McpServer,
  transcriptionService: TranscriptionService,
  logger: Logger,
): void {
  server.registerTool(
    'understand_video',
    {
      title: 'Understand Video',
      description: TOOL_DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Understand Video',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url }, extra): Promise<CallToolResult> => {
      const requestId = newRequestId();
      try {
        const result = await transcriptionService.transcribeVideo({
          url,
          requestId,
          signal: extra.signal,
          includeVisual: true,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: { ...result },
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error;
        }
        const moreelError = isMoreelError(error) ? error : toMoreelError(error);
        logger.error(
          { requestId, errorCode: moreelError.code, err: moreelError.message },
          'understand_video tool call failed',
        );
        const clientView = moreelError.toClientView();
        return {
          isError: true,
          content: [{ type: 'text', text: `Understanding video failed: ${clientView.message} (code: ${clientView.code})` }],
          structuredContent: { ...clientView },
        };
      }
    },
  );
}
