import { readStoredOverridePresetHotkeys } from '@/lib/overridePresetHotkeysStorage';
import { readStoredShowVirtualSidebar } from '@/lib/uiPreferencesStorage';
import { readStoredVirtualSidebarHotkeys } from '@/lib/virtualSidebarHotkeysStorage';
import { appendCommandResultToHistory } from '@/lib/wsCommandResults';
import { DEFAULT_COORDINATE_UI_FLUSH_MS } from '@/lib/coordinateUpdateBatcher';
import {
  clampJogVelocityMmPerMin,
  DEFAULT_JOG_VELOCITY_MM_MIN,
} from '@/lib/jogVelocity';
import {
  createDefaultMacroQueueProgramSetup,
  type MacroQueueProgramSetup,
} from '@/types/macroQueueSetup';
import type { QueueItem } from '@/types/macros';
import type { StateCreator } from 'zustand';
import type { BoundStore, ProgramEditorState } from './types';
import { MAX_MDI_COMMAND_HISTORY } from './mdiHistoryConstants';

function isMacroQueueItemsUpdater(
  value: QueueItem[] | ((prev: QueueItem[]) => QueueItem[]),
): value is (prev: QueueItem[]) => QueueItem[] {
  return typeof value === 'function';
}

function isMacroQueueProgramSetupUpdater(
  value: MacroQueueProgramSetup | ((prev: MacroQueueProgramSetup) => MacroQueueProgramSetup),
): value is (prev: MacroQueueProgramSetup) => MacroQueueProgramSetup {
  return typeof value === 'function';
}

function createInitialProgramEditorState(): ProgramEditorState {
  return {
    content: '',
    filePath: null,
    currentLineIndex: null,
    runFromLineInput: '1',
    pendingAutoRunStartLine: 0,
    openError: null,
    writeError: null,
  };
}

export const createUISlice: StateCreator<BoundStore, [], [], import('./types').UISlice> = (set) => ({
  lastWsCommandResult: null,
  commandResultHistory: [],
  setLastWsCommandResult: (result) =>
    set((state) => {
      if (result == null) {
        return { lastWsCommandResult: null, commandResultHistory: [] };
      }
      return {
        lastWsCommandResult: result,
        commandResultHistory: appendCommandResultToHistory(state.commandResultHistory, result),
      };
    }),
  mdiCommandHistory: [],
  appendMdiCommandHistory: (trimmedCommand) =>
    set((state) => {
      if (!trimmedCommand) return state;
      const next = [...state.mdiCommandHistory, trimmedCommand];
      return {
        mdiCommandHistory:
          next.length > MAX_MDI_COMMAND_HISTORY ? next.slice(-MAX_MDI_COMMAND_HISTORY) : next,
      };
    }),
  activeMenuIndex: 0,
  setActiveMenuIndex: (index) => set({ activeMenuIndex: index }),
  showVirtualSidebar: readStoredShowVirtualSidebar() ?? true,
  /** Config/bootstrap only — use `setShowVirtualSidebarPreference` from settings UI. */
  setShowVirtualSidebar: (show) => set({ showVirtualSidebar: show }),
  virtualSidebarHotkeys: readStoredVirtualSidebarHotkeys(),
  feedOverrideHotkeys: readStoredOverridePresetHotkeys('feed'),
  spindleOverrideHotkeys: readStoredOverridePresetHotkeys('spindle'),
  kioskMode: true,
  setKioskMode: (kioskMode) => set({ kioskMode }),
  userPreferencesLoadFailed: false,
  setUserPreferencesLoadFailed: (failed) => set({ userPreferencesLoadFailed: failed }),
  runLinuxCncAtStartup: false,
  setRunLinuxCncAtStartup: (runLinuxCncAtStartup) => set({ runLinuxCncAtStartup }),
  linuxCncIniPath: null,
  setLinuxCncIniPath: (linuxCncIniPath) => set({ linuxCncIniPath }),
  toolInSpindlePreference: 0,
  setToolInSpindlePreference: (toolInSpindlePreference) => set({ toolInSpindlePreference }),
  reloadToolOnStartup: true,
  setReloadToolOnStartup: (reloadToolOnStartup) => set({ reloadToolOnStartup }),
  jogMode: 'incremental',
  setJogMode: (jogMode) => set({ jogMode }),
  selectedJogIncrement: 1,
  setSelectedJogIncrement: (selectedJogIncrement) => set({ selectedJogIncrement }),
  jogVelocityMmPerMin: DEFAULT_JOG_VELOCITY_MM_MIN,
  setJogVelocityMmPerMin: (value) => set({ jogVelocityMmPerMin: clampJogVelocityMmPerMin(value) }),
  debugLoggingEnabled: false,
  setDebugLoggingEnabled: (debugLoggingEnabled) => set({ debugLoggingEnabled }),
  debugLogEventBus: true,
  setDebugLogEventBus: (debugLogEventBus) => set({ debugLogEventBus }),
  debugLogWsOutgoing: true,
  setDebugLogWsOutgoing: (debugLogWsOutgoing) => set({ debugLogWsOutgoing }),
  debugLogWsIncoming: false,
  setDebugLogWsIncoming: (debugLogWsIncoming) => set({ debugLogWsIncoming }),
  coordinateUiFlushMs: DEFAULT_COORDINATE_UI_FLUSH_MS,
  setCoordinateUiFlushMs: (coordinateUiFlushMs) => set({ coordinateUiFlushMs }),

  errorToasts: [],
  showErrorToast: (toast) =>
    set((state) => {
      const kindKey = toast.kind ?? undefined;
      const toneKey = toast.tone ?? 'error';
      const existingIndex = state.errorToasts.findIndex(
        (t) =>
          t.message === toast.message &&
          t.kind === kindKey &&
          (t.tone ?? 'error') === toneKey,
      );

      // If the exact same message (including kind) is already in the stack,
      // move it to the top only (dedup key includes kind).
      if (existingIndex !== -1) {
        const existing = state.errorToasts[existingIndex];
        const filtered = state.errorToasts.filter((t) => t.id !== existing.id);
        return { errorToasts: [existing, ...filtered] };
      }

      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return {
        errorToasts: [
          {
            id,
            message: toast.message,
            kind: toast.kind,
            ...(toast.tone !== undefined ? { tone: toast.tone } : {}),
          },
          ...state.errorToasts,
        ],
      };
    }),
  dismissErrorToast: (id) => set((state) => ({ errorToasts: state.errorToasts.filter((t) => t.id !== id) })),
  clearErrorToasts: () => set({ errorToasts: [] }),

  shownUnhomedJogDialogAxes: {},
  setUnhomedJogDialogShownForAxis: (axis) =>
    set((state) => ({
      shownUnhomedJogDialogAxes: {
        ...state.shownUnhomedJogDialogAxes,
        [axis]: true,
      },
    })),
  resetUnhomedJogDialogForAxis: (axis) =>
    set((state) => {
      const next = { ...state.shownUnhomedJogDialogAxes };
      delete next[axis];
      return { shownUnhomedJogDialogAxes: next };
    }),

  programEditor: createInitialProgramEditorState(),
  setProgramEditor: (partial) =>
    set((state) => ({
      programEditor: { ...state.programEditor, ...partial },
    })),
  resetProgramEditor: () =>
    set({
      programEditor: createInitialProgramEditorState(),
      macroQueueItems: [],
      macroQueueProgramSetup: createDefaultMacroQueueProgramSetup(),
    }),

  macroQueueProgramSetup: createDefaultMacroQueueProgramSetup(),
  setMacroQueueProgramSetup: (updater) =>
    set((state) => ({
      macroQueueProgramSetup: isMacroQueueProgramSetupUpdater(updater)
        ? updater(state.macroQueueProgramSetup)
        : updater,
    })),

  macroQueueItems: [],
  setMacroQueueItems: (updater) =>
    set((state) => ({
      macroQueueItems: isMacroQueueItemsUpdater(updater)
        ? updater(state.macroQueueItems)
        : updater,
    })),
});
