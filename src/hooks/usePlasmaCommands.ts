import { useCallback, useMemo } from 'react';

import { createCommandEnvelope } from '@/api/backendCommands';
import { useAppStore } from '@/store';

/** Toggle names the backend accepts (`ENABLE_PINS` in backend/plasma/service.py). */
export type PlasmaToggle =
  | 'torch'
  | 'thc'
  | 'thcAuto'
  | 'cornerlock'
  | 'voidlock'
  | 'autoVolts'
  | 'mesh'
  | 'ohmicProbe';

export type TorchPulseAction = 'press' | 'release' | 'abort';

/**
 * Senders for the `plasma` command category.
 *
 * Fire-and-forget by design: the backend queues the write for its HAL thread and the
 * resulting pin change comes back as a `plasma.pins.changed` event, so the UI reflects HAL
 * rather than what it hoped HAL would do. Nothing here keeps optimistic local state.
 */
export function usePlasmaCommands() {
  const socket = useAppStore((s) => s.backendWebSocket);

  const send = useCallback(
    (action: string, params?: Record<string, unknown>): boolean => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      socket.send(JSON.stringify(createCommandEnvelope('plasma', action, params ?? {})));
      return true;
    },
    [socket],
  );

  return useMemo(
    () => ({
      getSnapshot: () => send('get_snapshot'),
      setParam: (pin: string, value: number | boolean) => send('set_param', { pin, value }),
      setEnable: (name: PlasmaToggle, enabled: boolean) =>
        send('set_enable', { name, enabled }),
      torchEnable: (enabled: boolean) => send('torch_enable', { enabled }),
      thcEnable: (enabled: boolean) => send('thc_enable', { enabled }),
      heightOverride: (volts: number) => send('height_override', { volts }),
      torchPulse: (action: TorchPulseAction, seconds?: number) =>
        send('torch_pulse', seconds === undefined ? { action } : { action, seconds }),
      getMaterials: () => send('get_materials'),
      selectMaterial: (number: number) => send('select_material', { number }),
      saveMaterial: (number: number, name: string, values: Record<string, number>) =>
        send('save_material', { number, name, values }),
      deleteMaterial: (number: number) => send('delete_material', { number }),
      setDefaultMaterial: (number: number) => send('set_default_material', { number }),
      getParameters: () => send('get_parameters'),
      saveParameters: (values: Record<string, number>) => send('save_parameters', { values }),
      reloadConfig: () => send('reload_config'),
    }),
    [send],
  );
}
