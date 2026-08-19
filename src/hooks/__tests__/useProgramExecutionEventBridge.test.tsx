import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProgramExecutionEventBridge } from '../useProgramExecutionEventBridge';
import { eventBus } from '@/eventBus';
import { useAppStore } from '@/store';
import { InterpState } from '@/store/types';
import { MockWebSocket } from './mockWebSocket';

describe('useProgramExecutionEventBridge', () => {
  afterEach(() => {
    useAppStore.getState().setBackendWebSocket(null);
    useAppStore.getState().setLinuxCncStatus({ program: {} });
    useAppStore.getState().setProgramEditor({ pendingAutoRunStartLine: 0 });
  });

  it('sends program.auto pause when ui.program.pause is published and interpreter not paused', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);

    renderHook(() => useProgramExecutionEventBridge());

    act(() => {
      eventBus.publish('ui.program.pause', { source: 'virtualSidebar' });
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: 'command',
      category: 'program',
      action: 'auto',
    });
    expect((payload.params as Record<string, unknown>).command).toBe('pause');
  });

  it('sends program.auto resume when ui.program.pause is published and interp_state is INTERP_PAUSED', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setLinuxCncStatus({
      program: { interp_state: InterpState.INTERP_PAUSED },
    });

    renderHook(() => useProgramExecutionEventBridge());

    act(() => {
      eventBus.publish('ui.program.pause', { source: 'virtualSidebar' });
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect((payload.params as Record<string, unknown>).command).toBe('resume');
  });

  it('sends program.auto resume when ui.program.pause is published and program.paused is true', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setLinuxCncStatus({ program: { paused: true } });

    renderHook(() => useProgramExecutionEventBridge());

    act(() => {
      eventBus.publish('ui.program.pause', { source: 'virtualSidebar' });
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect((payload.params as Record<string, unknown>).command).toBe('resume');
  });

  it('sends machine.abort when ui.program.stop is published', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);

    renderHook(() => useProgramExecutionEventBridge());

    act(() => {
      eventBus.publish('ui.program.stop', { source: 'virtualSidebar' });
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: 'command',
      category: 'machine',
      action: 'abort',
    });
    expect(payload.params).toEqual({});
  });

  it('sends program.auto run when ui.program.cycleStart and program not paused', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setLinuxCncStatus({ program: { paused: false } });

    renderHook(() => useProgramExecutionEventBridge());

    act(() => {
      eventBus.publish('ui.program.cycleStart', { source: 'virtualSidebar' });
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: 'command',
      category: 'program',
      action: 'auto',
    });
    expect((payload.params as Record<string, unknown>).command).toBe('run');
    expect((payload.params as Record<string, unknown>).startLine).toBe(0);
  });

  it('sends program.auto run with store pendingAutoRunStartLine when set', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setLinuxCncStatus({ program: { paused: false } });
    useAppStore.getState().setProgramEditor({ pendingAutoRunStartLine: 42 });

    renderHook(() => useProgramExecutionEventBridge());

    act(() => {
      eventBus.publish('ui.program.cycleStart', { source: 'virtualSidebar' });
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect((payload.params as Record<string, unknown>).command).toBe('run');
    expect((payload.params as Record<string, unknown>).startLine).toBe(42);
    expect(useAppStore.getState().programEditor.pendingAutoRunStartLine).toBe(0);
  });

  it('sends program.auto resume when ui.program.cycleStart and program paused', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setLinuxCncStatus({ program: { paused: true } });

    renderHook(() => useProgramExecutionEventBridge());

    act(() => {
      eventBus.publish('ui.program.cycleStart', { source: 'virtualSidebar' });
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: 'command',
      category: 'program',
      action: 'auto',
    });
    expect((payload.params as Record<string, unknown>).command).toBe('resume');
  });

  it('sends program.auto resume when ui.program.cycleStart and interp_state is INTERP_PAUSED', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setLinuxCncStatus({
      program: { interp_state: InterpState.INTERP_PAUSED },
    });

    renderHook(() => useProgramExecutionEventBridge());

    act(() => {
      eventBus.publish('ui.program.cycleStart', { source: 'virtualSidebar' });
    });

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect((payload.params as Record<string, unknown>).command).toBe('resume');
  });
});
