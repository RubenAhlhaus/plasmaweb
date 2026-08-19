import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHomingCommands } from '../useHomingCommands';
import { useAppStore } from '@/store';
import type { LinuxCncStatusRoot } from '@/store/types';
import { TaskMode, TaskState } from '@/store/types';

class MockWebSocket {
  public readyState = WebSocket.OPEN;
  public sentMessages: string[] = [];

  // eslint-disable-next-line class-methods-use-this
  close(): void {
    void 0;
  }

  send(data: string) {
    this.sentMessages.push(data);
  }
}

function setManualMachineOn() {
  const state = useAppStore.getState();
  const currentStatus = state.linuxCncStatus as LinuxCncStatusRoot;
  state.setLinuxCncStatus({
    ...currentStatus,
    machine: {
      ...currentStatus.machine,
      task_mode: TaskMode.MODE_MANUAL,
      task_state: TaskState.STATE_ON,
      error: false,
    },
  });
}

describe('useHomingCommands', () => {
  afterEach(() => {
    useAppStore.getState().setBackendWebSocket(null);
    useAppStore.getState().setLinuxCncStatus({
      machine: {},
      motion: {},
      io: {},
      program: {},
      overrides: {},
      spindle: [],
      joints: [],
      axes: [],
      tools: {},
    });
  });

  it('sends motion.home with joint -1 for Home All', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    setManualMachineOn();

    const { result } = renderHook(() => useHomingCommands());

    act(() => {
      result.current.handleHoming('all', 'home');
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: 'command',
      category: 'motion',
      action: 'home',
      params: { joint: -1 },
    });
    expect(typeof payload.commandId).toBe('string');
  });

  it('sends motion.unhome with joint -1 for Unhome All', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    setManualMachineOn();

    const { result } = renderHook(() => useHomingCommands());

    act(() => {
      result.current.handleHoming('all', 'unhome');
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: 'command',
      category: 'motion',
      action: 'unhome',
      params: { joint: -1 },
    });
  });

  it('defaults action to home when omitted', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    setManualMachineOn();

    const { result } = renderHook(() => useHomingCommands());

    act(() => {
      result.current.handleHoming('z');
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({
      action: 'home',
      params: { joint: 2 },
    });
  });

  it('does not send when machine is not in manual mode', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    const state = useAppStore.getState();
    const currentStatus = state.linuxCncStatus as LinuxCncStatusRoot;
    state.setLinuxCncStatus({
      ...currentStatus,
      machine: {
        ...currentStatus.machine,
        task_mode: TaskMode.MODE_MDI,
        task_state: TaskState.STATE_ON,
        error: false,
      },
    });

    const { result } = renderHook(() => useHomingCommands());

    act(() => {
      result.current.handleHoming('all', 'unhome');
    });

    expect(mockWs.sentMessages).toHaveLength(0);
  });
});
