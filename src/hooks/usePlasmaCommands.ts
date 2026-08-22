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

/** What the sheet alignment sets the origin by: the alignment laser, or a camera. */
export type PlasmaPeripheral = 'laser' | 'camera';

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

  /**
   * Same, but hands back the `commandId` so the caller can wait for the ack.
   *
   * Most plasma commands are fire-and-forget because the pin diff is the answer. The preview
   * and run-from-line are not: their answer only exists in the result, so the caller needs to
   * be able to recognise it.
   */
  const sendForResult = useCallback(
    (action: string, params?: Record<string, unknown>): string | null => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return null;
      }
      const envelope = createCommandEnvelope('plasma', action, params ?? {});
      socket.send(JSON.stringify(envelope));
      return envelope.commandId;
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
      probeTest: (seconds: number) => send('probe_test', { seconds }),
      userButtons: () => sendForResult('get_user_buttons'),
      userButton: (number: number, pressed = true) =>
        sendForResult('user_button', { number, pressed }),
      singleCut: (xLength: number, yLength: number) =>
        send('single_cut', { xLength, yLength }),
      saveOffsetProbing: (values: Record<string, number>) =>
        send('save_offset_probing', { values }),
      getAlignment: () => sendForResult('get_alignment'),
      saveGuiOption: (name: string, enabled: boolean) =>
        send('save_gui_option', { name, enabled }),
      machineLog: (params?: { limit?: number; severity?: 'critical' | 'warning' | 'info' }) =>
        sendForResult('get_machine_log', params ?? {}),
      saveMachineLog: () => sendForResult('save_machine_log'),
      /** One press of the LASER → MARK EDGE → SET ORIGIN routine. */
      alignmentPress: (kind: PlasmaPeripheral = 'laser') =>
        sendForResult('alignment_press', { kind }),
      alignmentCancel: () => send('alignment_cancel'),
      savePeripheralOffset: (kind: PlasmaPeripheral, values: Record<string, number>) =>
        send('save_peripheral_offset', { kind, values }),
      ohmicTest: (enabled: boolean) => send('ohmic_test', { enabled }),
      consumableChange: (enabled: boolean) => send('consumable_change', { enabled }),
      cutRecovery: (params: {
        action: 'move' | 'offset' | 'laser' | 'cancel';
        direction?: number;
        speedPercent?: number;
        x?: number;
        y?: number;
      }) => send('cut_recovery', { ...params }),
      getMaterials: () => send('get_materials'),
      selectMaterial: (number: number) => send('select_material', { number }),
      saveMaterial: (number: number, name: string, values: Record<string, number>) =>
        send('save_material', { number, name, values }),
      deleteMaterial: (number: number) => send('delete_material', { number }),
      setDefaultMaterial: (number: number) => send('set_default_material', { number }),
      getParameters: () => send('get_parameters'),
      saveParameters: (values: Record<string, number>) => send('save_parameters', { values }),
      reloadConfig: () => send('reload_config'),
      toolpath: (path?: string) => sendForResult('toolpath', path ? { path } : {}),
      /** Preview program text that is not saved anywhere yet (a conversational shape). */
      toolpathFromGcode: (gcode: string) => sendForResult('toolpath', { gcode }),
      conversationalShapes: () => sendForResult('conversational_shapes'),
      conversational: (params: {
        shape: string;
        params: Record<string, unknown>;
        job?: string;
        save?: boolean;
      }) => sendForResult('conversational', { ...params }),
      conversationalLine: (params: {
        segments: Array<Record<string, unknown>>;
        startX?: number;
        startY?: number;
        job?: string;
        save?: boolean;
      }) => sendForResult('conversational_line', { ...params }),
      conversationalSettings: () => sendForResult('get_conversational_settings'),
      saveConversationalSettings: (values: Record<string, unknown>) =>
        sendForResult('save_conversational_settings', { values }),
      conversationalBlock: (params: {
        params: Record<string, unknown>;
        job?: string;
        save?: boolean;
      }) => sendForResult('conversational_block', { ...params }),
      runFromLine: (params: {
        line: number;
        runType?: 'here' | 'cut';
        leadinLength?: number;
        leadinAngle?: number;
        load?: boolean;
      }) => sendForResult('run_from_line', { ...params }),
    }),
    [send, sendForResult],
  );
}
