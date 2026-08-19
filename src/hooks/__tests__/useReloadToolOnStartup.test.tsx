import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReloadToolOnStartup } from '../useReloadToolOnStartup';
import { useAppStore } from '@/store';
import { InterpState, TaskMode, TaskState } from '@/store/types';
import { MockWebSocket } from './mockWebSocket';
import * as userPreferencesApi from '@/lib/userPreferencesApi';

describe('useReloadToolOnStartup', () => {
  beforeEach(() => {
    vi.spyOn(userPreferencesApi, 'saveToolInSpindlePreference').mockResolvedValue(true);
    useAppStore.setState({
      connectionStatus: 'connected',
      toolInSpindlePreference: 5,
      reloadToolOnStartup: true,
      linuxCncStatus: {
        machine: {
          task_state: TaskState.STATE_ON,
          task_mode: TaskMode.MODE_MANUAL,
          error: false,
        },
        program: { interp_state: InterpState.INTERP_IDLE },
        motion: { homed: [0, 0, 0] },
        tools: { tool_in_spindle: 0 },
        joints: [],
        io: {},
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAppStore.getState().setBackendWebSocket(null);
    useAppStore.getState().setLastWsCommandResult(null);
  });

  it('does not wipe saved tool on first runtime observation of 0', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);

    act(() => {
      renderHook(() => useReloadToolOnStartup());
    });

    expect(userPreferencesApi.saveToolInSpindlePreference).not.toHaveBeenCalled();
    expect(useAppStore.getState().toolInSpindlePreference).toBe(5);
  });

  it('persists first runtime tool when prefs are 0 but spindle already has a tool', () => {
    useAppStore.setState({
      toolInSpindlePreference: 0,
      linuxCncStatus: {
        ...useAppStore.getState().linuxCncStatus,
        tools: { tool_in_spindle: 7 },
        motion: { homed: [0, 0, 0] },
      },
    });
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);

    act(() => {
      renderHook(() => useReloadToolOnStartup());
    });

    expect(userPreferencesApi.saveToolInSpindlePreference).toHaveBeenCalledWith(7);
    expect(useAppStore.getState().toolInSpindlePreference).toBe(7);
  });

  it('sends M61 after axes are homed when spindle is empty', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);

    const { rerender } = renderHook(() => useReloadToolOnStartup());

    act(() => {
      useAppStore.getState().setLinuxCncStatus({
        motion: { homed: [1, 1, 1] },
        tools: { tool_in_spindle: 0 },
      });
      rerender();
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as {
      category: string;
      action: string;
      params: { text: string };
      commandId: string;
    };
    expect(payload).toMatchObject({
      category: 'program',
      action: 'mdi',
      params: { text: 'M61 Q5 G43' },
    });

    act(() => {
      useAppStore.getState().setLinuxCncStatus({
        motion: { homed: [1, 1, 1] },
        tools: { tool_in_spindle: 0 },
      });
      rerender();
    });
    expect(mockWs.sentMessages).toHaveLength(1);

    act(() => {
      useAppStore.getState().setLastWsCommandResult({
        commandId: payload.commandId,
        ok: true,
        category: 'program',
        action: 'mdi',
      });
      rerender();
    });
    expect(mockWs.sentMessages).toHaveLength(1);
  });

  it('does not mark session complete when socket is closed', () => {
    const mockWs = new MockWebSocket();
    mockWs.readyState = WebSocket.CLOSED;
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);

    const { rerender } = renderHook(() => useReloadToolOnStartup());

    act(() => {
      useAppStore.getState().setLinuxCncStatus({
        motion: { homed: [1, 1, 1] },
        tools: { tool_in_spindle: 0 },
      });
      rerender();
    });

    expect(mockWs.sentMessages).toHaveLength(0);

    mockWs.readyState = WebSocket.OPEN;
    act(() => {
      useAppStore.getState().setConnectionStatus('connected');
      useAppStore.getState().setLinuxCncStatus({
        motion: { homed: [1, 1, 1] },
        tools: { tool_in_spindle: 0 },
        program: { interp_state: InterpState.INTERP_IDLE },
      });
      rerender();
    });

    expect(mockWs.sentMessages).toHaveLength(1);
  });
});
