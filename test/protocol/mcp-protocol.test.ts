import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { registerTranscribeVideoTool } from '../../src/mcp/tools/transcribe-video.js';
import { ErrorCode, MoreelError } from '../../src/domain/errors.js';
import {
  buildTranscriptionService,
  FakeInstagramProvider,
  silentLogger,
} from '../helpers/service-fakes.js';
import type { TranscriptionService } from '../../src/app/transcription-service.js';

/**
 * These tests exercise the tool the way a real MCP client would: over an
 * actual (in-memory) MCP transport, going through JSON-RPC request/response
 * handling, argument validation, and result serialization — not just
 * calling our TypeScript functions directly.
 */
async function connectedClientAndServer(
  transcriptionService: TranscriptionService,
): Promise<{ client: Client; server: McpServer; close: () => Promise<void> }> {
  const server = new McpServer({ name: 'moreel', version: '0.1.0' });
  registerTranscribeVideoTool(server, transcriptionService, silentLogger);

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return {
    client,
    server,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe('MCP protocol', () => {
  let close: () => Promise<void>;
  let client: Client;

  afterEach(async () => {
    if (close) await close();
  });

  it('initializes and reports server info', async () => {
    const { service } = buildTranscriptionService();
    ({ client, close } = await connectedClientAndServer(service));

    const serverVersion = client.getServerVersion();
    expect(serverVersion?.name).toBe('moreel');
  });

  it('lists transcribe_video with a precise, LLM-facing description and schema', async () => {
    const { service } = buildTranscriptionService();
    ({ client, close } = await connectedClientAndServer(service));

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);

    const tool = tools[0]!;
    expect(tool.name).toBe('transcribe_video');
    expect(tool.description).toContain('Instagram Reel');
    expect(tool.description).toContain('does NOT');
    expect(tool.description?.toLowerCase()).toContain('audio');

    expect(tool.inputSchema.type).toBe('object');
    expect(tool.inputSchema.properties).toHaveProperty('url');
    expect(tool.inputSchema.required).toContain('url');

    expect(tool.outputSchema?.properties).toHaveProperty('segments');
    expect(tool.outputSchema?.properties).toHaveProperty('text');
    expect(tool.outputSchema?.properties).toHaveProperty('duration_seconds');

    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(tool.annotations?.destructiveHint).toBe(false);
  });

  it('invokes the tool successfully and returns structured content matching the schema', async () => {
    const { service } = buildTranscriptionService();
    ({ client, close } = await connectedClientAndServer(service));

    const result = await client.callTool({
      name: 'transcribe_video',
      arguments: { url: 'https://www.instagram.com/reel/CzTest123/' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      video_id: expect.any(String),
      source: 'instagram',
      url: 'https://www.instagram.com/reel/CzTest123/',
      duration_seconds: 53.28,
      language: 'en',
      low_confidence: false,
      segments: [{ start: 0, end: 2.44, text: '10 out of 10 unusual hobbies.' }],
      text: '10 out of 10 unusual hobbies.',
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.type).toBe('text');
    expect(content[0]?.text).toContain('10 out of 10 unusual hobbies.');
  });

  it('rejects a call missing the required "url" argument as a schema validation error', async () => {
    const { service } = buildTranscriptionService();
    ({ client, close } = await connectedClientAndServer(service));

    const result = await client.callTool({ name: 'transcribe_video', arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toMatch(/invalid arguments/i);
  });

  it('rejects a call with a wrong-typed "url" argument as a schema validation error', async () => {
    const { service } = buildTranscriptionService();
    ({ client, close } = await connectedClientAndServer(service));

    const result = await client.callTool({ name: 'transcribe_video', arguments: { url: 12345 } });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toMatch(/invalid arguments/i);
  });

  it('returns a typed, structured tool error (isError: true) for an unsupported URL, not a protocol error', async () => {
    const { service } = buildTranscriptionService();
    ({ client, close } = await connectedClientAndServer(service));

    const result = await client.callTool({
      name: 'transcribe_video',
      arguments: { url: 'https://www.youtube.com/watch?v=abc' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'UNSUPPORTED_SOURCE' });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain('UNSUPPORTED_SOURCE');
  });

  it('returns a typed tool error for a malformed (but present) URL string', async () => {
    const { service } = buildTranscriptionService();
    ({ client, close } = await connectedClientAndServer(service));

    const result = await client.callTool({
      name: 'transcribe_video',
      arguments: { url: 'not a url at all' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'INVALID_URL' });
  });

  it('surfaces a provider failure as a typed tool error without leaking internals', async () => {
    const provider = new FakeInstagramProvider(async () => {
      throw new MoreelError(ErrorCode.CONTENT_UNAVAILABLE);
    });
    const { service } = buildTranscriptionService({ provider });
    ({ client, close } = await connectedClientAndServer(service));

    const result = await client.callTool({
      name: 'transcribe_video',
      arguments: { url: 'https://www.instagram.com/reel/gone/' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'CONTENT_UNAVAILABLE' });
  });

  it('surfaces an unexpected internal failure as a generic typed error, never a raw stack trace', async () => {
    const provider = new FakeInstagramProvider(async () => {
      throw new Error('/var/secret/credentials.json could not be read');
    });
    const { service } = buildTranscriptionService({ provider });
    ({ client, close } = await connectedClientAndServer(service));

    const result = await client.callTool({
      name: 'transcribe_video',
      arguments: { url: 'https://www.instagram.com/reel/boom/' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(result)).not.toContain('/var/secret/credentials.json');
  });

  it('rejects a call to an unknown tool name', async () => {
    const { service } = buildTranscriptionService();
    ({ client, close } = await connectedClientAndServer(service));

    const result = await client.callTool({ name: 'not_a_real_tool', arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toMatch(/not found/i);
  });
});
