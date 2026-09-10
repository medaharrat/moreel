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
      'A public video URL — Instagram Reel (e.g. "https://www.instagram.com/reel/ABC123xyz/"), ' +
        'TikTok (e.g. "https://www.tiktok.com/@user/video/123..."), or YouTube/Shorts ' +
        '(e.g. "https://www.youtube.com/shorts/ABC123xyz" or "https://youtu.be/ABC123xyz"). ' +
        'Must point to content that does not require login to view.',
    ),
  includeVisualObservation: z
    .boolean()
    .optional()
    .describe(
      'Whether to also analyze visual content (on-screen text, slides, charts, meaningful scene ' +
        'context) alongside the spoken transcript. Only has an effect when the server has visual ' +
        'analysis enabled at all; otherwise silently ignored. Defaults to true (matches existing ' +
        "behavior) — pass false to skip it for this call even when the server supports it.",
    ),
  includeVideoMap: z
    .boolean()
    .optional()
    .describe(
      'Whether to also resolve "this"/"that"/pointing references to a specific visual entity (the ' +
        'Video Map). Only has an effect when the server has the Video Map enabled AND ' +
        'includeVisualObservation is not false — it enriches the same sampled frames, not a ' +
        'standalone stage. Defaults to true (matches existing behavior) — pass false to skip it.',
    ),
};

const segmentSchema = z.object({
  start: z.number().describe('Segment start time in seconds, relative to the start of the video.'),
  end: z.number().describe('Segment end time in seconds.'),
  text: z.string().describe('Transcribed text spoken during this segment.'),
});

const outputSchema = {
  video_id: z
    .string()
    .optional()
    .describe('Stable id for this video — pass this to search_video, find_moment, and get_video_timeline instead of re-submitting the URL.'),
  source: z.enum(['instagram', 'tiktok', 'youtube']).describe('The platform the video was retrieved from.'),
  url: z.string().describe('The canonical URL that was transcribed.'),
  duration_seconds: z.number().describe('Total duration of the video/audio in seconds.'),
  language: z
    .string()
    .optional()
    .describe(
      'BCP-47-ish language code detected in the spoken audio (e.g. "en"), if it could be determined.',
    ),
  low_confidence: z
    .boolean()
    .describe(
      'True when parts of the audio were unclear, mostly music/silence, or otherwise low-confidence. ' +
        'When true, treat the transcript as best-effort rather than verbatim.',
    ),
  segments: z
    .array(segmentSchema)
    .describe('Timestamped transcript segments, in chronological order.'),
  text: z.string().describe('The full transcript as plain text, in order.'),
  visual: z
    .object({
      observations: z.array(
        z.object({
          timestamp: z.number().describe('Seconds from the start of the video this observation belongs to.'),
          endTimestamp: z
            .number()
            .optional()
            .describe('Seconds this observation remains visible, when it spans a range rather than an instant.'),
          type: z
            .enum([
              'on_screen_text',
              'visual_context',
              'scene',
              'object',
              'ui',
              'chart',
              'document',
              'product',
              'logo',
            ])
            .describe('The kind of visual information detected.'),
          text: z
            .string()
            .describe('The detected/described content, preserved verbatim — never corrected or guessed at.'),
          confidence: z
            .number()
            .optional()
            .describe('Confidence in [0, 1], when reported. Treat a low-confidence reading as uncertain, not fact.'),
        }),
      ),
    })
    .optional()
    .describe(
      'Meaningful visual information detected in the video — on-screen text, slides, charts, UI, or ' +
        'scene context necessary to understand what is being discussed. Present only when visual ' +
        "analysis is enabled and found something worth surfacing; absent doesn't mean nothing was " +
        'shown, only that nothing met the bar. This is never a caption for every frame — expect a ' +
        'short list of high-value observations, not a play-by-play.',
    ),
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

/**
 * The MCP tool description. This is the primary signal a calling model uses
 * to decide whether and how to invoke the tool, so it is deliberately
 * explicit about scope, inputs, outputs, and failure modes — an agent
 * should never have to guess whether this tool "also" looks at the video's
 * visuals, or whether TikTok/YouTube links will work.
 */
const TOOL_DESCRIPTION = `Retrieves a public Instagram Reel, TikTok video, or YouTube video/Short and returns an accurate, timestamped transcript of its spoken audio — and, when visual analysis is enabled, meaningful visual information the video shows.

WHAT IT DOES
- Downloads the video/audio behind a public URL and transcribes the spoken speech using an automatic speech recognition model.
- Returns structured, timestamped segments plus a combined plain-text transcript, along with the detected spoken language and total duration.
- When visual analysis is enabled server-side, also returns "visual" — a short list of meaningful visual observations (on-screen text/slides, charts, UI, important scene context) with their own timestamps. This is never a caption for every frame; it only includes what a reader would actually need to understand the video without watching it. Absent or empty "visual" does not mean nothing was shown — it means nothing met that bar (or visual analysis wasn't enabled).

WHAT IT DOES NOT DO
- It does NOT work on private, login-gated, deleted, or otherwise inaccessible content, and it never attempts to bypass login, CAPTCHAs, or other access controls — such content returns a typed error instead.
- It does NOT currently support any platform other than Instagram Reels, TikTok videos, and YouTube videos/Shorts (no X/Twitter, etc.), and no Instagram content types other than Reels (no photo posts, carousels, Stories, or IGTV).
- Visual analysis, when it runs, does not describe trivial visual activity (a person moving, blinking, camera motion) — only information that materially helps understand the content.

SUPPORTED INPUT
- Public Instagram Reel, TikTok video, or YouTube video/Short URLs, e.g.:
  https://www.instagram.com/reel/ABC123xyz/
  https://www.tiktok.com/@user/video/123...
  https://www.youtube.com/shorts/ABC123xyz
- Any other URL shape or domain returns an UNSUPPORTED_SOURCE error.

LIMITATIONS
- Videos are subject to a configured maximum duration and file size; longer/larger videos are rejected rather than partially processed.
- Background music, overlapping speakers, heavy accents, or very noisy audio can reduce accuracy; when the model itself is uncertain, "low_confidence" is set to true instead of guessing at unclear speech.
- This is a best-effort automatic transcript, not a human-verified one. Visual observations, when present, are similarly best-effort — on-screen text is preserved exactly as read, never "corrected", and a low "confidence" means treat it as uncertain rather than fact.

Use this tool when you need the words spoken in a public video from one of the supported platforms, and optionally what it visually showed.`;

export function registerTranscribeVideoTool(
  server: McpServer,
  transcriptionService: TranscriptionService,
  logger: Logger,
): void {
  server.registerTool(
    'transcribe_video',
    {
      title: 'Transcribe Video',
      description: TOOL_DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Transcribe Video',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url, includeVisualObservation, includeVideoMap }, extra): Promise<CallToolResult> => {
      const requestId = newRequestId();
      try {
        const result = await transcriptionService.transcribeVideo({
          url,
          requestId,
          signal: extra.signal,
          ...(includeVisualObservation !== undefined ? { includeVisual: includeVisualObservation } : {}),
          ...(includeVideoMap !== undefined ? { includeVideoMap } : {}),
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
          'transcribe_video tool call failed',
        );
        const clientView = moreelError.toClientView();
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Transcription failed: ${clientView.message} (code: ${clientView.code})`,
            },
          ],
          structuredContent: { ...clientView },
        };
      }
    },
  );
}
