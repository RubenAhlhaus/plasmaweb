import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueueItemId } from '@/lib/idFactory';

describe('createQueueItemId', () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  });

  it('uses crypto.randomUUID when available', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID: vi.fn(() => 'uuid-123') },
    });
    expect(createQueueItemId()).toBe('q-uuid-123');
  });

  it('falls back when randomUUID is unavailable', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined,
    });
    expect(createQueueItemId()).toMatch(/^q-\d+-[a-z0-9]+$/);
  });
});
