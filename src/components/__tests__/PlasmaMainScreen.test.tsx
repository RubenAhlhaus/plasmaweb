import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PlasmaMainScreen } from '@/screens/PlasmaMainScreen';
import { useAppStore } from '@/store';

interface SentCommand {
  category: string;
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

function snapshot(pins: Record<string, boolean | number> = {}) {
  useAppStore.getState().setPlasmaSnapshot({
    pins: {
      plasmac: {
        'torch-on': false,
        'arc-ok-out': false,
        'thc-active': false,
        'arc-voltage-out': 0,
        'target-volts': 0,
        'z-height': 0,
        'current-feed-rate': 0,
        'height-override': 0,
        'torch-enable': false,
        'thc-enabled': false,
        ...pins,
      },
      qtplasmac: {},
    },
    state: {
      state: 0,
      stateName: 'IDLE',
      stateDescription: 'idle and waiting for a start command',
      stopType: 0,
      stopTypeName: 'NONE',
      isCutting: false,
    },
    missingPins: [],
  });
}

describe('PlasmaMainScreen', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlasma();
    useAppStore.setState({ backendWebSocket: null });
  });

  it('says so instead of rendering an empty dashboard when the plasma layer is absent', () => {
    render(<PlasmaMainScreen />);
    expect(document.querySelector('[data-e2e="plasma-unavailable"]')).not.toBeNull();
    expect(document.querySelector('[data-e2e="plasma-main"]')).toBeNull();
  });

  it('shows live pin values, not locally derived ones', () => {
    snapshot({ 'arc-voltage-out': 123.4, 'z-height': 5.25, 'current-feed-rate': 4000 });
    render(<PlasmaMainScreen />);

    expect(document.querySelector('[data-e2e="plasma-arc-voltage"]')?.textContent).toContain('123.4');
    expect(document.querySelector('[data-e2e="plasma-z-height"]')?.textContent).toContain('5.25');
    expect(document.querySelector('[data-e2e="plasma-feed-rate"]')?.textContent).toContain('4000');
    expect(document.querySelector('[data-e2e="plasma-state-name"]')?.textContent).toBe('IDLE');
  });

  it('lights the torch LED from plasmac.torch-on', () => {
    snapshot({ 'torch-on': true });
    render(<PlasmaMainScreen />);
    expect(document.querySelector('[data-e2e="plasma-led-torch-on"]')?.getAttribute('data-state')).toBe('on');
    expect(document.querySelector('[data-e2e="plasma-led-arc-ok"]')?.getAttribute('data-state')).toBe('off');
  });

  it('marks a pin this LinuxCNC build lacks as unavailable rather than off', () => {
    useAppStore.getState().setPlasmaSnapshot({
      pins: { plasmac: { 'torch-on': false }, qtplasmac: {} },
      missingPins: ['plasmac.breakaway'],
    });
    render(<PlasmaMainScreen />);
    expect(document.querySelector('[data-e2e="plasma-led-breakaway"]')?.getAttribute('data-state')).toBe(
      'unavailable',
    );
  });

  it('sends torch_enable and leaves the button state to HAL', async () => {
    snapshot({ 'torch-enable': false });
    const sent = installFakeSocket();
    render(<PlasmaMainScreen />);

    const toggle = document.querySelector('[data-e2e="plasma-toggle-torch"]') as HTMLButtonElement;
    await userEvent.click(toggle);

    expect(sent).toEqual([
      { type: 'command', protocolVersion: 1, commandId: expect.any(String), category: 'plasma', action: 'torch_enable', params: { enabled: true } },
    ]);
    // no optimistic flip: the pin still reads false, so the button must still read false
    expect(toggle.getAttribute('data-active')).toBe('false');
  });

  it('sends the named toggles through set_enable', async () => {
    snapshot();
    const sent = installFakeSocket();
    render(<PlasmaMainScreen />);

    await userEvent.click(document.querySelector('[data-e2e="plasma-toggle-cornerlock"]') as HTMLButtonElement);
    await userEvent.click(document.querySelector('[data-e2e="plasma-toggle-auto-volts"]') as HTMLButtonElement);

    expect(sent.map((c) => [c.action, c.params])).toEqual([
      ['set_enable', { name: 'cornerlock', enabled: true }],
      ['set_enable', { name: 'autoVolts', enabled: true }],
    ]);
  });

  it('steps the height override in whole volts from the current pin value', async () => {
    snapshot({ 'height-override': 2 });
    const sent = installFakeSocket();
    render(<PlasmaMainScreen />);

    await userEvent.click(document.querySelector('[data-e2e="plasma-height-override-plus"]') as HTMLButtonElement);
    await userEvent.click(document.querySelector('[data-e2e="plasma-height-override-minus"]') as HTMLButtonElement);
    await userEvent.click(document.querySelector('[data-e2e="plasma-height-override-reset"]') as HTMLButtonElement);

    expect(sent.map((c) => c.params)).toEqual([{ volts: 3 }, { volts: 1 }, { volts: 0 }]);
    expect(document.querySelector('[data-e2e="plasma-height-override-value"]')?.textContent).toContain('2.0');
  });

  it('treats torch pulse as momentary: press raises, release drops', async () => {
    snapshot();
    const sent = installFakeSocket();
    render(<PlasmaMainScreen />);

    const button = document.querySelector('[data-e2e="plasma-torch-pulse"]') as HTMLButtonElement;
    await userEvent.pointer([{ keys: '[MouseLeft>]', target: button }, { keys: '[/MouseLeft]', target: button }]);

    expect(sent.map((c) => c.params.action)).toContain('press');
    expect(sent.map((c) => c.params.action)).toContain('release');
  });

  it('does nothing but stay quiet when the socket is closed', async () => {
    snapshot();
    useAppStore.setState({ backendWebSocket: null });
    const spy = vi.spyOn(console, 'error');
    render(<PlasmaMainScreen />);

    await userEvent.click(document.querySelector('[data-e2e="plasma-toggle-thc"]') as HTMLButtonElement);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
