import { useDroppable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import {
  ProgramQueueRootInsertSlot,
  type ProgramQueueRootInsertSlotVariant,
} from '@/components/macros/ProgramQueueRootInsertSlot';
import { ROOT_QUEUE_TAIL_DROP_ID } from '@/lib/macroQueueDrag';
import { cn } from '@/lib/utils';

type ProgramQueueRootTailDropProps = {
  /** Preview slot when a phase macro should append to list end */
  showAppendPreview?: boolean;
  insertSlotVariant?: ProgramQueueRootInsertSlotVariant;
};

/**
 * Flexible area under the queue: drop here = item at end of root list.
 */
export function ProgramQueueRootTailDrop({
  showAppendPreview = false,
  insertSlotVariant = 'shift',
}: ProgramQueueRootTailDropProps) {
  const { t } = useTranslation('components');
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_QUEUE_TAIL_DROP_ID });

  return (
    <div
      ref={setNodeRef}
      className={cn('relative flex flex-col flex-1 min-h-0 shrink-0')}
      aria-hidden
    >
      <ProgramQueueRootInsertSlot show={showAppendPreview} variant={insertSlotVariant} />
      <div
        data-e2e="macros-queue-tail-drop"
        className={cn(
          'flex-1 min-h-[min(42vh,14rem)] rounded-lg border border-dashed transition-colors',
          'border-border/35 bg-muted/5',
          isOver && 'border-primary/50 bg-primary/10'
        )}
      >
        <p
          className={cn(
            'text-xs text-center pt-4 px-2 pointer-events-none transition-colors',
            isOver ? 'text-foreground/90' : 'text-muted-foreground/90'
          )}
        >
          {t('programQueue.tailDropHint')}
        </p>
      </div>
    </div>
  );
}
