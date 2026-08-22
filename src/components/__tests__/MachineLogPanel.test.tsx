import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MachineLogPanel } from '@/components/plasma/MachineLogPanel';
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

/** Answer a pending command the way the backend would, through the store's result channel. */
function answer(commandId: string, result: unknown) {
  const message = {
    type: 'command_result',
    protocolVersion: 1,
    commandId,
    ok: true,
    result,
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

function all(name: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(`[data-e2e="${name}"]`)) as HTMLElement[];
}

const ENTRIES = [
  { at: 1_700_000_000, kind: 'operator_text', severity: 'info', message: 'Tool 0: No Tool' },
  {
    at: 1_700_000_060,
    kind: 'operator_error',
    severity: 'critical',
    message: 'float switch activated, program is paused',
  },
];

describe('MachineLogPanel', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlasma();
    useAppStore.setState({ backendWebSocket: null, commandResultHistory: [] });
  });

  it('asks for the log when it opens', () => {
    const sent = installFakeSocket();

    render(<MachineLogPanel />);

    expect(sent[0].action).toBe('get_machine_log');
  });

  it('says so plainly when the machine has not spoken yet', () => {
    const sent = installFakeSocket();
    render(<MachineLogPanel />);

    answer(sent[0].commandId, { entries: [], lastCritical: null, count: 0 });

    expect(e2e('plasma-machine-log-empty')).toBeTruthy();
  });

  it('shows the newest message first and marks its severity', () => {
    const sent = installFakeSocket();
    render(<MachineLogPanel />);

    answer(sent[0].commandId, { entries: ENTRIES, lastCritical: ENTRIES[1], count: 2 });

    const rows = all('plasma-machine-log-entry');
    expect(rows[0].textContent).toContain('float switch activated');
    expect(rows[0].getAttribute('data-severity')).toBe('critical');
    expect(rows[1].getAttribute('data-severity')).toBe('info');
  });

  it('pins the last critical message, which is why the machine is standing still', () => {
    const sent = installFakeSocket();
    render(<MachineLogPanel />);

    answer(sent[0].commandId, { entries: ENTRIES, lastCritical: ENTRIES[1], count: 2 });

    expect(e2e('plasma-machine-log-last-critical').textContent).toContain(
      'float switch activated',
    );
  });

  it('the critical filter asks the backend rather than filtering a partial history', async () => {
    const sent = installFakeSocket();
    render(<MachineLogPanel />);

    await userEvent.click(e2e('plasma-machine-log-critical'));

    const last = sent[sent.length - 1];
    expect(last.action).toBe('get_machine_log');
    expect(last.params).toEqual({ severity: 'critical', limit: 200 });
  });

  it('saving reports where the file went', async () => {
    const sent = installFakeSocket();
    render(<MachineLogPanel />);

    await userEvent.click(e2e('plasma-machine-log-save'));
    const save = sent.find((command) => command.action === 'save_machine_log')!;
    answer(save.commandId, { path: '/home/ruben/linuxcnc/configs/machine_log_26-08-22.txt' });

    expect(e2e('plasma-machine-log-saved').textContent).toContain('machine_log_26-08-22.txt');
  });
});
