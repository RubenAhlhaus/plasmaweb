import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PowerMaxPanel } from '@/components/plasma/PowerMaxPanel';
import { useAppStore } from '@/store';

interface SentCommand {
  commandId: string;
  action: string;
  params: Record<string, unknown>;
}

function installFakeSocket(): SentCommand[] {
  const sent: SentCommand[] = [];
  const socket = {
    readyState: WebSocket.OPEN,
    send: (raw: string) => sent.push(JSON.parse(raw) as SentCommand),
  } as unknown as WebSocket;
  useAppStore.setState({ backendWebSocket: socket });
  return sent;
}

function answer(commandId: string, result: unknown, ok = true, error?: unknown) {
  const message = {
    type: 'command_result',
    protocolVersion: 1,
    commandId,
    ok,
    result,
    error,
  } as never;
  act(() => {
    useAppStore.setState((prev) => ({
      commandResultHistory: [...prev.commandResultHistory, message],
      lastWsCommandResult: message,
    }));
  });
}

function e2e(name: string): HTMLElement {
  const element = document.querySelector(`[data-e2e="${name}"]`);
  if (!element) throw new Error(`no element with data-e2e="${name}"`);
  return element as HTMLElement;
}

function findE2e(name: string): HTMLElement | null {
  return document.querySelector(`[data-e2e="${name}"]`) as HTMLElement | null;
}

const CONNECTED = {
  enabled: true,
  connected: true,
  port: '/dev/ttyUSB0',
  mode: 1,
  current: 45,
  currentMin: 20,
  currentMax: 125,
  pressure: 72,
  pressureMin: 40,
  pressureMax: 120,
  pressureUnit: 'psi',
  arcTime: 3725,
  fault: null,
};

describe('PowerMaxPanel', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlasma();
    useAppStore.setState({ backendWebSocket: null, commandResultHistory: [] });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays hidden on a machine with no Powermax port', () => {
    const sent = installFakeSocket();
    render(<PowerMaxPanel />);

    answer(sent[0].commandId, { ...CONNECTED, port: '', connected: false, enabled: false });

    expect(findE2e('plasma-powermax')).toBeNull();
  });

  it('shows what the supply is reporting once it is connected', () => {
    const sent = installFakeSocket();
    render(<PowerMaxPanel />);

    answer(sent[0].commandId, CONNECTED);

    expect(e2e('plasma-powermax-state').textContent).toBe('Connected');
    expect(e2e('plasma-powermax-current').textContent).toContain('45 A');
    expect(e2e('plasma-powermax-pressure').textContent).toContain('72 psi');
    // Seconds from the supply, hours for the operator.
    expect(e2e('plasma-powermax-arc-time').textContent).toBe('1:02:05');
  });

  it('names the fault, because a bare code means a trip to the manual', () => {
    const sent = installFakeSocket();
    render(<PowerMaxPanel />);

    answer(sent[0].commandId, {
      ...CONNECTED,
      fault: { raw: '0210', code: '0-21-0', name: 'Excessive arc voltage' },
    });

    expect(e2e('plasma-powermax-fault').textContent).toContain('0-21-0');
    expect(e2e('plasma-powermax-fault').textContent).toContain('Excessive arc voltage');
  });

  it('connects and disconnects through the backend', async () => {
    const sent = installFakeSocket();
    render(<PowerMaxPanel />);
    answer(sent[0].commandId, { ...CONNECTED, enabled: false, connected: false });

    await userEvent.click(e2e('plasma-powermax-toggle'));

    const enable = sent.find((command) => command.action === 'powermax');
    expect(enable?.params).toEqual({ enabled: true });
  });

  it('a refused connection says why — the port, the module or the material', async () => {
    const sent = installFakeSocket();
    render(<PowerMaxPanel />);
    answer(sent[0].commandId, { ...CONNECTED, enabled: false, connected: false });

    await userEvent.click(e2e('plasma-powermax-toggle'));
    const enable = sent.find((command) => command.action === 'powermax')!;
    answer(enable.commandId, null, false, {
      code: 'port_not_found',
      message: '/dev/ttyUSB0 cannot be found',
    });

    expect(e2e('plasma-powermax-error').textContent).toContain('cannot be found');
  });
});
