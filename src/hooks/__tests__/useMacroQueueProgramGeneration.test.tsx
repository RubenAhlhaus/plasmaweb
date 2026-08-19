import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMacroQueueProgramGeneration } from '@/hooks/useMacroQueueProgramGeneration';
import { eventBus } from '@/eventBus';
import { useAppStore } from '@/store';
import type { Tool } from '@/types/tools';

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

const TOOL: Tool = {
  id: 'T1',
  name: 'Drill 6mm',
  toolNumber: 1,
};

describe('useMacroQueueProgramGeneration', () => {
  afterEach(() => {
    useAppStore.getState().setBackendWebSocket(null);
    useAppStore.getState().setConnectionStatus('disconnected');
    useAppStore.getState().setMacroQueueItems([]);
    useAppStore.getState().setLastWsCommandResult(null);
  });

  it('starts generation pipeline via event bus trigger', () => {
    const ws = new MockWebSocket();
    useAppStore.getState().setBackendWebSocket(ws as unknown as WebSocket);
    useAppStore.getState().setConnectionStatus('connected');
    useAppStore.getState().setMacroQueueItems([
      {
        kind: 'macro',
        id: 'm1',
        macroTypeId: 'bohren-normal',
        params: {
          toolId: 'T1',
          spindle: '1200',
          feed: '200',
          safeZ: '6',
          depth: '2',
          vorschubHoeheMm: '1',
          x: '0',
          y: '0',
          einstechtiefeMm: '',
          coolantOn: false,
        },
      },
    ]);

    renderHook(() => useMacroQueueProgramGeneration([TOOL]));

    act(() => {
      eventBus.publish('ui.macros.generateProgram', { source: 'macrosScreen' });
    });

    expect(ws.sentMessages).toHaveLength(1);
    const payload = JSON.parse(ws.sentMessages[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: 'command',
      category: 'program',
      action: 'list',
    });
  });
});
