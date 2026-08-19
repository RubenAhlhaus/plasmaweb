import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useJogWheelScaleSync } from '../useJogWheelScaleSync';
import { useAppStore } from '@/store';
import { MockWebSocket } from './mockWebSocket';

describe('useJogWheelScaleSync', () => {
  afterEach(() => {
    useAppStore.getState().setBackendWebSocket(null);
    useAppStore.getState().setConnectionStatus('disconnected');
    useAppStore.getState().setSelectedJogIncrement(1);
  });

  it('sends hal.set_jog_wheel_scale when connected with a positive increment', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setSelectedJogIncrement(0.1);
    useAppStore.getState().setConnectionStatus('connected');

    renderHook(() => useJogWheelScaleSync());

    expect(mockWs.sentMessages).toHaveLength(1);
    const payload = JSON.parse(mockWs.sentMessages[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: 'command',
      category: 'hal',
      action: 'set_jog_wheel_scale',
    });
    expect((payload.params as Record<string, unknown>).scale).toBe(0.1);
  });

  it('does not resend the same scale while still connected', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setSelectedJogIncrement(1);
    useAppStore.getState().setConnectionStatus('connected');

    const { rerender } = renderHook(() => useJogWheelScaleSync());
    expect(mockWs.sentMessages).toHaveLength(1);

    rerender();
    expect(mockWs.sentMessages).toHaveLength(1);
  });

  it('sends again when the selected increment changes', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setSelectedJogIncrement(1);
    useAppStore.getState().setConnectionStatus('connected');

    renderHook(() => useJogWheelScaleSync());
    expect(mockWs.sentMessages).toHaveLength(1);

    act(() => {
      useAppStore.getState().setSelectedJogIncrement(0.5);
    });

    expect(mockWs.sentMessages).toHaveLength(2);
    const payload = JSON.parse(mockWs.sentMessages[1]) as Record<string, unknown>;
    expect((payload.params as Record<string, unknown>).scale).toBe(0.5);
  });

  it('does not send while disconnected', () => {
    const mockWs = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(mockWs as unknown as WebSocket);
    useAppStore.getState().setSelectedJogIncrement(1);
    useAppStore.getState().setConnectionStatus('disconnected');

    renderHook(() => useJogWheelScaleSync());
    expect(mockWs.sentMessages).toHaveLength(0);
  });
});
