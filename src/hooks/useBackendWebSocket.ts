import {
  isLinuxCncStatusMessage,
  mapStatusMessageToStoreUpdates,
  isMotionCoordinatesChangedEventMessage,
  mapCoordinatesChangedEventToStoreUpdates,
  isMachineIniConfigLoadedEventMessage,
  isPlasmaPinsChangedEventMessage,
  isPlasmaConfigErrorEventMessage,
  isPlasmaMaterialsChangedEventMessage,
  isPlasmaParametersChangedEventMessage,
  isPlasmaPinsSnapshotEventMessage,
  isPlasmaAlignmentEventMessage,
  isPlasmaWriteErrorEventMessage,
  isPlasmaStateChangedEventMessage,
  mapPlasmaPinsDiff,
  isPanelSidebarTriggerEventMessage,
  isToolChangeRequestedEventMessage,
  mapIniConfigLoadedEventToStoreUpdates,
  type BackendMessage,
} from '@/api/statusMapping';
import { createCommandEnvelope } from '@/api/backendCommands';
import i18n from '@/i18n/config';
import { createCoordinateUpdateBatcher } from '@/lib/coordinateUpdateBatcher';
import {
  dispatchVirtualSidebarButton,
  isVirtualSidebarButtonId,
} from '@/lib/dispatchVirtualSidebarButton';
import { jointCoordinatesFromIni } from '@/lib/axisJointMap';
import { useAppStore } from '@/store';
import { isAxisHomed } from '@/utils/homing';
import { useEffect, useRef } from 'react';

export function useBackendWebSocket() {
  const backendWebSocketUrl = useAppStore((s) => s.backendWebSocketUrl);
  const coordinateUiFlushMs = useAppStore((s) => s.coordinateUiFlushMs);
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus);
  const setLinuxCncStatus = useAppStore((s) => s.setLinuxCncStatus);
  const resetUnhomedJogDialogForAxis = useAppStore((s) => s.resetUnhomedJogDialogForAxis);
  const setBackendWebSocket = useAppStore((s) => s.setBackendWebSocket);
  const setIniRuntimeConfig = useAppStore((s) => s.setIniRuntimeConfig);
  const setPlasmaSnapshot = useAppStore((s) => s.setPlasmaSnapshot);
  const mergePlasmaPins = useAppStore((s) => s.mergePlasmaPins);
  const setPlasmaState = useAppStore((s) => s.setPlasmaState);
  const setPlasmaMaterials = useAppStore((s) => s.setPlasmaMaterials);
  const setPlasmaParameters = useAppStore((s) => s.setPlasmaParameters);
  const resetPlasma = useAppStore((s) => s.resetPlasma);
  const showErrorToast = useAppStore((s) => s.showErrorToast);
  const setLastWsCommandResult = useAppStore((s) => s.setLastWsCommandResult);
  const setPendingToolChange = useAppStore((s) => s.setPendingToolChange);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!backendWebSocketUrl) {
      return;
    }

    const coordinateBatcher = createCoordinateUpdateBatcher((coordinates) => {
      useAppStore.getState().setCoordinates(coordinates);
    }, coordinateUiFlushMs);

    const connect = () => {
      const ws = new WebSocket(backendWebSocketUrl);

      ws.onopen = () => {
        setBackendWebSocket(ws);
        setConnectionStatus('connected');
        ws.send(JSON.stringify(createCommandEnvelope('machine', 'get_ini_config')));
      };

      ws.onmessage = (event) => {
        try {
          const { debugLoggingEnabled, debugLogWsIncoming } = useAppStore.getState();
          if (debugLoggingEnabled && debugLogWsIncoming) {
            const timestamp = new Date().toISOString();
            // eslint-disable-next-line no-console
            console.log('[debug][ws][in]', timestamp, event.data);
          }

          const msg = JSON.parse(event.data) as BackendMessage;

          if (msg.type === 'command_result') {
            const commandId = typeof msg.commandId === 'string' ? msg.commandId : '';
            const ok = msg.ok === true;
            const category = typeof msg.category === 'string' ? msg.category : undefined;
            const action = typeof msg.action === 'string' ? msg.action : undefined;
            const errObj = msg.error;
            const error =
              !ok && errObj && typeof errObj === 'object'
                ? {
                    code: typeof errObj.code === 'string' ? errObj.code : 'unknown',
                    message: typeof errObj.message === 'string' ? errObj.message : '',
                    ...(typeof errObj.path === 'string' && errObj.path.length > 0
                      ? { path: errObj.path }
                      : {}),
                  }
                : undefined;
            const rawResult = msg.result;
            const result =
              ok &&
              rawResult !== null &&
              rawResult !== undefined &&
              typeof rawResult === 'object' &&
              !Array.isArray(rawResult)
                ? rawResult
                : undefined;
            setLastWsCommandResult({
              commandId,
              ok,
              ...(category !== undefined ? { category } : {}),
              ...(action !== undefined ? { action } : {}),
              error,
              result,
            });
          }

          // Surface backend errors in the toast stack (multiple messages allowed)
          if (msg.type === 'linuxcnc_error') {
            const message =
              typeof msg.message === 'string'
                ? msg.message
                : i18n.t('wsErrors.unknownLinuxcnc', { ns: 'hooks' });
            const kind = typeof msg.kind === 'string' ? msg.kind : undefined;
            showErrorToast({ message, kind });
          } else if (msg.type === 'error') {
            // Legacy/generic backend error (see backend/contracts/messages.py)
            const code = typeof msg.error === 'string' ? msg.error : undefined;
            const message =
              typeof msg.message === 'string'
                ? msg.message
                : code ?? i18n.t('wsErrors.unknownBackend', { ns: 'hooks' });
            showErrorToast({ message, kind: code ?? 'backend_error' });
          } else if ((msg.type === 'command_result' || msg.type === 'command_completion') && msg.ok === false) {
            const wsCategory =
              typeof msg.category === 'string' ? msg.category : '';
            const wsAction = typeof msg.action === 'string' ? msg.action : '';
            // File/list errors: Program screen shows a banner; no toast.
            // program.auto (cycle start) etc.: without a toast it looked like nothing happened.
            const programFileOps = wsAction === 'open' || wsAction === 'read' || wsAction === 'write' || wsAction === 'list';
            const errorCode =
              msg.error && typeof msg.error === 'object' && typeof msg.error.code === 'string'
                ? msg.error.code
                : undefined;
            if (wsCategory === 'program' && programFileOps) {
              /* skip toast */
            } else if (wsCategory === 'app' && wsAction === 'exit') {
              /* skip toast — HeaderBar shows a local notice */
            } else if (wsCategory === 'hal' && wsAction === 'set_jog_wheel_scale') {
              /* skip toast — optional MPG scale sync; missing pins are common in sim/E2E */
            } else if (
              errorCode === 'command_in_progress' &&
              ((wsCategory === 'machine' &&
                (wsAction === 'feed_override' || wsAction === 'spindle_override')) ||
                (wsCategory === 'program' && wsAction === 'auto'))
            ) {
              /* skip toast — rotary presets coalesce; transient lock is expected */
            } else {
              const code = errorCode;
              const message =
                typeof msg.error?.message === 'string'
                  ? msg.error.message
                  : code ?? i18n.t('wsErrors.unknownCommand', { ns: 'hooks' });
              showErrorToast({ message, kind: code });
            }
          }

          if (isLinuxCncStatusMessage(msg)) {
            const state = useAppStore.getState();
            const { linuxCncStatus, coordinates } = state;
            const updates = mapStatusMessageToStoreUpdates(msg, {
              linuxCncStatus,
              coordinates,
            });

            if (updates.linuxCncStatusPartial) {
              const previousHomed = linuxCncStatus.motion.homed;
              const nextHomed = updates.linuxCncStatusPartial.motion?.homed;

              if (Array.isArray(previousHomed) && Array.isArray(nextHomed)) {
                // stat.homed is indexed by joint, so an axis only becomes homed once
                // every joint driving it reports homed (Y owns joints 1 and 2 on a
                // gantry, Z is joint 3 on trivkins coordinates=xyyz).
                const jointCoordinates = jointCoordinatesFromIni(state.iniRuntimeConfig);
                const nextStatus = {
                  motion: { ...linuxCncStatus.motion, ...updates.linuxCncStatusPartial.motion },
                  joints: updates.linuxCncStatusPartial.joints ?? linuxCncStatus.joints,
                };

                for (const axis of ['x', 'y', 'z'] as const) {
                  if (
                    !isAxisHomed(linuxCncStatus, axis, jointCoordinates) &&
                    isAxisHomed(nextStatus, axis, jointCoordinates)
                  ) {
                    resetUnhomedJogDialogForAxis(axis);
                  }
                }
              }

              setLinuxCncStatus(updates.linuxCncStatusPartial);
            }
            if (updates.coordinatesUpdate) {
              coordinateBatcher.schedule(updates.coordinatesUpdate);
            }
            if (updates.connectionStatus) {
              setConnectionStatus(updates.connectionStatus);
            }
          }
          if (isMotionCoordinatesChangedEventMessage(msg)) {
            const state = useAppStore.getState();
            const updates = mapCoordinatesChangedEventToStoreUpdates(msg, {
              linuxCncStatus: state.linuxCncStatus,
              coordinates: state.coordinates,
            });

            if (updates.coordinatesUpdate) {
              coordinateBatcher.schedule(updates.coordinatesUpdate);
            }
          }
          if (isMachineIniConfigLoadedEventMessage(msg)) {
            const state = useAppStore.getState();
            setIniRuntimeConfig(mapIniConfigLoadedEventToStoreUpdates(msg, state.iniRuntimeConfig));
          }
          if (isPlasmaPinsSnapshotEventMessage(msg)) {
            setPlasmaSnapshot(msg.payload);
          }
          if (isPlasmaPinsChangedEventMessage(msg)) {
            mergePlasmaPins(mapPlasmaPinsDiff(msg.payload));
          }
          if (isPlasmaStateChangedEventMessage(msg)) {
            setPlasmaState(msg.payload);
          }
          if (isPlasmaMaterialsChangedEventMessage(msg)) {
            setPlasmaMaterials(msg.payload);
          }
          if (isPlasmaParametersChangedEventMessage(msg)) {
            setPlasmaParameters(msg.payload);
          }
          if (isPlasmaAlignmentEventMessage(msg)) {
            useAppStore.getState().setPlasmaAlignment(msg.payload);
          }
          if (isPlasmaWriteErrorEventMessage(msg)) {
            // A refused pin write, a failed probe, a machine button that could not act: all
            // came from the machine rather than from a click, so they need the toast stack.
            showErrorToast({ message: msg.payload.message, kind: msg.payload.code });
          }
          if (isPlasmaConfigErrorEventMessage(msg)) {
            // A material change the machine asked for and could not have. It comes from the
            // machine rather than from a click, so it needs the toast stack to be seen.
            showErrorToast({ message: msg.payload.message, kind: msg.payload.code });
          }
          if (isToolChangeRequestedEventMessage(msg)) {
            const p = msg.payload;
            setPendingToolChange({
              toolNumber: p.tool_number,
              description: typeof p.description === 'string' ? p.description : '',
            });
          }
          if (isPanelSidebarTriggerEventMessage(msg)) {
            const buttonId = msg.payload.buttonId;
            if (isVirtualSidebarButtonId(buttonId)) {
              dispatchVirtualSidebarButton(buttonId, 'hal');
            }
          }
          // For other event types, leave machine status/coordinates unchanged
        } catch {
          // ignore invalid JSON
        }
      };

      ws.onclose = () => {
        coordinateBatcher.flushNow();
        setConnectionStatus('disconnected');
        setPendingToolChange(null);
        // Pin values go stale the moment the socket drops, and a diff only means something
        // on top of a snapshot — the next connect sends a fresh one.
        resetPlasma();
        wsRef.current = null;
        setBackendWebSocket(null);
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        setConnectionStatus('error');
        setPendingToolChange(null);
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      coordinateBatcher.flushNow();
      coordinateBatcher.dispose();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setBackendWebSocket(null);
      setConnectionStatus('disconnected');
      setPendingToolChange(null);
    };
  }, [
    backendWebSocketUrl,
    coordinateUiFlushMs,
    setConnectionStatus,
    setLinuxCncStatus,
    resetUnhomedJogDialogForAxis,
    setBackendWebSocket,
    setIniRuntimeConfig,
    showErrorToast,
    setLastWsCommandResult,
    setPendingToolChange,
    setPlasmaSnapshot,
    mergePlasmaPins,
    setPlasmaState,
    setPlasmaMaterials,
    setPlasmaParameters,
    resetPlasma,
  ]);
}
