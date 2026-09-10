import { rm } from 'node:fs/promises';

export interface StoredMedia {
  filePath: string;
  contentType: string;
  sizeBytes: number;
  expiresAt: number;
}

/**
 * Holds the already-downloaded video file just long enough for the browser
 * to play it back alongside the transcript it was made from — not a media
 * archive. Every entry is deleted on its own TTL timer regardless of
 * whether it was ever fetched, mirroring the same "always deleted, even on
 * error" guarantee `withRequestWorkspace` gives the transcription pipeline
 * (see docs/privacy.md — downloaded media stays a transient artifact, not
 * a persisted one).
 */
export class MediaStore {
  private readonly entries = new Map<string, StoredMedia>();

  constructor(private readonly ttlMs: number) {}

  put(id: string, entry: Omit<StoredMedia, 'expiresAt'>): void {
    const expiresAt = Date.now() + this.ttlMs;
    this.entries.set(id, { ...entry, expiresAt });
    const timer = setTimeout(() => {
      void this.remove(id);
    }, this.ttlMs);
    timer.unref?.();
  }

  get(id: string): StoredMedia | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      void this.remove(id);
      return undefined;
    }
    return entry;
  }

  async remove(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    await rm(entry.filePath, { force: true }).catch(() => {});
  }

  get size(): number {
    return this.entries.size;
  }
}
