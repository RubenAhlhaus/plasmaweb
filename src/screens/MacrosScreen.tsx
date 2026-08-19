import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MacroCategorySection } from '@/components/macros/MacroCategorySection';
import { MacroParamDialog } from '@/components/macros/MacroParamDialog';
import { ProgramQueue } from '@/components/macros/ProgramQueue';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { TouchNumericDialogFooter } from '@/components/numeric';
import { useSendCommand } from '@/api/backendCommands';
import { useActiveTool } from '@/hooks/useActiveTool';
import { useMacroQueueProgramGeneration } from '@/hooks/useMacroQueueProgramGeneration';
import { useToolsFromBackend } from '@/hooks/useToolsFromBackend';
import {
  NESTED_QUEUE_BLOCK_MACRO_ID,
  MACRO_CATEGORIES,
  getDefinitionsByCategory,
  getMacroDefinitionById,
} from '@/data/macroDefinitions';
import { eventBus } from '@/eventBus';
import { createQueueItemId } from '@/lib/idFactory';
import { patternQueueDisplayLabel } from '@/lib/macroQueueLabel';
import { macroDefinitionTitle } from '@/lib/macroDefinitionLabels';
import {
  isUserSubroutineMacroId,
  userSubroutineDefinitionFromMacroId,
  userSubroutineDefinitionFromInfo,
  userSubroutineNameFromMacroId,
} from '@/data/userSubroutineMacros';
import {
  addMacroToPatternEnd,
  addRootItem,
  createMacroQueueItem,
  createPatternQueueItem,
  removeQueueItem,
  updateQueueItemParams,
} from '@/lib/macroQueue/service';
import { patternHeightDefaultsFromParams } from '@/lib/macroGcode/patternHeightDefaults';
import { useAppStore } from '@/store';
import { Button } from '@/components/ui/button';
import {
  splitPanelMainClassName,
  splitPanelRowClassName,
  splitPanelSideMacrosClassName,
} from '@/lib/splitPanelLayoutClasses';
import type { MacroDefinition, MacroParams, MacroQueueItem, QueueItem } from '@/types/macros';

type AddMacroTarget = { type: 'root' } | { type: 'pattern'; patternId: string };

type EditTarget =
  | { scope: 'root'; index: number }
  | { scope: 'child'; patternId: string; index: number };

/** Which edit shell is open (param form vs machine-macro info). */
type EditDialogKind = 'param' | 'userInfo';

function resolveDefinitionForQueueItem(
  macroTypeId: string,
  userMacros: Array<{ name: string; fileName: string; path?: string }>,
): MacroDefinition | undefined {
  const builtin = getMacroDefinitionById(macroTypeId);
  if (builtin) return builtin;
  const name = userSubroutineNameFromMacroId(macroTypeId);
  if (!name) return undefined;
  const info = userMacros.find((m) => m.name === name);
  if (info) return userSubroutineDefinitionFromInfo(info);
  return userSubroutineDefinitionFromMacroId(macroTypeId);
}

export function MacrosScreen() {
  const { t } = useTranslation('macros');
  const sendCommand = useSendCommand();
  const { tools } = useToolsFromBackend();
  const { activeTool } = useActiveTool(tools);
  const { macroProgramBusy } = useMacroQueueProgramGeneration(tools);
  const queue = useAppStore((s) => s.macroQueueItems);
  const setMacroQueueItems = useAppStore((s) => s.setMacroQueueItems);
  const userMacros = useAppStore((s) => s.iniRuntimeConfig.user_macros ?? []);
  const [addMacroTarget, setAddMacroTarget] = useState<AddMacroTarget>({ type: 'root' });
  const [editDialogKind, setEditDialogKind] = useState<EditDialogKind | null>(null);
  const [dialogDefinition, setDialogDefinition] = useState<MacroDefinition | null>(null);
  const [dialogInitialParams, setDialogInitialParams] = useState<MacroParams | null>(null);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const machineDefinitions = useMemo(
    () => userMacros.map((m) => userSubroutineDefinitionFromInfo(m)),
    [userMacros],
  );

  // Refresh INI user macros when opening the screen (new .ngc / [MACROS] edits).
  useEffect(() => {
    sendCommand('machine', 'get_ini_config');
  }, [sendCommand]);

  useEffect(() => {
    if (editDialogKind === null) setDeleteConfirmOpen(false);
  }, [editDialogKind]);

  const closeEditDialog = useCallback(() => {
    setEditDialogKind(null);
    setDialogDefinition(null);
    setDialogInitialParams(null);
    setEditTarget(null);
  }, []);

  const deleteConfirmMessage = useMemo(() => {
    if (!editTarget) return '';
    if (editTarget.scope === 'child') {
      return t('screen.deleteChild');
    }
    const item = queue[editTarget.index];
    if (item?.kind === 'pattern') {
      return t('screen.deletePattern');
    }
    return t('screen.deleteRoot');
  }, [editTarget, queue, t]);

  const addTargetLabel = useMemo(() => {
    if (addMacroTarget.type !== 'pattern') return null;
    const p = queue.find((q) => q.kind === 'pattern' && q.id === addMacroTarget.patternId);
    if (!p || p.kind !== 'pattern') return null;
    return patternQueueDisplayLabel(p.params);
  }, [addMacroTarget, queue]);

  const addMacroToQueue = useCallback(
    (definition: MacroDefinition, params: MacroParams) => {
      // Machine macros ([MACROS]) are root-only — never phases inside a pattern.
      if (isUserSubroutineMacroId(definition.id)) {
        const macro: MacroQueueItem = createMacroQueueItem(
          createQueueItemId(),
          definition.id,
          params,
        );
        setMacroQueueItems((prev) => addRootItem(prev, macro));
        setAddMacroTarget({ type: 'root' });
        return;
      }
      if (definition.id === NESTED_QUEUE_BLOCK_MACRO_ID) {
        const pattern: QueueItem = createPatternQueueItem(createQueueItemId(), params);
        setMacroQueueItems((prev) => addRootItem(prev, pattern));
        return;
      }
      if (addMacroTarget.type === 'pattern') {
        const macro: MacroQueueItem = createMacroQueueItem(
          createQueueItemId(),
          definition.id,
          params,
        );
        setMacroQueueItems((prev) => addMacroToPatternEnd(prev, addMacroTarget.patternId, macro));
        return;
      }
      const macro: MacroQueueItem = createMacroQueueItem(
        createQueueItemId(),
        definition.id,
        params,
      );
      setMacroQueueItems((prev) => addRootItem(prev, macro));
    },
    [addMacroTarget, setMacroQueueItems],
  );

  const openAddDialog = useCallback(
    (definition: MacroDefinition) => {
      if (isUserSubroutineMacroId(definition.id)) {
        addMacroToQueue(definition, { ...definition.defaultParams });
        return;
      }
      setDialogDefinition(definition);
      setDialogInitialParams(null);
      setDialogMode('add');
      setEditTarget(null);
      setEditDialogKind('param');
    },
    [addMacroToQueue],
  );

  const openEditRoot = useCallback(
    (index: number) => {
      const item = queue[index];
      if (!item) return;
      if (item.kind === 'pattern') {
        const def = getMacroDefinitionById(NESTED_QUEUE_BLOCK_MACRO_ID);
        if (!def) return;
        setDialogDefinition(def);
        setDialogInitialParams(item.params);
        setDialogMode('edit');
        setEditTarget({ scope: 'root', index });
        setEditDialogKind('param');
        return;
      }
      if (isUserSubroutineMacroId(item.macroTypeId)) {
        const def = resolveDefinitionForQueueItem(item.macroTypeId, userMacros);
        if (!def) return;
        setDialogDefinition(def);
        setDialogMode('edit');
        setEditTarget({ scope: 'root', index });
        setEditDialogKind('userInfo');
        return;
      }
      const def = getMacroDefinitionById(item.macroTypeId);
      if (!def) return;
      setDialogDefinition(def);
      setDialogInitialParams(item.params);
      setDialogMode('edit');
      setEditTarget({ scope: 'root', index });
      setEditDialogKind('param');
    },
    [queue, userMacros],
  );

  const openEditChild = useCallback(
    (patternId: string, childIndex: number) => {
      const p = queue.find((q) => q.kind === 'pattern' && q.id === patternId);
      if (!p || p.kind !== 'pattern') return;
      const child = p.children[childIndex];
      if (!child) return;
      // Legacy: user macros should not be nested; still allow delete via info dialog.
      if (isUserSubroutineMacroId(child.macroTypeId)) {
        const def = resolveDefinitionForQueueItem(child.macroTypeId, userMacros);
        if (!def) return;
        setDialogDefinition(def);
        setDialogMode('edit');
        setEditTarget({ scope: 'child', patternId, index: childIndex });
        setEditDialogKind('userInfo');
        return;
      }
      const def = getMacroDefinitionById(child.macroTypeId);
      if (!def) return;
      setDialogDefinition(def);
      setDialogInitialParams(child.params);
      setDialogMode('edit');
      setEditTarget({ scope: 'child', patternId, index: childIndex });
      setEditDialogKind('param');
    },
    [queue, userMacros],
  );

  const handleDialogConfirm = useCallback(
    (params: MacroParams) => {
      if (!dialogDefinition) return;

      if (dialogMode === 'add') {
        addMacroToQueue(dialogDefinition, params);
      } else if (dialogMode === 'edit' && editTarget) {
        setMacroQueueItems((prev) => updateQueueItemParams(prev, editTarget, params));
      }
      closeEditDialog();
    },
    [dialogDefinition, dialogMode, editTarget, addMacroToQueue, setMacroQueueItems, closeEditDialog],
  );

  const handleConfirmDeleteFromQueue = useCallback(() => {
    if (dialogMode !== 'edit' || !editTarget) return;
    setMacroQueueItems((prev) => removeQueueItem(prev, editTarget));
    setDeleteConfirmOpen(false);
    closeEditDialog();
  }, [dialogMode, editTarget, setMacroQueueItems, closeEditDialog]);

  const handleReorder = useCallback(
    (newOrder: QueueItem[]) => {
      setMacroQueueItems(newOrder);
    },
    [setMacroQueueItems],
  );

  const xyProvidedByPattern =
    (dialogMode === 'add' && addMacroTarget.type === 'pattern') ||
    (dialogMode === 'edit' && editTarget?.scope === 'child');

  const patternHeightDefaults = useMemo(() => {
    if (dialogMode !== 'add' || addMacroTarget.type !== 'pattern') return null;
    const block = queue.find((q) => q.kind === 'pattern' && q.id === addMacroTarget.patternId);
    if (!block || block.kind !== 'pattern') return null;
    return patternHeightDefaultsFromParams(block.params);
  }, [dialogMode, addMacroTarget, queue]);

  return (
    <div className={splitPanelRowClassName}>
      <div className={`scrollbar-left-custom overflow-y-auto pl-3 pr-2 ${splitPanelMainClassName} lg:flex-[3]`}>
        <div className="space-y-6">
          {MACRO_CATEGORIES.map((category) => {
            const definitions = getDefinitionsByCategory(category);
            if (definitions.length === 0) return null;
            return (
              <MacroCategorySection
                key={category}
                category={category}
                definitions={definitions}
                onTileClick={openAddDialog}
              />
            );
          })}
          {machineDefinitions.length > 0 ? (
            <MacroCategorySection
              category="machine"
              definitions={machineDefinitions}
              onTileClick={openAddDialog}
            />
          ) : null}
        </div>
      </div>

      <div className={splitPanelSideMacrosClassName}>
        <div className="flex-1 min-h-0 min-w-0 flex flex-col">
          <ProgramQueue
            items={queue}
            onReorder={handleReorder}
            onEditRoot={openEditRoot}
            onEditChild={openEditChild}
            addMacroTargetPatternId={
              addMacroTarget.type === 'pattern' ? addMacroTarget.patternId : null
            }
            onRequestAddIntoPattern={(patternId) =>
              setAddMacroTarget({ type: 'pattern', patternId })
            }
            addTargetLabel={addTargetLabel}
            onClearAddTarget={() => setAddMacroTarget({ type: 'root' })}
          />
        </div>
        {queue.length > 0 ? (
          <Button
            type="button"
            data-e2e="macros-generate-program-code"
            disabled={macroProgramBusy}
            className="mt-3 h-20 shrink-0 w-full text-base bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500 disabled:opacity-60"
            onClick={() => eventBus.publish('ui.macros.generateProgram', { source: 'macrosScreen' })}
          >
            {macroProgramBusy ? t('screen.generating') : t('screen.goToProgram')}
          </Button>
        ) : null}
      </div>

      <MacroParamDialog
        open={editDialogKind === 'param'}
        onOpenChange={(open) => {
          if (!open) closeEditDialog();
        }}
        definition={dialogDefinition}
        initialParams={dialogInitialParams}
        mode={dialogMode}
        onConfirm={handleDialogConfirm}
        onRequestDelete={
          dialogMode === 'edit' ? () => setDeleteConfirmOpen(true) : undefined
        }
        tools={tools}
        activeToolId={activeTool?.id ?? null}
        xyProvidedByPattern={xyProvidedByPattern}
        patternHeightDefaults={patternHeightDefaults}
      />

      <Dialog
        open={editDialogKind === 'userInfo' && dialogDefinition != null}
        onOpenChange={(o) => {
          if (!o) closeEditDialog();
        }}
      >
        <DialogContent
          title={dialogDefinition ? macroDefinitionTitle(dialogDefinition, t) : ''}
          className="max-w-md"
        >
          <p className="text-sm text-muted-foreground">{t('screen.userMacroNoParams')}</p>
          <TouchNumericDialogFooter
            onCancel={closeEditDialog}
            onConfirm={() => setDeleteConfirmOpen(true)}
            cancelLabel={t('dialog.cancel')}
            confirmLabel={t('dialog.delete')}
            confirmVariant="destructive"
            cancelDataE2e="macros-user-macro-info-close"
            confirmDataE2e="macros-user-macro-info-delete"
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteConfirmOpen && editTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteConfirmOpen(false);
        }}
      >
        <DialogContent
          title={t('screen.deleteTitle')}
          className="max-w-md"
          overlayClassName="z-[60]"
        >
          <p className="text-sm text-muted-foreground">{deleteConfirmMessage}</p>
          <TouchNumericDialogFooter
            onCancel={() => setDeleteConfirmOpen(false)}
            onConfirm={handleConfirmDeleteFromQueue}
            cancelLabel={t('dialog.cancel')}
            confirmLabel={t('dialog.delete')}
            confirmVariant="destructive"
            cancelDataE2e="macros-delete-confirm-cancel"
            confirmDataE2e="macros-delete-confirm-confirm"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
