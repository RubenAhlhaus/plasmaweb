import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, HardDrive, Play, RefreshCw, Save, SaveAll } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/store';
import type { LinuxCncStatusRoot } from '@/store/types';
import { isProgramFileExecuting } from '@/lib/programFileExecuting';
import { AppTooltip } from '@/components/AppTooltip';
import { MachinePreviewColumn } from '@/components/MachinePreviewColumn';
import { ProgramEditor } from '@/components/ProgramEditor';
import { ProgramFileBrowserDialog } from '@/components/ProgramFileBrowserDialog';
import {
  TouchNumericDialogFooter,
  TouchNumericEntry,
  touchNumericDialogContentClassName,
} from '@/components/numeric';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { generateCommandId, useSendCommand } from '@/api/backendCommands';
import { useActiveTool } from '@/hooks/useActiveTool';
import {
  usePendingWsCommandResultMap,
  usePendingWsCommandResults,
} from '@/hooks/usePendingWsCommandResult';
import { useSpindleFeedSlidersFromStatus } from '@/hooks/useSpindleFeedSlidersFromStatus';
import { useToolsFromBackend } from '@/hooks/useToolsFromBackend';
import { COMMAND_RESPONSE_FALLBACK_MS } from '@/lib/commandFallbackMs';
import { trySubmitDialogFormOnEnter } from '@/lib/dialogFormSubmit';
import { editorLineToStartLine, startLineToEditorLine1Based } from '@/lib/editorLineToStartLine';
import { parsePositiveIntFromNumericExpression } from '@/lib/evaluateNumericExpression';
import {
  buildProgramReadParams,
  hasPathForProgramRead,
  programReadRequestKey,
} from '@/lib/programReadPath';
import { machinePreviewColumnStackedClassName, machinePreviewGridClassName } from '@/lib/machineScreenLayoutClasses';
import { cn } from '@/lib/utils';

/** How long the Save / Save-as button keeps its success style after a successful `program.write`. */
const SAVE_SUCCESS_FEEDBACK_MS = 2000;

type SaveSuccessTarget = 'save' | 'saveAs';

const saveSuccessButtonClassName =
  'border-emerald-500/50 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/20';

export function ProgramScreen() {
  const { t } = useTranslation(['program', 'components']);
  const { tools } = useToolsFromBackend();
  const [runFromLineDialogOpen, setRunFromLineDialogOpen] = useState(false);
  const [runFromLineSyncKey, setRunFromLineSyncKey] = useState(0);

  const {
    content: programContent,
    filePath,
    currentLineIndex,
    runFromLineInput,
    pendingAutoRunStartLine,
    openError: programOpenError,
    writeError: programWriteError,
  } = useAppStore(
    useShallow((s) => ({
      content: s.programEditor.content,
      filePath: s.programEditor.filePath,
      currentLineIndex: s.programEditor.currentLineIndex,
      runFromLineInput: s.programEditor.runFromLineInput,
      pendingAutoRunStartLine: s.programEditor.pendingAutoRunStartLine,
      openError: s.programEditor.openError,
      writeError: s.programEditor.writeError,
    })),
  );
  const setProgramEditor = useAppStore((s) => s.setProgramEditor);

  const { programFile, programFileExecuting } = useAppStore(
    useShallow((state) => {
      const statusSlice = {
        machine: { task_mode: state.linuxCncStatus.machine?.task_mode },
        program: { interp_state: state.linuxCncStatus.program?.interp_state },
      } as LinuxCncStatusRoot;
      return {
        programFile: state.linuxCncStatus.program?.file,
        programFileExecuting: isProgramFileExecuting(statusSlice),
      };
    }),
  );
  const connectionStatus = useAppStore((state) => state.connectionStatus);
  const showVirtualSidebar = useAppStore((state) => state.showVirtualSidebar);
  const sendCommand = useSendCommand();

  const [browserLoadOpen, setBrowserLoadOpen] = useState(false);
  const [browserSaveAsOpen, setBrowserSaveAsOpen] = useState(false);
  const [saveSuccessTarget, setSaveSuccessTarget] = useState<SaveSuccessTarget | null>(null);
  const pendingProgramOpenIdsRef = useRef<Set<string>>(new Set());
  const pendingProgramWriteIdsRef = useRef<Set<string>>(new Set());
  /** Which action started the in-flight `program.write` (for success styling on the right button). */
  const pendingWriteKindRef = useRef<SaveSuccessTarget | null>(null);
  /** Content sent with the in-flight write (skip success UI if the editor changed meanwhile). */
  const pendingWriteContentRef = useRef<string | null>(null);
  const saveSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Editor content snapshot when success feedback was shown; used to clear on further edits. */
  const saveSuccessContentRef = useRef<string | null>(null);
  /**
   * Pending `program.read` requests (auto after empty editor **or** manual reload button):
   * commandId → requested path.
   */
  const pendingProgramReadIdsRef = useRef<Map<string, string>>(new Map());
  /** Per mount: do not auto-retry failed paths (avoid a loop). */
  const failedProgramAutoReadPathsRef = useRef<Set<string>>(new Set());
  /** Manual reload only: spinner until response (or timeout). */
  const pendingManualProgramReadIdRef = useRef<string | null>(null);
  const programReadFallbackTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const [programReloadBusy, setProgramReloadBusy] = useState(false);

  usePendingWsCommandResults(pendingProgramOpenIdsRef, {
    onResult: (id, r) => {
      pendingProgramOpenIdsRef.current.delete(id);
      if (r.ok) {
        setProgramEditor({ openError: null });
      } else {
        const detail =
          r.error?.message?.trim() ||
          r.error?.code ||
          t('errors.loadFailed');
        setProgramEditor({ openError: detail });
      }
    },
  });

  const clearSaveSuccessFeedback = useCallback(() => {
    if (saveSuccessTimerRef.current != null) {
      clearTimeout(saveSuccessTimerRef.current);
      saveSuccessTimerRef.current = null;
    }
    saveSuccessContentRef.current = null;
    setSaveSuccessTarget(null);
  }, []);

  const showSaveSuccessFeedback = useCallback(
    (target: SaveSuccessTarget, contentAtSave: string) => {
      if (saveSuccessTimerRef.current != null) {
        clearTimeout(saveSuccessTimerRef.current);
      }
      saveSuccessContentRef.current = contentAtSave;
      setSaveSuccessTarget(target);
      saveSuccessTimerRef.current = setTimeout(() => {
        saveSuccessTimerRef.current = null;
        saveSuccessContentRef.current = null;
        setSaveSuccessTarget(null);
      }, SAVE_SUCCESS_FEEDBACK_MS);
    },
    [],
  );

  usePendingWsCommandResults(pendingProgramWriteIdsRef, {
    onResult: (id, r) => {
      pendingProgramWriteIdsRef.current.delete(id);
      const writeKind = pendingWriteKindRef.current;
      const writtenContent = pendingWriteContentRef.current;
      pendingWriteKindRef.current = null;
      pendingWriteContentRef.current = null;
      if (r.ok) {
        setProgramEditor({ writeError: null });
        if (writeKind != null && writtenContent != null && writtenContent === programContent) {
          showSaveSuccessFeedback(writeKind, writtenContent);
        }
      } else {
        clearSaveSuccessFeedback();
        const detail =
          r.error?.message?.trim() ||
          r.error?.code ||
          t('errors.saveFailed');
        setProgramEditor({ writeError: detail });
      }
    },
  });

  useEffect(() => {
    if (saveSuccessContentRef.current == null) return;
    if (programContent !== saveSuccessContentRef.current) {
      clearSaveSuccessFeedback();
    }
  }, [programContent, clearSaveSuccessFeedback]);

  usePendingWsCommandResultMap(pendingProgramReadIdsRef, {
    onResult: (cmdId, path, r) => {
      pendingProgramReadIdsRef.current.delete(cmdId);
      const timer = programReadFallbackTimersRef.current.get(cmdId);
      if (timer) {
        clearTimeout(timer);
        programReadFallbackTimersRef.current.delete(cmdId);
      }
      if (pendingManualProgramReadIdRef.current === cmdId) {
        pendingManualProgramReadIdRef.current = null;
        setProgramReloadBusy(false);
      }
      if (r.ok && r.result && typeof r.result.content === 'string') {
        failedProgramAutoReadPathsRef.current.delete(path);
        const resolved =
          typeof r.result.path === 'string' && r.result.path.length > 0 ? r.result.path : path;
        setProgramEditor({
          content: r.result.content,
          filePath: resolved,
          openError: null,
        });
      } else {
        failedProgramAutoReadPathsRef.current.add(path);
        const detail =
          r.error?.message?.trim() ||
          r.error?.code ||
          t('errors.readFailed');
        setProgramEditor({ openError: detail });
      }
    },
  });

  useEffect(
    () => () => {
      for (const timer of programReadFallbackTimersRef.current.values()) {
        clearTimeout(timer);
      }
      programReadFallbackTimersRef.current.clear();
      if (saveSuccessTimerRef.current != null) {
        clearTimeout(saveSuccessTimerRef.current);
        saveSuccessTimerRef.current = null;
      }
    },
    [],
  );

  const {
    spindleSpeed,
    spindleOverridePercent,
    feedRate,
    feedOverridePercent,
  } = useSpindleFeedSlidersFromStatus();

  const { activeTool } = useActiveTool(tools);

  const statusProgramFile =
    typeof programFile === 'string' && programFile.length > 0 ? programFile : null;

  /** LinuxCNC-canonical path after `program.open`, else `programEditor.filePath` */
  const displayedLoadedPath = statusProgramFile ?? filePath;

  const programReadParams = useMemo(
    () => buildProgramReadParams(filePath, statusProgramFile),
    [filePath, statusProgramFile],
  );

  /**
   * After a full UI reload the store is empty, but LinuxCNC may still report a loaded path —
   * pull content via `program.read`. On sidebar-only navigation `programEditor` stays in the store,
   * so we do not reload again.
   */
  useEffect(() => {
    if (connectionStatus !== 'connected' || programContent.length > 0) return;
    if (!programReadParams) return;
    const readKey = programReadRequestKey(programReadParams);
    if (failedProgramAutoReadPathsRef.current.has(readKey)) return;
    for (const p of pendingProgramReadIdsRef.current.values()) {
      if (p === readKey) return;
    }
    const cmdId = generateCommandId();
    pendingProgramReadIdsRef.current.set(cmdId, readKey);
    sendCommand('program', 'read', programReadParams, cmdId);
  }, [connectionStatus, programContent, programReadParams, sendCommand]);

  const openProgramOnBackend = useCallback(
    (backendPath: string) => {
      if (connectionStatus !== 'connected') {
        setProgramEditor({
          openError: t('errors.noConnectionLinuxcnc'),
        });
        return;
      }
      const cmdId = generateCommandId();
      // Only honor the latest program.open — a late error from an earlier attempt could
      // set the banner even though the current open succeeded.
      pendingProgramOpenIdsRef.current.clear();
      pendingProgramOpenIdsRef.current.add(cmdId);
      setProgramEditor({ openError: null });
      sendCommand('program', 'open', { path: backendPath }, cmdId);
    },
    [connectionStatus, sendCommand, setProgramEditor, t],
  );

  const handleBrowserFileLoaded = useCallback(
    (path: string, content: string) => {
      setProgramEditor({ filePath: path, content });
      openProgramOnBackend(path);
    },
    [openProgramOnBackend, setProgramEditor],
  );

  const handleOpenBrowser = useCallback(() => {
    if (connectionStatus !== 'connected') {
      setProgramEditor({ openError: t('errors.connectFirst') });
      return;
    }
    setBrowserLoadOpen(true);
  }, [connectionStatus, setProgramEditor, t]);

  const handleReloadProgramFromDisk = useCallback(() => {
    if (connectionStatus !== 'connected') {
      setProgramEditor({ openError: t('errors.connectFirst') });
      return;
    }
    if (!programReadParams) {
      setProgramEditor({
        openError: t('errors.noPathLoaded'),
      });
      return;
    }
    const readKey = programReadRequestKey(programReadParams);
    const cmdId = generateCommandId();
    pendingProgramReadIdsRef.current.set(cmdId, readKey);
    pendingManualProgramReadIdRef.current = cmdId;
    setProgramReloadBusy(true);
    setProgramEditor({ openError: null });
    sendCommand('program', 'read', programReadParams, cmdId);
    const timer = setTimeout(() => {
      programReadFallbackTimersRef.current.delete(cmdId);
      if (pendingProgramReadIdsRef.current.delete(cmdId)) {
        if (pendingManualProgramReadIdRef.current === cmdId) {
          pendingManualProgramReadIdRef.current = null;
          setProgramReloadBusy(false);
          setProgramEditor({
            openError: t('errors.readTimeout'),
          });
        }
      }
    }, COMMAND_RESPONSE_FALLBACK_MS);
    programReadFallbackTimersRef.current.set(cmdId, timer);
  }, [connectionStatus, programReadParams, sendCommand, setProgramEditor, t]);

  const handleSaveBackend = useCallback(() => {
    if (connectionStatus !== 'connected') {
      clearSaveSuccessFeedback();
      setProgramEditor({ writeError: t('errors.noConnection') });
      return;
    }
    if (filePath == null || filePath.length === 0) {
      clearSaveSuccessFeedback();
      setProgramEditor({
        writeError: t('errors.noPathSaveAs'),
      });
      return;
    }
    const cmdId = generateCommandId();
    pendingProgramWriteIdsRef.current.clear();
    pendingProgramWriteIdsRef.current.add(cmdId);
    pendingWriteKindRef.current = 'save';
    pendingWriteContentRef.current = programContent;
    clearSaveSuccessFeedback();
    setProgramEditor({ writeError: null });
    sendCommand('program', 'write', { path: filePath, content: programContent }, cmdId);
  }, [
    clearSaveSuccessFeedback,
    connectionStatus,
    filePath,
    programContent,
    sendCommand,
    setProgramEditor,
    t,
  ]);

  const handleSaveAsConfirm = useCallback(
    (fullPath: string) => {
      if (connectionStatus !== 'connected') {
        clearSaveSuccessFeedback();
        setProgramEditor({ writeError: t('errors.noConnection') });
        return;
      }
      const cmdId = generateCommandId();
      pendingProgramWriteIdsRef.current.clear();
      pendingProgramWriteIdsRef.current.add(cmdId);
      pendingWriteKindRef.current = 'saveAs';
      pendingWriteContentRef.current = programContent;
      clearSaveSuccessFeedback();
      setProgramEditor({ writeError: null, filePath: fullPath });
      sendCommand('program', 'write', { path: fullPath, content: programContent }, cmdId);
    },
    [
      clearSaveSuccessFeedback,
      connectionStatus,
      programContent,
      sendCommand,
      setProgramEditor,
      t,
    ],
  );

  const reloadFromDiskDisabled =
    connectionStatus !== 'connected' || !hasPathForProgramRead(filePath, statusProgramFile) || programReloadBusy;

  const cycleStartHintVars = useMemo(
    () => ({
      cycleStart: t('components:virtualSidebar.cycleStart'),
      runFromLine: t('runFromLine'),
    }),
    [t],
  );

  /** Lines as in the editor (including blanks), not only non-empty lines. */
  const lineCount = Math.max(1, programContent.split('\n').length);
  const runFromLineParsed = parsePositiveIntFromNumericExpression(runFromLineInput);
  const runFromLineValueOk =
    runFromLineParsed !== null && runFromLineParsed <= lineCount;
  const runFromLineErrorText =
    runFromLineInput.trim() && !runFromLineValueOk
      ? runFromLineParsed === null
        ? t('runFromLineInvalid', { max: lineCount })
        : t('runFromLineOutOfRange', { max: lineCount })
      : undefined;

  const handleRunFromLine = useCallback(() => {
    const num = parsePositiveIntFromNumericExpression(runFromLineInput);
    if (num === null || num < 1 || num > lineCount) return;
    const index = Math.min(num - 1, lineCount - 1);
    setProgramEditor({
      currentLineIndex: index,
      pendingAutoRunStartLine: editorLineToStartLine(num),
    });
    setRunFromLineDialogOpen(false);
  }, [runFromLineInput, lineCount, setProgramEditor]);

  const openRunFromLineDialog = useCallback(() => {
    setRunFromLineSyncKey((k) => k + 1);
    setRunFromLineDialogOpen(true);
  }, []);

  const handleLineNumberClick = useCallback(
    (line1Based: number) => {
      setRunFromLineSyncKey((k) => k + 1);
      setProgramEditor({ runFromLineInput: String(line1Based) });
      setRunFromLineDialogOpen(true);
    },
    [setProgramEditor],
  );

  return (
    <>
      <div className={machinePreviewGridClassName}>
        <MachinePreviewColumn
          className={machinePreviewColumnStackedClassName}
          activeTool={activeTool}
          spindleSpeed={spindleSpeed}
          spindleOverridePercent={spindleOverridePercent}
          feedRate={feedRate}
          feedOverridePercent={feedOverridePercent}
        />

        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="flex min-h-0 flex-1 flex-col gap-1">
            <ProgramEditor
              content={programContent}
              currentLineIndex={currentLineIndex}
              editable={!programFileExecuting}
              onChange={(c) => setProgramEditor({ content: c })}
              onLineNumberClick={handleLineNumberClick}
            />
            {programFileExecuting ? (
              <p className="shrink-0 text-xs text-muted-foreground">
                {t('executingLocked')}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            {displayedLoadedPath ? (
              <AppTooltip content={displayedLoadedPath} className="max-w-full min-w-0">
                <p className="max-w-full truncate text-xs text-muted-foreground">{displayedLoadedPath}</p>
              </AppTooltip>
            ) : null}
            {programOpenError ? (
              <p
                className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-sm text-destructive"
                role="alert"
              >
                {programOpenError}
              </p>
            ) : null}
            {programWriteError ? (
              <p
                className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-sm text-destructive"
                role="alert"
              >
                {programWriteError}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="surface" size="lg" onClick={handleOpenBrowser} className="gap-2">
                <HardDrive className="h-5 w-5 shrink-0" />
                {t('loadFile')}
              </Button>
              <AppTooltip content={t('reloadTooltip')}>
                <Button
                  type="button"
                  variant="surface"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  disabled={reloadFromDiskDisabled}
                  onClick={handleReloadProgramFromDisk}
                  data-e2e="program-reload-from-disk"
                  aria-label={t('reloadAria')}
                >
                  <RefreshCw className={cn('h-5 w-5', programReloadBusy && 'animate-spin')} />
                </Button>
              </AppTooltip>
              <AppTooltip content={t('saveTooltip')}>
                <Button
                  variant="surface"
                  size="lg"
                  onClick={handleSaveBackend}
                  className={cn(
                    'gap-2 transition-colors',
                    saveSuccessTarget === 'save' && saveSuccessButtonClassName,
                  )}
                  data-e2e="program-save"
                >
                  {saveSuccessTarget === 'save' ? (
                    <Check className="h-5 w-5 shrink-0" aria-hidden />
                  ) : (
                    <Save className="h-5 w-5 shrink-0" aria-hidden />
                  )}
                  {saveSuccessTarget === 'save' ? t('saved') : t('save')}
                </Button>
              </AppTooltip>
              <Button
                variant="surface"
                size="lg"
                onClick={() => {
                  if (connectionStatus !== 'connected') {
                    clearSaveSuccessFeedback();
                    setProgramEditor({ writeError: t('errors.noConnection') });
                    return;
                  }
                  setBrowserSaveAsOpen(true);
                }}
                className={cn(
                  'gap-2 transition-colors',
                  saveSuccessTarget === 'saveAs' && saveSuccessButtonClassName,
                )}
                data-e2e="program-save-as"
              >
                {saveSuccessTarget === 'saveAs' ? (
                  <Check className="h-5 w-5 shrink-0" aria-hidden />
                ) : (
                  <SaveAll className="h-5 w-5 shrink-0" aria-hidden />
                )}
                {saveSuccessTarget === 'saveAs' ? t('saved') : t('saveAs')}
              </Button>
              <Button variant="surface" size="lg" onClick={openRunFromLineDialog} className="gap-2">
                <Play className="h-5 w-5 shrink-0" />
                {t('runFromLine')}
              </Button>
            </div>
            {!programFileExecuting ? (
              <div className="flex flex-col gap-0.5">
                <p
                  className="shrink-0 text-xs leading-snug text-muted-foreground"
                  data-e2e="program-cycle-start-hint"
                >
                  {t(
                    showVirtualSidebar ? 'cycleStartHint' : 'cycleStartHintNoSidebar',
                    cycleStartHintVars,
                  )}
                </p>
                {pendingAutoRunStartLine > 0 ? (
                  <p className="shrink-0 text-xs leading-snug text-muted-foreground">
                    {t('cycleStartHintPendingLine', {
                      line: startLineToEditorLine1Based(pendingAutoRunStartLine),
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <ProgramFileBrowserDialog
        open={browserLoadOpen}
        onOpenChange={setBrowserLoadOpen}
        mode="load"
        onFileLoaded={handleBrowserFileLoaded}
      />
      <ProgramFileBrowserDialog
        open={browserSaveAsOpen}
        onOpenChange={setBrowserSaveAsOpen}
        mode="saveAs"
        onSaveAsConfirm={handleSaveAsConfirm}
      />
      <Dialog open={runFromLineDialogOpen} onOpenChange={setRunFromLineDialogOpen}>
        <DialogContent
          title={t('runFromLineTitle')}
          className={touchNumericDialogContentClassName}
          onKeyDown={(e) =>
            trySubmitDialogFormOnEnter(e, runFromLineValueOk, handleRunFromLine)
          }
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <TouchNumericEntry
              id="run-from-line-input"
              value={runFromLineInput}
              onChange={(v) => setProgramEditor({ runFromLineInput: v })}
              label={t('lineLabel', { max: lineCount })}
              keypadMode="always"
              showPreview
              integerOnly
              layoutSize="touch"
              errorText={runFromLineErrorText}
              data-e2e="run-from-line-touch-input"
              focusSelectSessionKey={runFromLineDialogOpen ? runFromLineSyncKey : undefined}
            />
          </div>
          <TouchNumericDialogFooter
            onCancel={() => setRunFromLineDialogOpen(false)}
            onConfirm={handleRunFromLine}
            cancelLabel={t('cancel')}
            confirmLabel={t('apply')}
            confirmDisabled={!runFromLineValueOk}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
