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

describe('useHomingCommands on an XYYZ gantry', () => {
  afterEach(() => {
    useAppStore.getState().setIniRuntimeConfig({
      kins_kinematics: null,
      kins_coordinates: null,
      joint_home_sequences: [],
    });
  });

  function sentJoint(ws: WebSocket): unknown {
    const messages = (ws as unknown as MockWebSocket).sentMessages;
    const payload = JSON.parse(messages[0]) as Record<string, unknown>;
    return (payload.params as Record<string, unknown>).joint;
  }

  it('homes Z as joint 3, not joint 2', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setIniRuntimeConfig({
      kins_kinematics: 'trivkins coordinates=xyyz',
    });
    setManualMachineOn();

    const { result } = renderHook(() => useHomingCommands());

    act(() => {
      result.current.handleHoming('z', 'home');
    });

    expect(sentJoint(mockWs as unknown as WebSocket)).toBe(3);
  });

  it('homes the first joint of a duplicated axis and lets LinuxCNC sync the set', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setIniRuntimeConfig({
      kins_kinematics: 'trivkins coordinates=xyyz',
      joint_home_sequences: ['1', '-2', '-2', '0'],
    });
    setManualMachineOn();

    const { result } = renderHook(() => useHomingCommands());

    act(() => {
      result.current.handleHoming('y', 'home');
    });

    expect(sentJoint(mockWs as unknown as WebSocket)).toBe(1);
    expect((mockWs as unknown as MockWebSocket).sentMessages).toHaveLength(1);
  });

  it('sends nothing for an axis the machine does not have', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setIniRuntimeConfig({ kins_kinematics: 'trivkins coordinates=xz' });
    setManualMachineOn();

    const { result } = renderHook(() => useHomingCommands());

    act(() => {
      result.current.handleHoming('y', 'home');
    });

    expect((mockWs as unknown as MockWebSocket).sentMessages).toHaveLength(0);
  });

  it('still sends joint -1 for Home All', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setIniRuntimeConfig({
      kins_kinematics: 'trivkins coordinates=xyyz',
    });
    setManualMachineOn();

    const { result } = renderHook(() => useHomingCommands());

    act(() => {
      result.current.handleHoming('all', 'home');
    });

    expect(sentJoint(mockWs as unknown as WebSocket)).toBe(-1);
  });
});
