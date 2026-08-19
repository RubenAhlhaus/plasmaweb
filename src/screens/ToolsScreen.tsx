import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../components/ui/card';
import type { Tool } from '../types/tools';
import { ToolsTable } from '../components/tools/ToolsTable';
import { ToolDetailsSidebar } from '../components/tools/ToolDetailsSidebar';
import { ToolEditDialog } from '../components/tools/ToolEditDialog';
import { useActiveTool } from '@/hooks/useActiveTool';
import { useToolsFromBackend } from '@/hooks/useToolsFromBackend';
import {
  splitPanelMainClassName,
  splitPanelRowClassName,
  splitPanelSideToolsClassName,
} from '@/lib/splitPanelLayoutClasses';

export function ToolsScreen() {
  const { t } = useTranslation('tools');
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [createToolOpen, setCreateToolOpen] = useState(false);
  const hasInitializedSelection = useRef(false);
  const firstRowRef = useRef<HTMLButtonElement | null>(null);
  const { tools } = useToolsFromBackend();

  const occupiedToolNumbers = useMemo(
    () =>
      tools
        .map((t) => t.toolNumber)
        .filter((n): n is number => n != null && n > 0),
    [tools],
  );

  const suggestedToolNumber = useMemo(() => {
    if (occupiedToolNumbers.length === 0) return 1;
    return Math.max(...occupiedToolNumbers) + 1;
  }, [occupiedToolNumbers]);

  const handleSelectTool = (toolId: string) => {
    setSelectedToolId(toolId);
  };

  const selectedTool: Tool | undefined =
    selectedToolId != null ? tools.find((t) => t.id === selectedToolId) : undefined;

  const { activeTool } = useActiveTool(tools);

  /** Clear selection when the chosen row is no longer in the list (e.g. after delete). */
  useEffect(() => {
    if (selectedToolId == null) return;
    if (tools.some((t) => t.id === selectedToolId)) return;
    setSelectedToolId(tools[0]?.id ?? null);
  }, [tools, selectedToolId]);

  // On first open, select the currently active tool if any, else the first tool.
  // Do not auto-update after that so the user's choice does not jump when switching screens.
  useEffect(() => {
    if (hasInitializedSelection.current) {
      return;
    }

    if (activeTool?.id) {
      setSelectedToolId(activeTool.id);
      hasInitializedSelection.current = true;
    } else if (tools[0]?.id) {
      setSelectedToolId(tools[0].id);
      hasInitializedSelection.current = true;
    }
  }, [activeTool, tools]);

  // Once a row is selected and rendered, focus it so arrow keys navigate immediately.
  useEffect(() => {
    if (firstRowRef.current) {
      firstRowRef.current.focus();
    }
  }, [selectedToolId]);

  return (
    <div className="h-full w-full flex flex-col">
      <Card className={`h-full w-full px-4 py-4 ${splitPanelRowClassName}`}>
        <div className={splitPanelMainClassName}>
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">{t('toolsScreen.title')}</h2>
              <p className="text-sm text-muted-foreground">{t('toolsScreen.intro')}</p>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <ToolsTable
              tools={tools}
              selectedToolId={selectedToolId}
              activeToolId={activeTool?.id ?? null}
              onSelectTool={handleSelectTool}
              firstRowRef={firstRowRef}
              onAddTool={() => setCreateToolOpen(true)}
            />
          </div>
        </div>

        <div className={splitPanelSideToolsClassName}>
          <ToolDetailsSidebar
            tool={selectedTool}
            selectedToolIsActiveInSpindle={
              selectedTool != null && activeTool != null && selectedTool.id === activeTool.id
            }
            occupiedToolNumbers={occupiedToolNumbers}
            onSuccessfulToolNumberChange={setSelectedToolId}
          />
        </div>
      </Card>

      <ToolEditDialog
        open={createToolOpen}
        onOpenChange={setCreateToolOpen}
        tool={null}
        mode="create"
        occupiedToolNumbers={occupiedToolNumbers}
        suggestedToolNumber={suggestedToolNumber}
      />
    </div>
  );
}

