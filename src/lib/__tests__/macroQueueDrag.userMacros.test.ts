import { describe, expect, it } from 'vitest';
import { applyQueueDragEnd, patternDropId } from '@/lib/macroQueueDrag';
import type { QueueItem } from '@/types/macros';

describe('applyQueueDragEnd — machine macros', () => {
  const rootUser: QueueItem = {
    id: 'u1',
    kind: 'macro',
    macroTypeId: 'user-ngc-go_home',
    params: {},
  };
  const pattern: QueueItem = {
    id: 'p1',
    kind: 'pattern',
    params: { name: 'holes' },
    children: [],
  };

  it('rejects dropping a user-ngc macro onto a pattern drop zone', () => {
    const items: QueueItem[] = [rootUser, pattern];
    expect(applyQueueDragEnd(items, 'u1', patternDropId('p1'))).toBeNull();
  });
});
