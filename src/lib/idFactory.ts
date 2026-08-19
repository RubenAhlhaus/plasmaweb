export function createQueueItemId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `q-${globalThis.crypto.randomUUID()}`;
  }
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
