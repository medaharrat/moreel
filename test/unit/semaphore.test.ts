import { describe, expect, it } from 'vitest';
import { Semaphore } from '../../src/util/semaphore.js';
import { MoreelError } from '../../src/domain/errors.js';

describe('Semaphore', () => {
  it('runs work immediately when under capacity', async () => {
    const sem = new Semaphore(2);
    const result = await sem.run(async () => 42);
    expect(result).toBe(42);
    expect(sem.inFlight).toBe(0);
  });

  it('queues work beyond capacity with run() and releases in order', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolveStarted) => {
      void sem.run(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
            resolveStarted();
          }),
      );
    });
    await firstStarted;

    const second = sem.run(async () => {
      order.push(2);
    });

    expect(sem.inFlight).toBe(1);
    releaseFirst();
    await second;
    expect(order).toEqual([2]);
  });

  it('runOrReject fails fast with RATE_LIMITED when the gate is full', async () => {
    const sem = new Semaphore(1);
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolveStarted) => {
      void sem.run(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
            resolveStarted();
          }),
      );
    });
    await firstStarted;

    await expect(sem.runOrReject(async () => 'never')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    await expect(sem.runOrReject(async () => 'never')).rejects.toBeInstanceOf(MoreelError);

    releaseFirst();
  });

  it('releases the slot even when the task throws', async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(sem.inFlight).toBe(0);
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok');
  });
});
