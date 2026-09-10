import { describe, expect, it } from 'vitest';
import { captureException, initErrorTracking } from '../../../src/observability/error-tracking.js';

describe('error tracking', () => {
  it('is a no-op when no DSN is configured', () => {
    initErrorTracking(undefined);
    expect(() => captureException(new Error('boom'), { requestId: 'req-1' })).not.toThrow();
  });
});
