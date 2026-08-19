import { useEffect } from 'react';
import { eventBus } from '@/eventBus';
import { useSendCommand } from '@/api/backendCommands';
import { useAppStore } from '@/store';
import type { LinuxCncStatusRoot } from '@/store/types';
import { isProgramInterpreterPaused } from '@/utils/isProgramInterpreterPaused';

/**
 * Subscribes to ui.program.pause, ui.program.stop, and ui.program.cycleStart;
 * maps them to program.auto (pause toggles pause/resume, cycle start runs or resumes) and machine.abort via WebSocket.
 * Call once at app root (e.g. App.tsx).
 */
export function useProgramExecutionEventBridge(): void {
  const sendCommand = useSendCommand();

  useEffect(() => {
    const unsubPause = eventBus.subscribe('ui.program.pause', () => {
      const status = useAppStore.getState().linuxCncStatus as LinuxCncStatusRoot;
      if (isProgramInterpreterPaused(status)) {
        sendCommand('program', 'auto', { command: 'resume' });
      } else {
        sendCommand('program', 'auto', { command: 'pause' });
      }
    });

    const unsubStop = eventBus.subscribe('ui.program.stop', () => {
      sendCommand('machine', 'abort', {});
    });

    const unsubCycleStart = eventBus.subscribe('ui.program.cycleStart', () => {
      const status = useAppStore.getState().linuxCncStatus as LinuxCncStatusRoot;
      if (isProgramInterpreterPaused(status)) {
        sendCommand('program', 'auto', { command: 'resume' });
      } else {
        const pending = useAppStore.getState().programEditor.pendingAutoRunStartLine;
        sendCommand('program', 'auto', { command: 'run', startLine: pending });
        useAppStore.getState().setProgramEditor({ pendingAutoRunStartLine: 0 });
      }
    });

    return () => {
      unsubPause();
      unsubStop();
      unsubCycleStart();
    };
  }, [sendCommand]);
}
