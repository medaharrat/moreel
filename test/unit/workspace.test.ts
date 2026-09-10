import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { withRequestWorkspace } from '../../src/media/workspace.js';

describe('withRequestWorkspace', () => {
  it('creates a temp directory under the given base and passes it to the callback', async () => {
    let seenDir = '';
    await withRequestWorkspace(tmpdir(), async (workDir) => {
      seenDir = workDir;
      expect(workDir.startsWith(tmpdir())).toBe(true);
      const stats = await stat(workDir);
      expect(stats.isDirectory()).toBe(true);
    });
    await expect(stat(seenDir)).rejects.toThrow();
  });

  it('cleans up the temp directory even when the callback throws', async () => {
    let seenDir = '';
    await expect(
      withRequestWorkspace(tmpdir(), async (workDir) => {
        seenDir = workDir;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(stat(seenDir)).rejects.toThrow();
  });

  it('propagates the callback return value', async () => {
    const result = await withRequestWorkspace(tmpdir(), async () => 'done');
    expect(result).toBe('done');
  });

  it('falls back to the OS temp dir when no base dir is configured', async () => {
    let seenDir = '';
    await withRequestWorkspace(undefined, async (workDir) => {
      seenDir = workDir;
    });
    expect(seenDir.startsWith(tmpdir())).toBe(true);
  });
});
