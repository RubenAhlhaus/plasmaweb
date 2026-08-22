import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { UserButtonPanel } from '@/components/plasma/UserButtonPanel';
import { useAppStore } from '@/store';
import type { LastWsCommandResult } from '@/store/types';

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
  useAppStore.setState({ backendWebSocket: socket, plasmaAvailable: true });
  return sent;
}

function answer(result: LastWsCommandResult) {
  act(() => {
    useAppStore.setState((prev) => ({
      commandResultHistory: [...prev.commandResultHistory, result],
      lastWsCommandResult: result,
    }));
  });
}

function e2e(name: string): HTMLElement {
  const element = document.querySelector(`[data-e2e="${name}"]`);
  if (!element) throw new Error(`no element with data-e2e="${name}"`);
  return element as HTMLElement;
}

const BUTTONS = [
  { number: 1, name: 'Probe\nTest', code: 'probe-test 6', kind: 'probe-test', params: {}, supported: true, reason: null },
  { number: 2, name: 'Pulse', code: 'torch-pulse 0.4', kind: 'torch-pulse', params: {}, supported: true, reason: null },
  { number: 3, name: 'Frame', code: 'framing', kind: 'framing', params: {}, supported: false, reason: 'framing a job is not implemented yet' },
];

function deliverButtons(sent: SentCommand[], buttons = BUTTONS) {
  const request = sent.find((command) => command.action === 'get_user_buttons');
  expect(request).toBeDefined();
  answer({ commandId: request!.commandId, ok: true, result: { buttons } });
}

describe('UserButtonPanel', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlasma();
    useAppStore.setState({
      backendWebSocket: null,
      commandResultHistory: [],
      lastWsCommandResult: null,
    });
  });

  it('shows nothing at all when the machine has no user buttons', () => {
    const sent = installFakeSocket();
    render(<UserButtonPanel />);

    deliverButtons(sent, []);

    expect(document.querySelector('[data-e2e="plasma-user-buttons"]')).toBeNull();
  });

  it('labels the buttons the way the machine names them', () => {
    const sent = installFakeSocket();
    render(<UserButtonPanel />);

    deliverButtons(sent);

    expect(e2e('plasma-user-button-1').textContent).toContain('Probe');
    expect(e2e('plasma-user-button-1').textContent).toContain('Test');
  });

  it('sends only the button number, never the code', async () => {
    const sent = installFakeSocket();
    render(<UserButtonPanel />);
    deliverButtons(sent);

    await userEvent.click(e2e('plasma-user-button-1'));

    const press = sent.find((command) => command.action === 'user_button');
    expect(press!.params).toEqual({ number: 1, pressed: true });
    expect(JSON.stringify(press!.params)).not.toContain('probe-test');
  });

  it('a momentary button acts on press and release', async () => {
    const sent = installFakeSocket();
    render(<UserButtonPanel />);
    deliverButtons(sent);

    const pulse = e2e('plasma-user-button-2');
    await userEvent.pointer([{ keys: '[MouseLeft>]', target: pulse }, { keys: '[/MouseLeft]', target: pulse }]);

    const presses = sent.filter((command) => command.action === 'user_button');
    expect(presses.map((command) => command.params.pressed)).toEqual([true, false]);
  });

  it('a button the machine cannot run is disabled and says why', () => {
    const sent = installFakeSocket();
    render(<UserButtonPanel />);
    deliverButtons(sent);

    const framing = e2e('plasma-user-button-3') as HTMLButtonElement;
    expect(framing.disabled).toBe(true);
    expect(framing.title).toContain('not implemented');
  });

  it('shows why a press was refused', async () => {
    const sent = installFakeSocket();
    render(<UserButtonPanel />);
    deliverButtons(sent);
    await userEvent.click(e2e('plasma-user-button-1'));
    const press = sent.find((command) => command.action === 'user_button');

    answer({
      commandId: press!.commandId,
      ok: false,
      error: { code: 'torch_already_on', message: 'the torch is on' },
    });

    expect(e2e('plasma-user-buttons-message').textContent).toContain('the torch is on');
  });
});
