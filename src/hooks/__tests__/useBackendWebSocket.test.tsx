import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { useBackendWebSocket } from '../useBackendWebSocket';
import { useAppStore } from '@/store';
import { COORDINATE_UI_FLUSH_MS } from '@/lib/coordinateUpdateBatcher';
import { eventBus } from '@/eventBus';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  public readyState = WebSocket.OPEN;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: (() => void) | null = null;

  public sentMessages: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    if (this.onclose) {
      this.onclose();
    }
  }
}

function TestComponent() {
  useBackendWebSocket();
  return null;
}

describe('useBackendWebSocket', () => {
  const OriginalWebSocket = global.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    // @ts-expect-error override global WebSocket for tests
    global.WebSocket = MockWebSocket;
    MockWebSocket.instances = [];
    useAppStore.getState().setBackendWebSocketUrl('ws://127.0.0.1:8765/ws');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    global.WebSocket = OriginalWebSocket;
    useAppStore.getState().setBackendWebSocket(null);
    useAppStore.getState().setBackendWebSocketUrl(null);
    useAppStore.getState().setLastWsCommandResult(null);
    useAppStore.getState().clearErrorToasts();
  });

  it('creates a WebSocket with the expected URL and updates connectionStatus on open', () => {
    render(<TestComponent />);

    expect(MockWebSocket.instances).toHaveLength(1);
    const instance = MockWebSocket.instances[0];
    expect(instance.url).toBe('ws://127.0.0.1:8765/ws');

    // Simulate onopen
    instance.onopen?.();

    const state = useAppStore.getState();
    expect(state.connectionStatus).toBe('connected');
    expect(state.backendWebSocket).toBe(instance as unknown as WebSocket);
    expect(instance.sentMessages).toHaveLength(1);
    const firstSent = JSON.parse(instance.sentMessages[0]);
    expect(firstSent.category).toBe('machine');
    expect(firstSent.action).toBe('get_ini_config');
  });

  it('applies linuxcnc_status messages to store and coordinates', () => {
    render(<TestComponent />);

    const instance = MockWebSocket.instances[0];

    const payload = {
      type: 'linuxcnc_status',
      payload: {
        machine: {
          task_state: 3,
        },
        motion: {
          actual_position: [1, 2, 3],
        },
      },
    };

    instance.onmessage?.({ data: JSON.stringify(payload) });
    vi.advanceTimersByTime(COORDINATE_UI_FLUSH_MS);

    const state = useAppStore.getState();

    expect(state.linuxCncStatus.machine.task_state).toBe(3);
    expect(state.coordinates).toMatchObject({
      x: 1,
      y: 2,
      z: 3,
    });
  });

  it('applies motion.coordinates.changed machine_event messages to coordinates', () => {
    render(<TestComponent />);

    const instance = MockWebSocket.instances[0];

    const payload = {
      type: 'machine_event',
      event: 'motion.coordinates.changed',
      payload: {
        coordinates: { x: 4.5, y: -2.25, z: 10 },
      },
    };

    instance.onmessage?.({ data: JSON.stringify(payload) });
    vi.advanceTimersByTime(COORDINATE_UI_FLUSH_MS);

    const state = useAppStore.getState();
    expect(state.coordinates).toMatchObject({
      x: 4.5,
      y: -2.25,
      z: 10,
    });
  });

  it('applies machine.ini_config.loaded event to iniRuntimeConfig store', () => {
    render(<TestComponent />);

    const instance = MockWebSocket.instances[0];
    const payload = {
      type: 'machine_event',
      event: 'machine.ini_config.loaded',
      payload: {
        jog_increments_spec: '2 mm, 1 mm',
        linear_units: 'mm',
        angular_units: 'degree',
        program_units: 2,
        source: 'ini',
      },
    };

    instance.onmessage?.({ data: JSON.stringify(payload) });
    const state = useAppStore.getState();
    expect(state.iniRuntimeConfig.jog_increments_spec).toBe('2 mm, 1 mm');
    expect(state.iniRuntimeConfig.linear_units).toBe('mm');
    expect(state.iniRuntimeConfig.source).toBe('ini');
  });

  it('records lastWsCommandResult for command_result messages', () => {
    render(<TestComponent />);

    const instance = MockWebSocket.instances[0];

    const payload = {
      type: 'command_result',
      protocolVersion: 1,
      commandId: 'test-cmd-id',
      ok: false,
      error: { code: 'file_not_found', message: 'Not a readable file: /x.ngc' },
    };

    instance.onmessage?.({ data: JSON.stringify(payload) });

    const state = useAppStore.getState();
    expect(state.lastWsCommandResult).toEqual({
      commandId: 'test-cmd-id',
      ok: false,
      error: { code: 'file_not_found', message: 'Not a readable file: /x.ngc' },
    });
    expect(state.commandResultHistory).toEqual([
      {
        commandId: 'test-cmd-id',
        ok: false,
        error: { code: 'file_not_found', message: 'Not a readable file: /x.ngc' },
      },
    ]);
    expect(state.errorToasts[0]).toMatchObject({
      message: 'Not a readable file: /x.ngc',
      kind: 'file_not_found',
    });
  });

  it('does not toast command_result failures for category program (local UI)', () => {
    render(<TestComponent />);

    const instance = MockWebSocket.instances[0];

    const payload = {
      type: 'command_result',
      protocolVersion: 1,
      commandId: 'prog-open-1',
      category: 'program',
      action: 'open',
      ok: false,
      error: {
        code: 'outside_program_prefix',
        message: 'File path is not under [DISPLAY] PROGRAM_PREFIX in the LinuxCNC INI.',
      },
    };

    instance.onmessage?.({ data: JSON.stringify(payload) });

    const state = useAppStore.getState();
    expect(state.lastWsCommandResult?.category).toBe('program');
    expect(state.lastWsCommandResult?.action).toBe('open');
    expect(state.errorToasts).toHaveLength(0);
  });

  it('does not toast command_result failures for hal.set_jog_wheel_scale', () => {
    render(<TestComponent />);

    const instance = MockWebSocket.instances[0];

    const payload = {
      type: 'command_result',
      protocolVersion: 1,
      commandId: 'jog-scale-1',
      category: 'hal',
      action: 'set_jog_wheel_scale',
      ok: false,
      error: {
        code: 'hal_set_nonzero',
        message: "pin or parameter 'axis.y.jog-scale' not found",
      },
    };

    instance.onmessage?.({ data: JSON.stringify(payload) });

    const state = useAppStore.getState();
    expect(state.lastWsCommandResult?.action).toBe('set_jog_wheel_scale');
    expect(state.errorToasts).toHaveLength(0);
  });

  it('does not toast command_in_progress for program.auto (feed-0 pause coalesce)', () => {
    render(<TestComponent />);

    const instance = MockWebSocket.instances[0];

    const payload = {
      type: 'command_result',
      protocolVersion: 1,
      commandId: 'auto-pause-1',
      category: 'program',
      action: 'auto',
      ok: false,
      error: {
        code: 'command_in_progress',
        message: 'Cannot run AUTO command while another command is being executed.',
      },
    };

    instance.onmessage?.({ data: JSON.stringify(payload) });

    const state = useAppStore.getState();
    expect(state.lastWsCommandResult?.action).toBe('auto');
    expect(state.errorToasts).toHaveLength(0);
  });

  it('shows an error toast for linuxcnc_error messages', () => {
    render(<TestComponent />);

    const instance = MockWebSocket.instances[0];

    const payload = {
      type: 'linuxcnc_error',
      kind: 'nml_error',
      message: 'spindle overcurrent',
    };

    instance.onmessage?.({ data: JSON.stringify(payload) });

    const state = useAppStore.getState();
    expect(state.errorToasts[0]).toMatchObject({
      message: 'spindle overcurrent',
      kind: 'nml_error',
    });
  });

  it('dispatches virtual sidebar actions on panel.sidebar.trigger', () => {
    const received: Array<{ source: string }> = [];
    const unsub = eventBus.subscribe('ui.homing.openDialog', (payload) => {
      received.push(payload);
    });

    render(<TestComponent />);

    const instance = MockWebSocket.instances[0];
    instance.onmessage?.({
      data: JSON.stringify({
        type: 'machine_event',
        event: 'panel.sidebar.trigger',
        payload: { buttonId: 2 },
      }),
    });

    expect(received).toEqual([{ source: 'hal' }]);
    unsub();
  });

  it('sets connectionStatus to disconnected and clears backendWebSocket on close', () => {
    render(<TestComponent />);
    const instance = MockWebSocket.instances[0];

    instance.onclose?.();

    const state = useAppStore.getState();
    expect(state.connectionStatus).toBe('disconnected');
    expect(state.backendWebSocket).toBeNull();
  });
});

