import { describe, expect, it } from 'vitest';
import type { QueueItem } from '@/types/macros';
import {
  addMacroToPatternEnd,
  addRootItem,
  createMacroQueueItem,
  createPatternQueueItem,
  reorderQueueItems,
  removeQueueItem,
  updateQueueItemParams,
} from '@/lib/macroQueue/service';

describe('macroQueue service', () => {
  it('adds root macro item', () => {
    const queue: QueueItem[] = [];
    const macro = createMacroQueueItem('m-1', 'bohren-normal', { x: 1, y: 2 });
    const next = addRootItem(queue, macro);
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual(macro);
  });

  it('adds macro to pattern end', () => {
    const pattern = createPatternQueueItem('p-1', { name: 'holes' });
    const queue: QueueItem[] = [pattern];
    const macro = createMacroQueueItem('m-1', 'bohren-normal', { x: 1, y: 2 });
    const next = addMacroToPatternEnd(queue, 'p-1', macro);
    const block = next[0];
    expect(block.kind).toBe('pattern');
    if (block.kind === 'pattern') {
      expect(block.children).toHaveLength(1);
      expect(block.children[0]).toEqual(macro);
    }
  });

  it('updates root and child params', () => {
    const child = createMacroQueueItem('m-child', 'bohren-normal', { x: 1 });
    const queue: QueueItem[] = [
      createMacroQueueItem('m-root', 'bohren-normal', { x: 2 }),
      { kind: 'pattern', id: 'p-1', params: {}, children: [child] },
    ];
    const rootUpdated = updateQueueItemParams(queue, { scope: 'root', index: 0 }, { x: 10 });
    expect(rootUpdated[0]).toMatchObject({ params: { x: 10 } });

    const childUpdated = updateQueueItemParams(
      rootUpdated,
      { scope: 'child', patternId: 'p-1', index: 0 },
      { x: 20 },
    );
    const block = childUpdated[1];
    expect(block.kind).toBe('pattern');
    if (block.kind === 'pattern') {
      expect(block.children[0].params).toEqual({ x: 20 });
    }
  });

  it('removes root and child items', () => {
    const queue: QueueItem[] = [
      createMacroQueueItem('m-root', 'bohren-normal', { x: 2 }),
      {
        kind: 'pattern',
        id: 'p-1',
        params: {},
        children: [createMacroQueueItem('m-child', 'bohren-normal', { x: 1 })],
      },
    ];

    const withoutChild = removeQueueItem(queue, { scope: 'child', patternId: 'p-1', index: 0 });
    const block = withoutChild[1];
    expect(block.kind).toBe('pattern');
    if (block.kind === 'pattern') {
      expect(block.children).toHaveLength(0);
    }

    const withoutRoot = removeQueueItem(withoutChild, { scope: 'root', index: 0 });
    expect(withoutRoot).toHaveLength(1);
    expect(withoutRoot[0]).toMatchObject({ kind: 'pattern' });
  });

  it('reorders items through service wrapper', () => {
    const queue: QueueItem[] = [
      createMacroQueueItem('m-1', 'bohren-normal', { x: 1 }),
      createMacroQueueItem('m-2', 'bohren-normal', { x: 2 }),
    ];
    const next = reorderQueueItems(queue, 'm-2', 'm-1');
    expect(next).not.toBeNull();
    expect(next?.map((item) => item.id)).toEqual(['m-2', 'm-1']);
  });
});
