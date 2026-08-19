import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import {
  ProgramQueueRootInsertSlot,
  type ProgramQueueRootInsertSlotVariant,
} from '@/components/macros/ProgramQueueRootInsertSlot';
import { getMacroDefinitionById } from '@/data/macroDefinitions';
import {
  isUserSubroutineMacroId,
  userSubroutineDefinitionFromMacroId,
} from '@/data/userSubroutineMacros';
import { macroDefinitionSubtitle, macroDefinitionTitle } from '@/lib/macroDefinitionLabels';
import type { MacroQueueItem } from '@/types/macros';
import type { Tool } from '@/types/tools';
import { cn } from '@/lib/utils';

type ProgramQueueMacroRowProps = {
  item: MacroQueueItem;
  tools: Tool[];
  onEdit: () => void;
  /** Root list only: placeholder when a phase macro would insert above here */
  showRootInsertPreviewAbove?: boolean;
  rootInsertSlotVariant?: ProgramQueueRootInsertSlotVariant;
};

function toolLabelFromParams(params: MacroQueueItem['params'], tools: Tool[]): string {
  const toolId = typeof params.toolId === 'string' ? params.toolId : undefined;
  if (toolId) {
    const n = tools.find((t) => t.id === toolId)?.toolNumber;
    if (n != null && n > 0) return `T${n}`;
  }
  const legacy = params.tool;
  if (typeof legacy === 'number' && legacy > 0) return `T${legacy}`;
  return '?';
}

export function ProgramQueueMacroRow({
  item,
  tools,
  onEdit,
  showRootInsertPreviewAbove = false,
  rootInsertSlotVariant = 'shift',
}: ProgramQueueMacroRowProps) {
  const { t } = useTranslation('macros');
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const definition =
    getMacroDefinitionById(item.macroTypeId) ??
    userSubroutineDefinitionFromMacroId(item.macroTypeId);
  const label = definition
    ? isUserSubroutineMacroId(item.macroTypeId)
      ? macroDefinitionTitle(definition, t)
      : `${macroDefinitionSubtitle(definition, t)} (${toolLabelFromParams(item.params, tools)})`
    : item.macroTypeId;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('flex flex-col', isDragging && 'opacity-[0.35] shadow-lg z-10')}
    >
      <ProgramQueueRootInsertSlot
        show={showRootInsertPreviewAbove}
        variant={rootInsertSlotVariant}
      />
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border border-border/50 surface p-3 cursor-pointer',
          'hover:bg-white/20 transition-colors'
        )}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('[data-drag-handle]')) return;
          onEdit();
        }}
      >
        <button
          type="button"
          data-drag-handle
          className="touch-none p-1 rounded hover:bg-white/20 cursor-grab active:cursor-grabbing text-muted-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-5 w-5" />
        </button>
        <span className="text-sm font-medium text-foreground flex-1 truncate">{label}</span>
      </div>
    </div>
  );
}
