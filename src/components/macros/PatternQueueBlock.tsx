import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FolderOpen, GripVertical, ListPlus } from 'lucide-react';
import { ProgramQueueMacroRow } from '@/components/macros/ProgramQueueMacroRow';
import {
  ProgramQueueRootInsertSlot,
  type ProgramQueueRootInsertSlotVariant,
} from '@/components/macros/ProgramQueueRootInsertSlot';
import { patternDropId } from '@/lib/macroQueueDrag';
import type { PatternQueueItem } from '@/types/macros';
import type { Tool } from '@/types/tools';
import { cn } from '@/lib/utils';

type PatternQueueBlockProps = {
  item: PatternQueueItem;
  tools: Tool[];
  /** Short name from params.name etc. */
  label: string;
  isAddTarget: boolean;
  onEditPattern: () => void;
  onEditChild: (childIndex: number) => void;
  onRequestAddIntoPattern: () => void;
  showRootInsertPreviewAbove?: boolean;
  rootInsertSlotVariant?: ProgramQueueRootInsertSlotVariant;
};

export function PatternQueueBlock({
  item,
  tools,
  label,
  isAddTarget,
  onEditPattern,
  onEditChild,
  onRequestAddIntoPattern,
  showRootInsertPreviewAbove = false,
  rootInsertSlotVariant = 'shift',
}: PatternQueueBlockProps) {
  const { t } = useTranslation('components');
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  /** Nur Phasen-Bereich: „reinziehen“. Kopfzeile = nur Sortable → Root-Reihenfolge vor dem Block. */
  const { setNodeRef: setDropRef, isOver: isOverPhases } = useDroppable({
    id: patternDropId(item.id),
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const childIds = item.children.map((c) => c.id);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex flex-col',
        isDragging && 'opacity-40 shadow-lg z-10',
        isAddTarget && 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background rounded-lg'
      )}
    >
      <ProgramQueueRootInsertSlot
        show={showRootInsertPreviewAbove}
        variant={rootInsertSlotVariant}
      />
      <div className="rounded-lg border border-border/50 surface overflow-hidden">
        <div
          className={cn(
            'flex items-center gap-2 p-3 cursor-pointer hover:bg-white/10',
            'border-b border-border/40 transition-colors'
          )}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('[data-drag-handle]')) return;
            if ((e.target as HTMLElement).closest('[data-add-into]')) return;
            onEditPattern();
          }}
        >
        <button
          type="button"
          data-drag-handle
          className="touch-none p-1 rounded hover:bg-white/20 cursor-grab active:cursor-grabbing text-muted-foreground shrink-0"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-5 w-5" />
        </button>
        <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{label}</p>
          <p className="text-xs text-muted-foreground leading-snug">{t('patternQueue.description')}</p>
        </div>
        <button
          type="button"
          data-add-into
          className={cn(
            'shrink-0 flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium',
            'border border-border/60 bg-background/40 hover:bg-white/15',
            isAddTarget && 'border-primary bg-primary/15'
          )}
          onClick={(e) => {
            e.stopPropagation();
            onRequestAddIntoPattern();
          }}
        >
          <ListPlus className="h-3.5 w-3.5" />
          {t('patternQueue.addMacroHere')}
        </button>
        </div>

        <div
          ref={setDropRef}
          data-e2e="macros-queue-pattern-phases"
          className={cn(
            'px-2 pb-2 pt-1 pl-4 border-l-2 ml-3 mr-1 min-h-[3rem] rounded-md transition-colors',
            'border-border/40',
            isOverPhases &&
              'border-primary/45 bg-primary/10 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.2)]'
          )}
        >
        <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {item.children.map((child, idx) => (
              <ProgramQueueMacroRow
                key={child.id}
                item={child}
                tools={tools}
                onEdit={() => onEditChild(idx)}
              />
            ))}
          </div>
        </SortableContext>
        {item.children.length === 0 ? (
          <p
            className={cn(
              'text-xs py-3 px-1 text-center transition-colors',
              isOverPhases ? 'text-foreground/90' : 'text-muted-foreground'
            )}
          >
            {t('patternQueue.emptyPhases')}
          </p>
        ) : null}
        </div>
      </div>
    </div>
  );
}
