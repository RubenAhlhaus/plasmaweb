import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { PatternQueueBlock } from '@/components/macros/PatternQueueBlock';
import { ProgramQueueDragPreview } from '@/components/macros/ProgramQueueDragPreview';
import { ProgramQueueMacroRow } from '@/components/macros/ProgramQueueMacroRow';
import { ProgramQueueRootTailDrop } from '@/components/macros/ProgramQueueRootTailDrop';
import { ProgramQueueSetupBlock } from '@/components/macros/ProgramQueueSetupBlock';
import { createMacroQueueCollision } from '@/lib/macroQueueCollision';
import {
  itemParentPatternId,
  rootQueueInsertPreviewIndex,
} from '@/lib/macroQueueDrag';
import { reorderQueueItems } from '@/lib/macroQueue/service';
import { patternQueueDisplayLabel } from '@/lib/macroQueueLabel';
import { centerDragOverlayOnCursor } from '@/lib/programQueueDragOverlayModifiers';
import { useToolsFromBackend } from '@/hooks/useToolsFromBackend';
import type { QueueItem } from '@/types/macros';
import type { ProgramQueueRootInsertSlotVariant } from '@/components/macros/ProgramQueueRootInsertSlot';

/**
 * Debounce root insert preview (`shift`) to reduce flicker.
 * Drags **from** a nested pattern block update preview without delay (`overlay`).
 */
const ROOT_INSERT_PREVIEW_DEBOUNCE_MS = 110;

type ProgramQueueProps = {
  items: QueueItem[];
  onReorder: (items: QueueItem[]) => void;
  onEditRoot: (index: number) => void;
  onEditChild: (patternId: string, childIndex: number) => void;
  addMacroTargetPatternId: string | null;
  onRequestAddIntoPattern: (patternId: string) => void;
  /** Short label for “Next macro …” hint */
  addTargetLabel: string | null;
  onClearAddTarget: () => void;
};

export function ProgramQueue({
  items,
  onReorder,
  onEditRoot,
  onEditChild,
  addMacroTargetPatternId,
  onRequestAddIntoPattern,
  addTargetLabel,
  onClearAddTarget,
}: ProgramQueueProps) {
  const { t } = useTranslation('components');
  const { tools } = useToolsFromBackend();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rootInsertPreviewIndex, setRootInsertPreviewIndex] = useState<number | null>(null);
  const insertPreviewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearInsertPreviewDebounce = useCallback(() => {
    if (insertPreviewDebounceRef.current !== null) {
      clearTimeout(insertPreviewDebounceRef.current);
      insertPreviewDebounceRef.current = null;
    }
  }, []);

  useEffect(() => () => clearInsertPreviewDebounce(), [clearInsertPreviewDebounce]);

  const collisionDetection = useMemo(
    () => createMacroQueueCollision(items),
    [items]
  );

  const overlayModifiers = useMemo(() => [centerDragOverlayOnCursor], []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = ({ active }: DragStartEvent) => {
    clearInsertPreviewDebounce();
    setActiveId(String(active.id));
    setRootInsertPreviewIndex(null);
  };

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const aid = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;
      const next = rootQueueInsertPreviewIndex(items, aid, overId);
      clearInsertPreviewDebounce();
      if (itemParentPatternId(items, aid) !== null) {
        setRootInsertPreviewIndex(next);
        return;
      }
      insertPreviewDebounceRef.current = setTimeout(() => {
        insertPreviewDebounceRef.current = null;
        setRootInsertPreviewIndex(next);
      }, ROOT_INSERT_PREVIEW_DEBOUNCE_MS);
    },
    [items, clearInsertPreviewDebounce]
  );

  const handleDragEnd = (event: DragEndEvent) => {
    clearInsertPreviewDebounce();
    setRootInsertPreviewIndex(null);
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const next = reorderQueueItems(items, String(active.id), String(over.id));
    if (next) onReorder(next);
  };

  const handleDragCancel = () => {
    clearInsertPreviewDebounce();
    setRootInsertPreviewIndex(null);
    setActiveId(null);
  };

  const rootIds = items.map((i) => i.id);

  const draggingPhaseOutToRoot =
    activeId !== null && itemParentPatternId(items, activeId) !== null;
  const rootInsertSlotVariant: ProgramQueueRootInsertSlotVariant = draggingPhaseOutToRoot
    ? 'overlay'
    : 'shift';

  return (
    <div className="flex flex-col h-full min-h-0">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">
        {t('programQueue.title')}
      </h3>
      {addTargetLabel ? (
        <p className="text-xs text-muted-foreground mb-2 px-1 leading-snug">
          {t('programQueue.nextMacro')}{' '}
          <span className="text-foreground font-medium">
            {t('programQueue.nextMacroQuoted', { label: addTargetLabel })}
          </span>{' '}
          {t('programQueue.nextMacroPhaseNote')}{' '}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={onClearAddTarget}
          >
            {t('programQueue.clearAddTarget')}
          </button>
        </p>
      ) : null}
      <div className="flex-1 overflow-y-auto overflow-x-hidden pr-1 min-w-0 flex flex-col gap-3 min-h-0">
        <ProgramQueueSetupBlock />
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="flex flex-col gap-3">
            <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 px-2">{t('programQueue.empty')}</p>
              ) : (
                items.map((item, index) =>
                  item.kind === 'pattern' ? (
                    <PatternQueueBlock
                      key={item.id}
                      item={item}
                      tools={tools}
                      label={patternQueueDisplayLabel(item.params)}
                      isAddTarget={addMacroTargetPatternId === item.id}
                      onEditPattern={() => onEditRoot(index)}
                      onEditChild={(ci) => onEditChild(item.id, ci)}
                      onRequestAddIntoPattern={() => onRequestAddIntoPattern(item.id)}
                      showRootInsertPreviewAbove={rootInsertPreviewIndex === index}
                      rootInsertSlotVariant={rootInsertSlotVariant}
                    />
                  ) : (
                    <ProgramQueueMacroRow
                      key={item.id}
                      item={item}
                      tools={tools}
                      onEdit={() => onEditRoot(index)}
                      showRootInsertPreviewAbove={rootInsertPreviewIndex === index}
                      rootInsertSlotVariant={rootInsertSlotVariant}
                    />
                  )
                )
              )}
            </SortableContext>
            {items.length > 0 ? (
              <ProgramQueueRootTailDrop
                showAppendPreview={rootInsertPreviewIndex === items.length}
                insertSlotVariant={rootInsertSlotVariant}
              />
            ) : null}
          </div>
          <DragOverlay
            modifiers={overlayModifiers}
            dropAnimation={null}
            className="max-w-none"
            style={{ cursor: 'grabbing' }}
          >
            {activeId ? (
              <ProgramQueueDragPreview items={items} activeId={activeId} tools={tools} />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
