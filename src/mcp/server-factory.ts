import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import { buildEmbeddingProvider, buildTranscriptionService, buildVideoInteractionAnalyzer, buildVideoStore } from '../app/build-transcription-service.js';
import type { MoreelConfig } from '../config/index.js';
import { registerFindMomentTool } from './tools/find-moment.js';
import { registerGetVideoEntityTool } from './tools/get-video-entity.js';
import { registerGetVideoEvidenceTool } from './tools/get-video-evidence.js';
import { registerGetVideoMapTool } from './tools/get-video-map.js';
import { registerGetVideoTimelineTool } from './tools/get-video-timeline.js';
import { registerSearchVideoTool } from './tools/search-video.js';
import { registerTranscribeVideoTool } from './tools/transcribe-video.js';
import { registerUnderstandVideoTool } from './tools/understand-video.js';

export interface BuildServerOptions {
  config: MoreelConfig;
  logger: Logger;
}

/** Wires the transcription pipeline and registers MCP tools. */
export function buildServer({ config, logger }: BuildServerOptions): McpServer {
  // Built once and shared: the pipeline (via transcriptionService) writes
  // VideoRecords here, the query tools (search/find/timeline) only read —
  // same instance so a video understood earlier in this session is
  // immediately queryable by the others.
  const videoStore = buildVideoStore(config);
  const embeddingProvider = buildEmbeddingProvider(config);
  const videoInteractionAnalyzer = buildVideoInteractionAnalyzer(config);
  const transcriptionService = buildTranscriptionService(config, logger, {
    videoStore,
    ...(embeddingProvider ? { embeddingProvider } : {}),
    ...(videoInteractionAnalyzer ? { videoInteractionAnalyzer } : {}),
  });

  const server = new McpServer({
    name: 'moreel',
    version: '0.1.0',
  });

  registerTranscribeVideoTool(server, transcriptionService, logger);
  registerUnderstandVideoTool(server, transcriptionService, logger);
  registerSearchVideoTool(server, videoStore, logger, embeddingProvider, config.searchEmbeddingTimeoutMs);
  registerFindMomentTool(server, videoStore, logger, embeddingProvider, config.searchEmbeddingTimeoutMs);
  registerGetVideoTimelineTool(server, videoStore, logger);
  registerGetVideoMapTool(server, videoStore, logger);
  registerGetVideoEntityTool(server, videoStore, logger);
  registerGetVideoEvidenceTool(server, videoStore, logger);

  return server;
}
