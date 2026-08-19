import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMachineEventBridge, OVERRIDE_HOTKEY_COALESCE_MS } from '../useMachineEventBridge';
import { eventBus } from '@/eventBus';
import { OVERRIDE_MIN_FACTOR } from '@/lib/feedOverridePresetAction';
import { useAppStore } from '@/store';
import { InterpState, TaskMode, TaskState } from '@/store/types';
import { MockWebSocket } from './mockWebSocket';

describe('useMachineEventBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    useAppStore.getState().setBackendWebSocket(null);
    useAppStore.getState().setLinuxCncStatus({ machine: {}, io: {} });
    useAppStore.getState().setLastWsCommandResult(null);
  });

  it('subscribes on mount and cleans up on unmount without sending commands', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);

    const { unmount } = renderHook(() => useMachineEventBridge());

    expect(mockWs.sentMessages).toHaveLength(0);
    unmount();
  });

  it('sends machine.flood on when ui.flood.toggle is published and flood is off', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setLinuxCncStatus({
      machine: { task_state: TaskState.STATE_ON },
      io: { flood: 0 },
    });

    renderHook(() => useMachineEventBridge());

    act(() => {
      eventBus.publish('ui.flood.toggle', { source: 'virtualSidebar' });
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: 'command',
      category: 'machine',
      action: 'flood',
    });
    expect((payload.params as Record<string, unknown>).on).toBe(true);
  });

  it('sends machine.flood off when ui.flood.toggle is published and flood is on', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setLinuxCncStatus({
      machine: { task_state: TaskState.STATE_ON },
      io: { flood: 1 },
    });

    renderHook(() => useMachineEventBridge());

    act(() => {
      eventBus.publish('ui.flood.toggle', { source: 'virtualSidebar' });
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect((payload.params as Record<string, unknown>).on).toBe(false);
  });

  it('does not send machine.flood when machine is OFF', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setLinuxCncStatus({
      machine: { task_state: TaskState.STATE_OFF },
      io: { flood: 0 },
    });

    renderHook(() => useMachineEventBridge());

    act(() => {
      eventBus.publish('ui.flood.toggle', { source: 'virtualSidebar' });
    });

    expect(mockWs.sentMessages).toHaveLength(0);
  });

  it('does not send machine.flood when machine is in ESTOP', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setLinuxCncStatus({
      machine: { task_state: TaskState.STATE_ESTOP },
      io: { flood: 0 },
    });

    renderHook(() => useMachineEventBridge());

    act(() => {
      eventBus.publish('ui.flood.toggle', { source: 'virtualSidebar' });
    });

    expect(mockWs.sentMessages).toHaveLength(0);
  });

  it('sends machine.spindle when ui.spindle.direction is published', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);

    renderHook(() => useMachineEventBridge());

    act(() => {
      eventBus.publish('ui.spindle.direction', {
        direction: 'reverse',
        source: 'virtualSidebar',
      });
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: 'command',
      category: 'machine',
      action: 'spindle',
    });
    expect((payload.params as Record<string, unknown>).direction).toBe('reverse');
  });

  it('sends hal.softkey_pulse when ui.hal.softkey is published', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);

    renderHook(() => useMachineEventBridge());

    act(() => {
      eventBus.publish('ui.hal.softkey', { slot: 15, source: 'virtualSidebar' });
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: 'command',
      category: 'hal',
      action: 'softkey_pulse',
    });
    expect((payload.params as Record<string, unknown>).slot).toBe(15);
  });

  it('sends machine.feed_override when ui.feed.setOverride is published', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);

    renderHook(() => useMachineEventBridge());

    act(() => {
      eventBus.publish('ui.feed.setOverride', { percent: 80, source: 'hotkey' });
      vi.advanceTimersByTime(OVERRIDE_HOTKEY_COALESCE_MS);
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: 'command',
      category: 'machine',
      action: 'feed_override',
    });
    expect((payload.params as Record<string, unknown>).factor).toBe(0.8);
  });

  it('coalesces rapid feed override presets to the latest percent', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);

    renderHook(() => useMachineEventBridge());

    act(() => {
      eventBus.publish('ui.feed.setOverride', { percent: 50, source: 'hotkey' });
      eventBus.publish('ui.feed.setOverride', { percent: 80, source: 'hotkey' });
      eventBus.publish('ui.feed.setOverride', { percent: 100, source: 'hotkey' });
      vi.advanceTimersByTime(OVERRIDE_HOTKEY_COALESCE_MS);
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect((payload.params as Record<string, unknown>).factor).toBe(1);
  });

  it('sends machine.spindle_override when ui.spindle.setOverride is published', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);

    renderHook(() => useMachineEventBridge());

    act(() => {
      eventBus.publish('ui.spindle.setOverride', { percent: 125, source: 'hotkey' });
      vi.advanceTimersByTime(OVERRIDE_HOTKEY_COALESCE_MS);
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: 'command',
      category: 'machine',
      action: 'spindle_override',
    });
    expect(payload.params).toEqual({ factor: 1.25, spindle: 0 });
  });

  it('clamps spindle override 0% to the LinuxCNC minimum factor', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);

    renderHook(() => useMachineEventBridge());

    act(() => {
      eventBus.publish('ui.spindle.setOverride', { percent: 0, source: 'hotkey' });
      vi.advanceTimersByTime(OVERRIDE_HOTKEY_COALESCE_MS);
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    expect(JSON.parse(mockWs.sentMessages[0])).toMatchObject({
      action: 'spindle_override',
      params: { factor: OVERRIDE_MIN_FACTOR, spindle: 0 },
    });
  });

  it('clamps feed override 0% to ~1% when no program is running', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setLinuxCncStatus({
      machine: { task_mode: TaskMode.MODE_MANUAL },
      program: { interp_state: InterpState.INTERP_IDLE },
    });

    renderHook(() => useMachineEventBridge());

    act(() => {
      eventBus.publish('ui.feed.setOverride', { percent: 0, source: 'hotkey' });
      vi.advanceTimersByTime(OVERRIDE_HOTKEY_COALESCE_MS);
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({
      category: 'machine',
      action: 'feed_override',
    });
    expect((payload.params as Record<string, unknown>).factor).toBe(OVERRIDE_MIN_FACTOR);
  });

  it('ignores feed override >100% after feed preset 0% (encoder wrap)', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setLinuxCncStatus({
      machine: { task_mode: TaskMode.MODE_MANUAL },
      program: { interp_state: InterpState.INTERP_IDLE },
    });

    renderHook(() => useMachineEventBridge());

    act(() => {
      eventBus.publish('ui.feed.setOverride', { percent: 0, source: 'hotkey' });
      vi.advanceTimersByTime(OVERRIDE_HOTKEY_COALESCE_MS);
    });
    expect(mockWs.sentMessages).toHaveLength(1);

    act(() => {
      eventBus.publish('ui.feed.setOverride', { percent: 200, source: 'hotkey' });
      vi.advanceTimersByTime(OVERRIDE_HOTKEY_COALESCE_MS);
    });
    expect(mockWs.sentMessages).toHaveLength(1);

    act(() => {
      eventBus.publish('ui.feed.setOverride', { percent: 100, source: 'hotkey' });
      vi.advanceTimersByTime(OVERRIDE_HOTKEY_COALESCE_MS);
    });
    expect(mockWs.sentMessages).toHaveLength(2);
    expect(JSON.parse(mockWs.sentMessages[1])).toMatchObject({
      action: 'feed_override',
      params: { factor: 1 },
    });

    act(() => {
      eventBus.publish('ui.feed.setOverride', { percent: 200, source: 'hotkey' });
      vi.advanceTimersByTime(OVERRIDE_HOTKEY_COALESCE_MS);
    });
    expect(mockWs.sentMessages).toHaveLength(3);
    expect(JSON.parse(mockWs.sentMessages[2])).toMatchObject({
      action: 'feed_override',
      params: { factor: 2 },
    });
  });

  it('ignores feed override >100% while feed-0 pause ownership is held', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setLinuxCncStatus({
      machine: { task_mode: TaskMode.MODE_AUTO },
      program: { interp_state: InterpState.INTERP_WAITING },
      overrides: { feedrate: 1 },
    });

    renderHook(() => useMachineEventBridge());

    act(() => {
      eventBus.publish('ui.feed.setOverride', { percent: 0, source: 'hotkey' });
      vi.advanceTimersByTime(OVERRIDE_HOTKEY_COALESCE_MS);
    });
    expect(mockWs.sentMessages).toHaveLength(1);
    expect(JSON.parse(mockWs.sentMessages[0])).toMatchObject({
      category: 'program',
      action: 'auto',
      params: { command: 'pause' },
    });

    act(() => {
      useAppStore.getState().setLinuxCncStatus({
        machine: { task_mode: TaskMode.MODE_AUTO },
        program: { interp_state: InterpState.INTERP_PAUSED },
        overrides: { feedrate: 1 },
      });
    });
    expect(mockWs.sentMessages).toHaveLength(1);

    act(() => {
      eventBus.publish('ui.feed.setOverride', { percent: 200, source: 'hotkey' });
      vi.advanceTimersByTime(OVERRIDE_HOTKEY_COALESCE_MS);
    });
    expect(mockWs.sentMessages).toHaveLength(1);
  });

  it('pauses a running program on feed override 0% and resumes after pause is confirmed', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setLinuxCncStatus({
      machine: { task_mode: TaskMode.MODE_AUTO },
      program: { interp_state: InterpState.INTERP_WAITING },
    });

    renderHook(() => useMachineEventBridge());

    act(() => {
      eventBus.publish('ui.feed.setOverride', { percent: 0, source: 'hotkey' });
      vi.advanceTimersByTime(OVERRIDE_HOTKEY_COALESCE_MS);
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    expect(JSON.parse(mockWs.sentMessages[0])).toMatchObject({
      category: 'program',
      action: 'auto',
      params: { command: 'pause' },
    });

    act(() => {
      eventBus.publish('ui.feed.setOverride', { percent: 50, source: 'hotkey' });
      vi.advanceTimersByTime(OVERRIDE_HOTKEY_COALESCE_MS);
    });

    // Override applied; resume deferred until INTERP_PAUSED
    expect(mockWs.sentMessages).toHaveLength(2);
    expect(JSON.parse(mockWs.sentMessages[1])).toMatchObject({
      category: 'machine',
      action: 'feed_override',
      params: { factor: 0.5 },
    });

    act(() => {
      useAppStore.getState().setLinuxCncStatus({
        machine: { task_mode: TaskMode.MODE_AUTO },
        program: { interp_state: InterpState.INTERP_PAUSED },
      });
    });

    expect(mockWs.sentMessages).toHaveLength(4);
    expect(JSON.parse(mockWs.sentMessages[2])).toMatchObject({
      category: 'machine',
      action: 'feed_override',
      params: { factor: 0.5 },
    });
    expect(JSON.parse(mockWs.sentMessages[3])).toMatchObject({
      category: 'program',
      action: 'auto',
      params: { command: 'resume' },
    });
  });

  it('does not auto-resume after a manual pause when setting feed override > 0', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setLinuxCncStatus({
      machine: { task_mode: TaskMode.MODE_AUTO },
      program: { interp_state: InterpState.INTERP_PAUSED },
    });

    renderHook(() => useMachineEventBridge());

    act(() => {
      eventBus.publish('ui.feed.setOverride', { percent: 80, source: 'hotkey' });
      vi.advanceTimersByTime(OVERRIDE_HOTKEY_COALESCE_MS);
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    expect(JSON.parse(mockWs.sentMessages[0])).toMatchObject({
      category: 'machine',
      action: 'feed_override',
      params: { factor: 0.8 },
    });
  });

  it('clears pending feed-0 pause ownership when the pause command fails', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setLinuxCncStatus({
      machine: { task_mode: TaskMode.MODE_AUTO },
      program: { interp_state: InterpState.INTERP_READING },
    });

    renderHook(() => useMachineEventBridge());

    act(() => {
      eventBus.publish('ui.feed.setOverride', { percent: 0, source: 'hotkey' });
      vi.advanceTimersByTime(OVERRIDE_HOTKEY_COALESCE_MS);
    });

    const pauseCmd = JSON.parse(mockWs.sentMessages[0]) as {
      commandId: string;
    };

    act(() => {
      useAppStore.getState().setLastWsCommandResult({
        commandId: pauseCmd.commandId,
        ok: false,
        category: 'program',
        action: 'auto',
        error: { code: 'not_running', message: 'not running' },
      });
      useAppStore.getState().setLinuxCncStatus({
        machine: { task_mode: TaskMode.MODE_AUTO },
        program: { interp_state: InterpState.INTERP_PAUSED },
      });
      eventBus.publish('ui.feed.setOverride', { percent: 50, source: 'hotkey' });
      vi.advanceTimersByTime(OVERRIDE_HOTKEY_COALESCE_MS);
    });

    // Ownership cleared on failed pause → only override, no resume
    const actions = mockWs.sentMessages.map(
      (raw) => (JSON.parse(raw) as { action: string; params?: { command?: string } }).action,
    );
    expect(actions.filter((a) => a === 'auto')).toEqual(['auto']);
    expect(JSON.parse(mockWs.sentMessages.at(-1)!)).toMatchObject({
      action: 'feed_override',
      params: { factor: 0.5 },
    });
  });
});
