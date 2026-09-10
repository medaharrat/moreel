import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/index.js';

describe('loadConfig', () => {
  it('applies documented defaults when no env vars are set', () => {
    const config = loadConfig({});
    expect(config.transcriptionProvider).toBe('openai');
    expect(config.transcriptionModel).toBe('whisper-1');
    expect(config.maxVideoSizeBytes).toBe(100 * 1024 * 1024);
    expect(config.maxVideoDurationSeconds).toBe(600);
    expect(config.requestTimeoutMs).toBe(60_000);
    expect(config.downloadTimeoutMs).toBe(30_000);
    expect(config.transcriptionTimeoutMs).toBe(45_000);
    expect(config.maxConcurrentRequests).toBe(4);
    expect(config.cacheEnabled).toBe(true);
    expect(config.cacheTtlMs).toBe(3600 * 1000);
    expect(config.cacheMaxEntries).toBe(200);
    expect(config.ytDlpPath).toBe('yt-dlp');
    expect(config.ffmpegPath).toBe('ffmpeg');
    expect(config.logLevel).toBe('info');
  });

  it('reads overrides from the given env map', () => {
    const config = loadConfig({
      MAX_VIDEO_SIZE_MB: '25',
      MAX_VIDEO_DURATION_SECONDS: '120',
      MAX_CONCURRENT_REQUESTS: '2',
      CACHE_ENABLED: 'false',
      LOG_LEVEL: 'debug',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(config.maxVideoSizeBytes).toBe(25 * 1024 * 1024);
    expect(config.maxVideoDurationSeconds).toBe(120);
    expect(config.maxConcurrentRequests).toBe(2);
    expect(config.cacheEnabled).toBe(false);
    expect(config.logLevel).toBe('debug');
    expect(config.openaiApiKey).toBe('sk-test');
  });

  it('rejects an out-of-range numeric value', () => {
    expect(() => loadConfig({ MAX_VIDEO_DURATION_SECONDS: '99999' })).toThrow(ConfigError);
  });

  it('rejects a non-numeric value for a numeric field', () => {
    expect(() => loadConfig({ MAX_CONCURRENT_REQUESTS: 'not-a-number' })).toThrow(ConfigError);
  });

  it('rejects an unsupported transcription provider', () => {
    expect(() => loadConfig({ TRANSCRIPTION_PROVIDER: 'not-a-real-provider' })).toThrow(
      ConfigError,
    );
  });

  it('rejects an unsupported log level', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow(ConfigError);
  });

  it('parses boolean-like values case-insensitively', () => {
    expect(loadConfig({ CACHE_ENABLED: 'TRUE' }).cacheEnabled).toBe(true);
    expect(loadConfig({ CACHE_ENABLED: 'False' }).cacheEnabled).toBe(false);
    expect(loadConfig({ CACHE_ENABLED: 'anything-else' }).cacheEnabled).toBe(false);
  });
});
