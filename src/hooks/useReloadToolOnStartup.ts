import { useEffect, useRef, useState } from 'react';
import { generateCommandId, useSendCommand } from '@/api/backendCommands';
import { useMdiPreconditions } from '@/hooks/useMdiPreconditions';
import { usePendingWsCommandResult } from '@/hooks/usePendingWsCommandResult';
import {
  decideToolInSpindlePersist,
  mdiLineForReloadTool,
  shouldReloadLastTool,
} from '@/lib/reloadToolOnStartup';
import { saveToolInSpindlePreference } from '@/lib/userPreferencesApi';
import { useAppStore } from '@/store';
import { getUnhomedAxes } from '@/utils/homing';
import { useJointCoordinates } from '@/hooks/useJointCoordinates';

/** Homed-session restore lifecycle (one attempt in flight / completed per session). */
type RestorePhase = 'idle' | 'in_flight' | 'completed';

const MAX_RESTORE_RETRIES = 3;
const RESTORE_RETRY_DELAY_MS = 500;

/**
 * Persists `tool_in_spindle` to user preferences and restores it after homing
 * via `M61 Q… G43` (gmoccapy-style). Call once at app root.
 */
export function useReloadToolOnStartup(): void {
  const sendCommand = useSendCommand();
  const { canMdi } = useMdiPreconditions();

  const toolInSpindle = useAppStore((s) => s.linuxCncStatus.tools?.tool_in_spindle);
  const motionHomed = useAppStore((s) => s.linuxCncStatus.motion?.homed);
  const joints = useAppStore((s) => s.linuxCncStatus.joints);
  const reloadToolOnStartup = useAppStore((s) => s.reloadToolOnStartup);
  const storedToolNumber = useAppStore((s) => s.toolInSpindlePreference);
  const connectionStatus = useAppStore((s) => s.connectionStatus);

  const lastObservedRuntimeRef = useRef<number | null>(null);
  const restorePhaseRef = useRef<RestorePhase>('idle');
  const pendingRestoreCommandIdRef = useRef<string | null>(null);
  const restoreFailCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped after a failed restore so the effect re-runs while still homed. */
  const [restoreRetryToken, setRestoreRetryToken] = useState(0);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current != null) clearTimeout(retryTimerRef.current);
    };
  }, []);

  usePendingWsCommandResult(pendingRestoreCommandIdRef, {
    onResult: (result) => {
      pendingRestoreCommandIdRef.current = null;
      if (result.ok) {
        restorePhaseRef.current = 'completed';
        restoreFailCountRef.current = 0;
        return;
      }
      restoreFailCountRef.current += 1;
      if (restoreFailCountRef.current >= MAX_RESTORE_RETRIES) {
        restorePhaseRef.current = 'completed';
        return;
      }
      restorePhaseRef.current = 'idle';
      if (retryTimerRef.current != null) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        setRestoreRetryToken((n) => n + 1);
      }, RESTORE_RETRY_DELAY_MS);
    },
  });
  // Persist tool_in_spindle according to decideToolInSpindlePersist.
  useEffect(() => {
    if (toolInSpindle == null || !Number.isFinite(toolInSpindle)) return;
    const n = Math.trunc(toolInSpindle);
    const decision = decideToolInSpindlePersist({
      runtimeTool: n,
      storedPreference: useAppStore.getState().toolInSpindlePreference,
      lastObservedRuntime: lastObservedRuntimeRef.current,
    });
    if (decision.action === 'none') return;

    lastObservedRuntimeRef.current = n;
    if (decision.action === 'seed') return;

    useAppStore.getState().setToolInSpindlePreference(decision.toolNumber);
    void saveToolInSpindlePreference(decision.toolNumber);
  }, [toolInSpindle]);

  const jointCoordinates = useJointCoordinates();

  // Restore after all axes are homed (at most one successful / in-flight attempt per session).
  useEffect(() => {
    const allAxesHomed =
      getUnhomedAxes({ motion: { homed: motionHomed }, joints }, jointCoordinates).length === 0;

    if (!allAxesHomed) {
      restorePhaseRef.current = 'idle';
      pendingRestoreCommandIdRef.current = null;
      restoreFailCountRef.current = 0;
      if (retryTimerRef.current != null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      return;
    }

    if (
      !shouldReloadLastTool({
        reloadEnabled: reloadToolOnStartup,
        storedToolNumber,
        currentToolInSpindle: toolInSpindle,
        allAxesHomed: true,
        canMdi,
        sessionBlocked: restorePhaseRef.current !== 'idle',
      })
    ) {
      // Spindle already has a tool → no restore this session.
      if (
        toolInSpindle !== undefined &&
        toolInSpindle !== 0 &&
        restorePhaseRef.current === 'idle'
      ) {
        restorePhaseRef.current = 'completed';
      }
      return;
    }

    if (connectionStatus !== 'connected') {
      return;
    }

    const commandId = generateCommandId();
    const sent = sendCommand(
      'program',
      'mdi',
      { text: mdiLineForReloadTool(storedToolNumber) },
      commandId,
    );
    if (!sent) {
      return;
    }
    pendingRestoreCommandIdRef.current = commandId;
    restorePhaseRef.current = 'in_flight';
  }, [
    canMdi,
    connectionStatus,
    joints,
    motionHomed,
    reloadToolOnStartup,
    restoreRetryToken,
    sendCommand,
    storedToolNumber,
    toolInSpindle,
    jointCoordinates,
  ]);
}
