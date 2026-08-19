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

