import {
  isLinuxCncStatusMessage,
  mapStatusMessageToStoreUpdates,
  isMotionCoordinatesChangedEventMessage,
  mapCoordinatesChangedEventToStoreUpdates,
  isMachineIniConfigLoadedEventMessage,
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
import { useAppStore } from '@/store';
import { useEffect, useRef } from 'react';

export function useBackendWebSocket() {
  const backendWebSocketUrl = useAppStore((s) => s.backendWebSocketUrl);
  const coordinateUiFlushMs = useAppStore((s) => s.coordinateUiFlushMs);
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus);
  const setLinuxCncStatus = useAppStore((s) => s.setLinuxCncStatus);
  const resetUnhomedJogDialogForAxis = useAppStore((s) => s.resetUnhomedJogDialogForAxis);
  const setBackendWebSocket = useAppStore((s) => s.setBackendWebSocket);
  const setIniRuntimeConfig = useAppStore((s) => s.setIniRuntimeConfig);
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
                const axes: Array<{ index: number; axis: 'x' | 'y' | 'z' }> = [
                  { index: 0, axis: 'x' },
                  { index: 1, axis: 'y' },
                  { index: 2, axis: 'z' },
                ];

                for (const { index, axis } of axes) {
                  const prev = previousHomed[index];
                  const next = nextHomed[index];
                  if ((prev === undefined || prev === 0) && next && next !== 0) {
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
  ]);
}
