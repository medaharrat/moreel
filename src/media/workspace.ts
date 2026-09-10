import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Every request gets its own temp directory, always removed via a
 * `finally` block by the caller — guaranteed cleanup regardless of success,
 * typed failure, cancellation, or an unexpected throw. Moreel does not
 * persist user media beyond the lifetime of a single request.
 */
export async function withRequestWorkspace<T>(
  baseDir: string | undefined,
  fn: (workDir: string) => Promise<T>,
): Promise<T> {
  const root = baseDir ?? tmpdir();
  const workDir = await mkdtemp(path.join(root, `moreel-${randomUUID()}-`));
  try {
    return await fn(workDir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
