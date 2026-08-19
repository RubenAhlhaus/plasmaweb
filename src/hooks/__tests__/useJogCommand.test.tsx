import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useJogCommand, useJogStopCommand } from '../useJogCommand';
import { useAppStore } from '@/store';
import type { LinuxCncStatusRoot } from '@/store/types';

class MockWebSocket {
  public readyState = WebSocket.OPEN;
  public sentMessages: string[] = [];

  close() {
    return undefined;
  }

  send(data: string) {
    this.sentMessages.push(data);
  }
}

describe('useJogCommand', () => {
  afterEach(() => {
    useAppStore.getState().setBackendWebSocket(null);
  });

  it('sends a motion.jog command for an incremental X+ jog using store jog settings', () => {
    const mockWs = new MockWebSocket() as unknown as WebSocket;
    const state = useAppStore.getState();
    state.setBackendWebSocket(mockWs);
    const currentStatus = state.linuxCncStatus as LinuxCncStatusRoot;
    state.setLinuxCncStatus({
      ...currentStatus,
      motion: {
        ...currentStatus.motion,
        homed: [1, 1, 1],
      },
    });
    state.setJogMode('incremental');
    state.setSelectedJogIncrement(1.5);
    state.setJogVelocityMmPerMin(120);

    const { result } = renderHook(() => useJogCommand());

    act(() => {
      result.current({ axis: 'x', direction: 'positive' });
    });

    expect((mockWs as unknown as MockWebSocket).sentMessages).toHaveLength(1);
    const payload = JSON.parse(
      (mockWs as unknown as MockWebSocket).sentMessages[0],
    ) as Record<string, unknown>;

    expect(payload).toMatchObject({
      type: 'command',
      category: 'motion',
      action: 'jog',
    });

    const params = payload.params as Record<string, unknown>;
    expect(params).toMatchObject({
      jointMode: false,
      index: 0,
      mode: 'increment',
      distance: 1.5,
      velocity: 120,
    });
  });

  it('sends a motion.jog command for a continuous Z- jog ohne distance', () => {
    const mockWs = new MockWebSocket() as unknown as WebSocket;
    const state = useAppStore.getState();
    state.setBackendWebSocket(mockWs);
    const currentStatus = state.linuxCncStatus as LinuxCncStatusRoot;
    state.setLinuxCncStatus({
      ...currentStatus,
      motion: {
        ...currentStatus.motion,
        homed: [1, 1, 1],
      },
    });
    state.setJogMode('continuous');
    state.setJogVelocityMmPerMin(300);

    const { result } = renderHook(() => useJogCommand());

    act(() => {
      result.current({ axis: 'z', direction: 'negative' });
    });

    expect((mockWs as unknown as MockWebSocket).sentMessages).toHaveLength(1);
    const payload = JSON.parse(
      (mockWs as unknown as MockWebSocket).sentMessages[0],
    ) as Record<string, unknown>;

    expect(payload).toMatchObject({
      type: 'command',
      category: 'motion',
      action: 'jog',
    });

    const params = payload.params as Record<string, unknown>;
    expect(params).toMatchObject({
      jointMode: false,
      index: 2,
      mode: 'continuous',
      velocity: -300,
    });
    expect(params).not.toHaveProperty('distance');
  });

  it('sends motion.jog_stop in continuous mode for axis stop', () => {
    const mockWs = new MockWebSocket() as unknown as WebSocket;
    const state = useAppStore.getState();
    state.setBackendWebSocket(mockWs);
    const currentStatus = state.linuxCncStatus as LinuxCncStatusRoot;
    state.setLinuxCncStatus({
      ...currentStatus,
      motion: {
        ...currentStatus.motion,
        homed: [1, 1, 1],
      },
    });
    state.setJogMode('continuous');

    const { result } = renderHook(() => useJogStopCommand());

    act(() => {
      result.current({ axis: 'z' });
    });

    expect((mockWs as unknown as MockWebSocket).sentMessages).toHaveLength(1);
    const payload = JSON.parse(
      (mockWs as unknown as MockWebSocket).sentMessages[0],
    ) as Record<string, unknown>;

    expect(payload).toMatchObject({
      type: 'command',
      category: 'motion',
      action: 'jog_stop',
    });

    const params = payload.params as Record<string, unknown>;
    expect(params).toMatchObject({
      jointMode: false,
      index: 2,
    });
  });

  it('does not send motion.jog_stop in incremental mode', () => {
    const mockWs = new MockWebSocket() as unknown as WebSocket;
    const state = useAppStore.getState();
    state.setBackendWebSocket(mockWs);
    state.setJogMode('incremental');

    const { result } = renderHook(() => useJogStopCommand());

    act(() => {
      result.current({ axis: 'x' });
    });

    expect((mockWs as unknown as MockWebSocket).sentMessages).toHaveLength(0);
  });

  it('does not send motion.jog for an unhomed axis before the dialog was shown', () => {
    const mockWs = new MockWebSocket() as unknown as WebSocket;
    const state = useAppStore.getState();
    state.setBackendWebSocket(mockWs);
    state.setJogMode('incremental');
    state.setSelectedJogIncrement(1.0);

    const currentStatus = state.linuxCncStatus as LinuxCncStatusRoot;
    state.setLinuxCncStatus({
      ...currentStatus,
      motion: {
        ...currentStatus.motion,
        homed: [0, 0, 0],
      },
    });

    const { result } = renderHook(() => useJogCommand());

    act(() => {
      result.current({ axis: 'x', direction: 'positive' });
    });

    expect((mockWs as unknown as MockWebSocket).sentMessages).toHaveLength(0);
  });

  it('sends motion.jog in jointMode for an unhomed axis after the dialog flag was set', () => {
    const mockWs = new MockWebSocket() as unknown as WebSocket;
    const state = useAppStore.getState();
    state.setBackendWebSocket(mockWs);
    state.setJogMode('incremental');
    state.setSelectedJogIncrement(2.0);

    const currentStatus = state.linuxCncStatus as LinuxCncStatusRoot;
    state.setLinuxCncStatus({
      ...currentStatus,
      motion: {
        ...currentStatus.motion,
        homed: [0, 0, 0],
      },
    });
    state.setUnhomedJogDialogShownForAxis('x');

    const { result } = renderHook(() => useJogCommand());

    act(() => {
      result.current({ axis: 'x', direction: 'positive' });
    });

    expect((mockWs as unknown as MockWebSocket).sentMessages).toHaveLength(1);
    const payload = JSON.parse(
      (mockWs as unknown as MockWebSocket).sentMessages[0],
    ) as Record<string, unknown>;

    expect(payload).toMatchObject({
      type: 'command',
      category: 'motion',
      action: 'jog',
    });

    const params = payload.params as Record<string, unknown>;
    expect(params).toMatchObject({
      jointMode: true,
      index: 0,
      mode: 'increment',
      distance: 2.0,
    });
  });
});


describe('useJogCommand on an XYYZ gantry', () => {
  // trivkins coordinates=xyyz — joint 0 = X, joints 1+2 = Y, joint 3 = Z.
  function setGantryConfig() {
    useAppStore.getState().setIniRuntimeConfig({
      kins_kinematics: 'trivkins coordinates=xyyz',
      joint_home_sequences: ['1', '-2', '-2', '0'],
    });
  }

  function sentParams(ws: WebSocket): Record<string, unknown> {
    const messages = (ws as unknown as MockWebSocket).sentMessages;
    const payload = JSON.parse(messages[0]) as Record<string, unknown>;
    return payload.params as Record<string, unknown>;
  }

  afterEach(() => {
    useAppStore.getState().setBackendWebSocket(null);
    useAppStore.getState().setIniRuntimeConfig({
      kins_kinematics: null,
      kins_coordinates: null,
      joint_home_sequences: [],
    });
    useAppStore.setState({ shownUnhomedJogDialogAxes: {} });
  });

  it('jogs unhomed Z as joint 3, not joint 2', () => {
    const mockWs = new MockWebSocket() as unknown as WebSocket;
    const state = useAppStore.getState();
    state.setBackendWebSocket(mockWs);
    setGantryConfig();
    const currentStatus = state.linuxCncStatus as LinuxCncStatusRoot;
    state.setLinuxCncStatus({
      ...currentStatus,
      motion: { ...currentStatus.motion, homed: [0, 0, 0, 0] },
      joints: [],
    });
    // Joint-mode jogging requires the user to have confirmed the unhomed dialog.
    useAppStore.setState({ shownUnhomedJogDialogAxes: { z: true } });
    state.setJogMode('continuous');
    state.setJogVelocityMmPerMin(300);

    const { result } = renderHook(() => useJogCommand());

    act(() => {
      result.current({ axis: 'z', direction: 'positive' });
    });

    expect(sentParams(mockWs)).toMatchObject({ jointMode: true, index: 3 });
  });

  it('refuses to joint-jog the synchronised Y axis even after confirmation', () => {
    const mockWs = new MockWebSocket() as unknown as WebSocket;
    const state = useAppStore.getState();
    state.setBackendWebSocket(mockWs);
    setGantryConfig();
    const currentStatus = state.linuxCncStatus as LinuxCncStatusRoot;
    state.setLinuxCncStatus({
      ...currentStatus,
      motion: { ...currentStatus.motion, homed: [0, 0, 0, 0] },
      joints: [],
    });
    useAppStore.setState({ shownUnhomedJogDialogAxes: { y: true } });
    state.setJogMode('continuous');

    const { result } = renderHook(() => useJogCommand());

    act(() => {
      result.current({ axis: 'y', direction: 'positive' });
    });

    expect((mockWs as unknown as MockWebSocket).sentMessages).toHaveLength(0);
  });

  it('still jogs a homed axis by axis letter, not by joint', () => {
    const mockWs = new MockWebSocket() as unknown as WebSocket;
    const state = useAppStore.getState();
    state.setBackendWebSocket(mockWs);
    setGantryConfig();
    const currentStatus = state.linuxCncStatus as LinuxCncStatusRoot;
    state.setLinuxCncStatus({
      ...currentStatus,
      motion: { ...currentStatus.motion, homed: [1, 1, 1, 1] },
      joints: [],
    });
    state.setJogMode('continuous');

    const { result } = renderHook(() => useJogCommand());

    act(() => {
      result.current({ axis: 'z', direction: 'positive' });
    });

    expect(sentParams(mockWs)).toMatchObject({ jointMode: false, index: 2 });
  });

  it('treats Z as unhomed while only the joints below it are homed', () => {
    const mockWs = new MockWebSocket() as unknown as WebSocket;
    const state = useAppStore.getState();
    state.setBackendWebSocket(mockWs);
    setGantryConfig();
    const currentStatus = state.linuxCncStatus as LinuxCncStatusRoot;
    state.setLinuxCncStatus({
      ...currentStatus,
      motion: { ...currentStatus.motion, homed: [1, 1, 1, 0] },
      joints: [],
    });
    state.setJogMode('continuous');

    const { result } = renderHook(() => useJogCommand());

    act(() => {
      result.current({ axis: 'z', direction: 'positive' });
    });

    // Blocked pending confirmation instead of silently jogging in axis mode.
    expect((mockWs as unknown as MockWebSocket).sentMessages).toHaveLength(0);
  });
});
