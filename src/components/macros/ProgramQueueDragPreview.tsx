import { useTranslation } from 'react-i18next';
import { FolderOpen, GripVertical } from 'lucide-react';
import { getMacroDefinitionById } from '@/data/macroDefinitions';
import {
  isUserSubroutineMacroId,
  userSubroutineDefinitionFromMacroId,
} from '@/data/userSubroutineMacros';
import { findQueueItem } from '@/lib/macroQueueDrag';
import { patternQueueDisplayLabel } from '@/lib/macroQueueLabel';
import { macroDefinitionSubtitle, macroDefinitionTitle } from '@/lib/macroDefinitionLabels';
import type { QueueItem } from '@/types/macros';
import type { Tool } from '@/types/tools';
import { cn } from '@/lib/utils';

function toolLabelFromParams(
  params: Record<string, string | number | boolean>,
  tools: Tool[]
): string {
  const toolId = typeof params.toolId === 'string' ? params.toolId : undefined;
  if (toolId) {
    const n = tools.find((t) => t.id === toolId)?.toolNumber;
    if (n != null && n > 0) return `T${n}`;
  }
  const legacy = params.tool;
  if (typeof legacy === 'number' && legacy > 0) return `T${legacy}`;
  return '?';
}

type ProgramQueueDragPreviewProps = {
  items: QueueItem[];
  activeId: string;
  tools: Tool[];
};

/** Statische Vorschau im DragOverlay — kein useSortable, damit Messungen stabil bleiben. */
export function ProgramQueueDragPreview({ items, activeId, tools }: ProgramQueueDragPreviewProps) {
  const { t } = useTranslation('macros');
  const item = findQueueItem(items, activeId);
  if (!item) return null;

  if (item.kind === 'pattern') {
    const label = patternQueueDisplayLabel(item.params);
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border border-border/80 bg-background/95 shadow-xl',
          'p-3 cursor-grabbing shrink-0',
          'w-[min(100vw-1.5rem,18rem)] min-w-[16rem] max-w-[18rem] box-border'
        )}
      >
        <GripVertical className="h-5 w-5 shrink-0 text-muted-foreground" />
        <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium truncate">{label}</span>
      </div>
    );
  }

  const definition =
    getMacroDefinitionById(item.macroTypeId) ??
    userSubroutineDefinitionFromMacroId(item.macroTypeId);
  const text = definition
    ? isUserSubroutineMacroId(item.macroTypeId)
      ? macroDefinitionTitle(definition, t)
      : `${macroDefinitionSubtitle(definition, t)} (${toolLabelFromParams(item.params, tools)})`
    : item.macroTypeId;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border/80 bg-background/95 shadow-xl',
        'p-3 cursor-grabbing shrink-0',
        'w-[min(100vw-1.5rem,18rem)] min-w-[16rem] max-w-[18rem] box-border'
      )}
    >
      <GripVertical className="h-5 w-5 shrink-0 text-muted-foreground" />
      <span className="text-sm font-medium truncate">{text}</span>
    </div>
  );
}
