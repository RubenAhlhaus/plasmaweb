import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generateCommandId, useSendCommand } from '@/api/backendCommands';
import { SIDEBAR_INDEX_PROGRAM } from '@/constants/sidebarNav';
import { eventBus } from '@/eventBus';
import {
  buildGeneratedProgramFilename,
  generateMacroQueueProgram,
} from '@/lib/macroGcode/emitProgram';
import { formatProgramPathError } from '@/lib/formatProgramPathError';
import { useWsCommandResultHistoryEffect } from '@/hooks/usePendingWsCommandResult';
import { findLatestCommandResultForId } from '@/lib/wsCommandResults';
import { useAppStore } from '@/store';
import type { Tool } from '@/types/tools';

type PipelineState =
  | { kind: 'idle' }
  | { kind: 'list'; listCmdId: string; content: string }
  | { kind: 'write'; writeCmdId: string; targetPath: string; content: string }
  | { kind: 'open'; openCmdId: string; path: string }
  | { kind: 'read'; readCmdId: string; path: string };

function joinProgramDirAndFile(dir: string, fileName: string): string {
  const d = dir.replace(/[/\\]+$/, '');
  return `${d}/${fileName}`;
}

export function useMacroQueueProgramGeneration(tools: Tool[]) {
  const { t } = useTranslation('components');
  const sendCommand = useSendCommand();
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const setProgramEditor = useAppStore((s) => s.setProgramEditor);
  const setActiveMenuIndex = useAppStore((s) => s.setActiveMenuIndex);
  const showErrorToast = useAppStore((s) => s.showErrorToast);

  const pendingRef = useRef<PipelineState>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);

  const startPipeline = useCallback(() => {
    if (connectionStatus !== 'connected') {
      showErrorToast({
        message: t('programPathErrors.notConnected'),
      });
      return;
    }
    if (pendingRef.current.kind !== 'idle') {
      showErrorToast({
        message: t('programPathErrors.alreadyGenerating'),
      });
      return;
    }
    const queue = useAppStore.getState().macroQueueItems;
    const setup = useAppStore.getState().macroQueueProgramSetup;
    const gen = generateMacroQueueProgram(queue, tools, setup);
    if (!gen.ok) {
      showErrorToast({
        message: t('programPathErrors.cannotGenerateGcode', { errors: gen.errors.join(' ') }),
      });
      return;
    }

    setBusy(true);
    const listCmdId = generateCommandId();
    pendingRef.current = { kind: 'list', listCmdId, content: gen.content };
    sendCommand('program', 'list', {}, listCmdId);
  }, [connectionStatus, sendCommand, showErrorToast, t, tools]);

  useEffect(() => {
    const unsubscribe = eventBus.subscribe('ui.macros.generateProgram', () => {
      startPipeline();
    });
    return unsubscribe;
  }, [startPipeline]);

  useWsCommandResultHistoryEffect((commandResultHistory) => {
    const st = pendingRef.current;
    if (st.kind === 'idle') return;

    if (st.kind === 'list') {
      const r = findLatestCommandResultForId(commandResultHistory, st.listCmdId);
      if (!r) return;
      if (!r.ok) {
        pendingRef.current = { kind: 'idle' };
        setBusy(false);
        showErrorToast({
          message: formatProgramPathError(
            r.error,
            t('programPathErrors.generateProgramListFailed'),
            t,
          ),
        });
        return;
      }
      const dir = r.result && typeof r.result.path === 'string' ? r.result.path : null;
      if (!dir) {
        pendingRef.current = { kind: 'idle' };
        setBusy(false);
        showErrorToast({
          message: t('programPathErrors.generateProgramListInvalidResponse'),
        });
        return;
      }
      const targetPath = joinProgramDirAndFile(dir, buildGeneratedProgramFilename());
      const writeCmdId = generateCommandId();
      pendingRef.current = {
        kind: 'write',
        writeCmdId,
        targetPath,
        content: st.content,
      };
      sendCommand('program', 'write', { path: targetPath, content: st.content }, writeCmdId);
      return;
    }

    if (st.kind === 'write') {
      const r = findLatestCommandResultForId(commandResultHistory, st.writeCmdId);
      if (!r) return;
      if (!r.ok) {
        pendingRef.current = { kind: 'idle' };
        setBusy(false);
        showErrorToast({
          message: formatProgramPathError(r.error, t('programPathErrors.generateProgramSaveFailed'), t),
        });
        return;
      }
      const resolved =
        r.result && typeof r.result.path === 'string' && r.result.path.length > 0
          ? r.result.path
          : st.targetPath;
      setProgramEditor({
        content: st.content,
        filePath: resolved,
        writeError: null,
        openError: null,
      });
      const openCmdId = generateCommandId();
      pendingRef.current = { kind: 'open', openCmdId, path: resolved };
      sendCommand('program', 'open', { path: resolved }, openCmdId);
      return;
    }

    if (st.kind === 'open') {
      const r = findLatestCommandResultForId(commandResultHistory, st.openCmdId);
      if (!r) return;
      if (!r.ok) {
        pendingRef.current = { kind: 'idle' };
        setBusy(false);
        setProgramEditor({
          openError: formatProgramPathError(
            r.error,
            t('programPathErrors.openProgramFailed'),
            t,
          ),
        });
        return;
      }
      const readCmdId = generateCommandId();
      pendingRef.current = { kind: 'read', readCmdId, path: st.path };
      sendCommand('program', 'read', { path: st.path }, readCmdId);
      return;
    }

    if (st.kind === 'read') {
      const r = findLatestCommandResultForId(commandResultHistory, st.readCmdId);
      if (!r) return;
      pendingRef.current = { kind: 'idle' };
      setBusy(false);
      if (r.ok && r.result && typeof r.result.content === 'string') {
        const fp =
          typeof r.result.path === 'string' && r.result.path.length > 0 ? r.result.path : st.path;
        setProgramEditor({
          content: r.result.content,
          filePath: fp,
          openError: null,
          writeError: null,
        });
        setActiveMenuIndex(SIDEBAR_INDEX_PROGRAM);
      } else {
        const detail = formatProgramPathError(
          r.error,
          t('programPathErrors.readProgramFailed'),
          t,
        );
        showErrorToast({ message: detail });
        setProgramEditor({ openError: detail });
        setActiveMenuIndex(SIDEBAR_INDEX_PROGRAM);
      }
    }
  });

  return { macroProgramBusy: busy };
}
