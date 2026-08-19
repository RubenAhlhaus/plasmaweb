import {
  closestCorners,
  pointerWithin,
  type CollisionDetection,
} from '@dnd-kit/core';
import {
  itemParentPatternId,
  PATTERN_DROP_PREFIX,
  ROOT_QUEUE_TAIL_DROP_ID,
} from '@/lib/macroQueueDrag';
import type { QueueItem } from '@/types/macros';

function isPhaseRowId(items: QueueItem[], id: string): boolean {
  for (const q of items) {
    if (q.kind === 'pattern' && q.children.some((c) => c.id === id)) {
      return true;
    }
  }
  return false;
}

/**
 * Stabilize DnD between root list and nested pattern block:
 * - `pattern-drop-*` only on the **inner** phase area → top of block: sortable id = insert **before** sibling.
 * - Phase rows win when pointer is over a phase.
 */
export function createMacroQueueCollision(items: QueueItem[]): CollisionDetection {
  return (args) => {
    const activeId = String(args.active.id);

    const draggedFromPattern = itemParentPatternId(items, activeId);
    if (draggedFromPattern !== null) {
      const pointer = pointerWithin(args);
      const tailHit = pointer.find((c) => String(c.id) === ROOT_QUEUE_TAIL_DROP_ID);
      if (tailHit) {
        return [tailHit];
      }
      return closestCorners(args);
    }

    const pointer = pointerWithin(args);
    if (pointer.length > 0) {
      const tailHitAll = pointer.find((c) => String(c.id) === ROOT_QUEUE_TAIL_DROP_ID);
      const activeAtRoot = items.some((q) => q.id === activeId);
      if (tailHitAll && activeAtRoot) {
        return [tailHitAll];
      }

      const dropZones = pointer.filter((c) => String(c.id).startsWith(PATTERN_DROP_PREFIX));
      const rows = pointer.filter((c) => !String(c.id).startsWith(PATTERN_DROP_PREFIX));

      const phaseHits = rows.filter((c) => isPhaseRowId(items, String(c.id)));
      if (phaseHits.length > 0) {
        return closestCorners(args);
      }

      if (dropZones.length > 0) {
        return [dropZones[dropZones.length - 1]];
      }

      if (rows.length > 1) {
        return closestCorners(args);
      }
      if (rows.length === 1) {
        return [rows[0]];
      }

      return [pointer[0]];
    }

    return closestCorners(args);
  };
}
