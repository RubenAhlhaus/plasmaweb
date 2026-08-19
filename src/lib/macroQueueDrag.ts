import { arrayMove } from '@dnd-kit/sortable';
import { isUserSubroutineMacroId } from '@/data/userSubroutineMacros';
import type { MacroQueueItem, PatternQueueItem, QueueItem } from '@/types/macros';

export const PATTERN_DROP_PREFIX = 'pattern-drop-';

/** Free area below list: drop macro from nested pattern block here → end of root queue. */
export const ROOT_QUEUE_TAIL_DROP_ID = 'program-queue-root-tail';

export function patternDropId(patternId: string): string {
  return `${PATTERN_DROP_PREFIX}${patternId}`;
}

/** Is id inside a nested pattern block? → parent `pattern` id or `null`. */
export function itemParentPatternId(items: QueueItem[], itemId: string): string | null {
  for (const q of items) {
    if (q.kind === 'pattern' && q.children.some((c) => c.id === itemId)) {
      return q.id;
    }
  }
  return null;
}

/** Index in root list **before** macro lands (`items.length` = append). Only when dragging from a nested pattern block. */
export function rootQueueInsertPreviewIndex(
  items: QueueItem[],
  activeId: string | null,
  overId: string | null
): number | null {
  if (!activeId || !overId) return null;
  if (itemParentPatternId(items, activeId) === null) return null;
  if (overId === ROOT_QUEUE_TAIL_DROP_ID) return items.length;
  const idx = items.findIndex((q) => q.id === overId);
  if (idx !== -1) return idx;
  return null;
}

function getContainer(
  items: QueueItem[],
  id: string
): { type: 'root' } | { type: 'pattern'; patternId: string } | null {
  if (items.some((q) => q.id === id)) return { type: 'root' };
  for (const q of items) {
    if (q.kind === 'pattern' && q.children.some((c) => c.id === id)) {
      return { type: 'pattern', patternId: q.id };
    }
  }
  return null;
}

export function findQueueItem(
  items: QueueItem[],
  id: string
): MacroQueueItem | PatternQueueItem | null {
  const root = items.find((q) => q.id === id);
  if (root) return root;
  for (const q of items) {
    if (q.kind === 'pattern') {
      const c = q.children.find((x) => x.id === id);
      if (c) return c;
    }
  }
  return null;
}

function removeItem(items: QueueItem[], id: string): QueueItem[] | null {
  const ri = items.findIndex((q) => q.id === id);
  if (ri !== -1) {
    return [...items.slice(0, ri), ...items.slice(ri + 1)];
  }
  for (let pi = 0; pi < items.length; pi++) {
    const q = items[pi];
    if (q.kind !== 'pattern') continue;
    const ci = q.children.findIndex((c) => c.id === id);
    if (ci === -1) continue;
    const newChildren = [...q.children.slice(0, ci), ...q.children.slice(ci + 1)];
    return items.map((it, i) =>
      i === pi && it.kind === 'pattern' ? { ...it, children: newChildren } : it
    );
  }
  return null;
}

function updatePattern(
  items: QueueItem[],
  patternId: string,
  fn: (children: MacroQueueItem[]) => MacroQueueItem[]
): QueueItem[] {
  return items.map((q) =>
    q.kind === 'pattern' && q.id === patternId ? { ...q, children: fn(q.children) } : q
  );
}

function insertMacroAtPatternEnd(
  items: QueueItem[],
  patternId: string,
  macro: MacroQueueItem
): QueueItem[] | null {
  let ok = false;
  const next = items.map((q) => {
    if (q.kind === 'pattern' && q.id === patternId) {
      ok = true;
      return { ...q, children: [...q.children, macro] };
    }
    return q;
  });
  return ok ? next : null;
}

/**
 * Nested pattern block: phases in sequence for all pattern positions (post step runs them that way).
 * UI: order of macros in the block = phase order.
 */
export function applyQueueDragEnd(
  items: QueueItem[],
  activeId: string,
  overId: string
): QueueItem[] | null {
  if (activeId === overId) return null;

  if (overId === ROOT_QUEUE_TAIL_DROP_ID) {
    const activeItem = findQueueItem(items, activeId);
    if (!activeItem) return null;
    const without = removeItem(items, activeId);
    if (!without) return null;
    return [...without, activeItem];
  }

  if (overId.startsWith(PATTERN_DROP_PREFIX)) {
    const patternId = overId.slice(PATTERN_DROP_PREFIX.length);
    const activeItem = findQueueItem(items, activeId);
    if (!activeItem || activeItem.kind === 'pattern') return null;
    if (isUserSubroutineMacroId(activeItem.macroTypeId)) return null;
    const without = removeItem(items, activeId);
    if (!without) return null;
    return insertMacroAtPatternEnd(without, patternId, activeItem);
  }

  const activeContainer = getContainer(items, activeId);
  const overContainer = getContainer(items, overId);
  if (!activeContainer || !overContainer) return null;

  const sameRoot =
    activeContainer.type === 'root' &&
    overContainer.type === 'root';
  const samePattern =
    activeContainer.type === 'pattern' &&
    overContainer.type === 'pattern' &&
    activeContainer.patternId === overContainer.patternId;

  if (sameRoot || samePattern) {
    if (sameRoot) {
      const oldIndex = items.findIndex((q) => q.id === activeId);
      const newIndex = items.findIndex((q) => q.id === overId);
      if (oldIndex === -1 || newIndex === -1) return null;
      if (oldIndex === newIndex) return null;
      return arrayMove(items, oldIndex, newIndex);
    }
    const pid = activeContainer.patternId;
    const p = items.find((q) => q.kind === 'pattern' && q.id === pid);
    if (!p || p.kind !== 'pattern') return null;
    const oldIndex = p.children.findIndex((c) => c.id === activeId);
    const newIndex = p.children.findIndex((c) => c.id === overId);
    if (oldIndex === -1 || newIndex === -1) return null;
    if (oldIndex === newIndex) return null;
    return updatePattern(items, pid, (ch) => arrayMove(ch, oldIndex, newIndex));
  }

  const activeItem = findQueueItem(items, activeId);
  if (!activeItem) return null;

  if (activeItem.kind === 'pattern' && overContainer.type === 'pattern') {
    return null;
  }

  if (activeItem.kind === 'macro') {
    const without = removeItem(items, activeId);
    if (!without) return null;
    if (overContainer.type === 'root') {
      const overIdx = without.findIndex((q) => q.id === overId);
      if (overIdx === -1) return null;
      const arr = [...without];
      arr.splice(overIdx, 0, activeItem);
      return arr;
    }
    if (isUserSubroutineMacroId(activeItem.macroTypeId)) return null;
    const pid = overContainer.patternId;
    const p = without.find((q) => q.kind === 'pattern' && q.id === pid);
    if (!p || p.kind !== 'pattern') return null;
    const cidx = p.children.findIndex((c) => c.id === overId);
    if (cidx === -1) return null;
    const newChildren = [
      ...p.children.slice(0, cidx),
      activeItem,
      ...p.children.slice(cidx),
    ];
    return without.map((q) =>
      q.kind === 'pattern' && q.id === pid ? { ...q, children: newChildren } : q
    );
  }

  const without = removeItem(items, activeId);
  if (!without) return null;
  const overIdx = without.findIndex((q) => q.id === overId);
  if (overIdx === -1) return null;
  const arr = [...without];
  arr.splice(overIdx, 0, activeItem);
  return arr;
}
