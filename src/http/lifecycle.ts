/**
 * Tracks the process's own lifecycle phase, independent of any external
 * dependency (Instagram, the transcription provider, Redis, Postgres).
 * `/health` answers "is this process alive" and never consults this;
 * `/ready` answers "should traffic be routed here" and does.
 */
export type LifecyclePhase = 'starting' | 'ready' | 'draining';

export class AppLifecycle {
  private phase: LifecyclePhase = 'starting';

  markReady(): void {
    this.phase = 'ready';
  }

  markDraining(): void {
    this.phase = 'draining';
  }

  getPhase(): LifecyclePhase {
    return this.phase;
  }

  isAcceptingWork(): boolean {
    return this.phase === 'ready';
  }
}
