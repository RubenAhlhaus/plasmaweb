import type { Modifier } from '@dnd-kit/core';

/**
 * Center preview under cursor — grip is on the left, otherwise overlay feels “too far right”.
 */
export const centerDragOverlayOnCursor: Modifier = ({ transform, draggingNodeRect }) => {
  if (!draggingNodeRect) return transform;
  return {
    ...transform,
    scaleX: 1,
    scaleY: 1,
    x: transform.x - draggingNodeRect.width / 2,
    y: transform.y - draggingNodeRect.height / 2,
  };
};
