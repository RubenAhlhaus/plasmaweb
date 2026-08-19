import { applyQueueDragEnd } from '@/lib/macroQueueDrag';
import type { MacroParams, MacroQueueItem, PatternQueueItem, QueueItem } from '@/types/macros';

export type QueueEditTarget =
  | { scope: 'root'; index: number }
  | { scope: 'child'; patternId: string; index: number };

export function createMacroQueueItem(
  id: string,
  macroTypeId: string,
  params: MacroParams,
): MacroQueueItem {
  return {
    kind: 'macro',
    id,
    macroTypeId,
    params,
  };
}

export function createPatternQueueItem(id: string, params: MacroParams): PatternQueueItem {
  return {
    kind: 'pattern',
    id,
    params,
    children: [],
  };
}

export function addRootItem(queue: QueueItem[], item: QueueItem): QueueItem[] {
  return [...queue, item];
}

export function addMacroToPatternEnd(
  queue: QueueItem[],
  patternId: string,
  macro: MacroQueueItem,
): QueueItem[] {
  return queue.map((item) =>
    item.kind === 'pattern' && item.id === patternId
      ? { ...item, children: [...item.children, macro] }
      : item,
  );
}

export function updateQueueItemParams(
  queue: QueueItem[],
  target: QueueEditTarget,
  params: MacroParams,
): QueueItem[] {
  if (target.scope === 'root') {
    return queue.map((item, index) => (index === target.index ? { ...item, params } : item));
  }

  return queue.map((item) => {
    if (item.kind !== 'pattern' || item.id !== target.patternId) return item;
    return {
      ...item,
      children: item.children.map((child, index) =>
        index === target.index ? { ...child, params } : child,
      ),
    };
  });
}

export function removeQueueItem(queue: QueueItem[], target: QueueEditTarget): QueueItem[] {
  if (target.scope === 'root') {
    return queue.filter((_, index) => index !== target.index);
  }

  return queue.map((item) => {
    if (item.kind !== 'pattern' || item.id !== target.patternId) return item;
    return {
      ...item,
      children: item.children.filter((_, index) => index !== target.index),
    };
  });
}

export function reorderQueueItems(
  queue: QueueItem[],
  activeId: string,
  overId: string,
): QueueItem[] | null {
  return applyQueueDragEnd(queue, activeId, overId);
}
