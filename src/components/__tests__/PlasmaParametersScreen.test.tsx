import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PlasmaParametersScreen } from '@/screens/PlasmaParametersScreen';
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

function e2e(name: string): HTMLElement {
  const element = document.querySelector(`[data-e2e="${name}"]`);
  if (!element) throw new Error(`no element with data-e2e="${name}"`);
  return element as HTMLElement;
}

function findE2e(name: string): HTMLElement | null {
  return document.querySelector(`[data-e2e="${name}"]`) as HTMLElement | null;
}

function setParameters(values: Record<string, number> = {}) {
  useAppStore.getState().setPlasmaParameters({
    values: {
      'Pid P Gain': 10,
      'Arc Maximum Starts': 3,
      'THC Delay': 0.5,
      'Probe Feed Rate': 300,
      ...values,
    },
    defaults: { 'Pid P Gain': 10, 'Arc Maximum Starts': 3, 'THC Delay': 0.5, 'Probe Feed Rate': 300 },
    enables: { 'thc-enable': true },
    limits: {
      'Pid P Gain': { minimum: 0, maximum: 1000, decimals: 0, unit: '' },
      'Probe Feed Rate': { minimum: 0, maximum: 500, decimals: 0, unit: 'mm/min' },
      'Spotting Time': { minimum: 0, maximum: 9999, decimals: 0, unit: 'mS' },
      'Height Per Volt': { minimum: 0.025, maximum: 0.25, decimals: 3, unit: 'mm' },
    },
    unitsPerMm: 1,
    path: '/home/ruben/linuxcnc/configs/qtplasmac/qtplasmac-metric.prefs',
  });
}

describe('PlasmaParametersScreen', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlasma();
    useAppStore.setState({ backendWebSocket: null });
  });

  it('says so when the machine has no parameter file', () => {
    render(<PlasmaParametersScreen />);

    expect(findE2e('plasma-parameters-unavailable')).not.toBeNull();
  });

  it('shows the values the backend reported, keyed by QtPlasmaC own names', () => {
    setParameters();

    render(<PlasmaParametersScreen />);

    expect(e2e('plasma-parameter-pid-p-gain').textContent).toContain('10');
    expect(e2e('plasma-parameter-probe-feed-rate').textContent).toContain('300');
    expect(e2e('plasma-parameters-path').textContent).toContain('qtplasmac-metric.prefs');
  });

  it('saves only what was edited', async () => {
    const sent = installFakeSocket();
    setParameters();
    render(<PlasmaParametersScreen />);

    // The field opens a keypad dialog; go through it the way an operator would.
    await userEvent.click(e2e('plasma-parameter-pid-p-gain'));
    // Scoped to the dialog: the screen has its own checkboxes, and the first `input` on the
    // page is no longer the keypad's.
    const entry = document.querySelector('[role=dialog] input') as HTMLInputElement;
    await userEvent.clear(entry);
    await userEvent.type(entry, '15');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(e2e('plasma-parameters-save'));

    const save = sent.find((command) => command.action === 'save_parameters');
    expect(save?.params.values).toEqual({ 'Pid P Gain': 15 });
  });

  it('nothing to save until something changed', () => {
    setParameters();

    render(<PlasmaParametersScreen />);

    expect((e2e('plasma-parameters-save') as HTMLButtonElement).disabled).toBe(true);
    expect(findE2e('plasma-parameters-dirty')).toBeNull();
  });

  it('labels each field with the unit the backend reported, not one of its own', () => {
    setParameters({ 'Spotting Time': 250 });

    render(<PlasmaParametersScreen />);

    // `mS`, not seconds: the realtime component divides this by 1000.
    const unitOf = (name: string) => e2e(name).parentElement?.textContent ?? '';
    expect(unitOf('plasma-parameter-spotting-time')).toContain('mS');
    expect(unitOf('plasma-parameter-probe-feed-rate')).toContain('mm/min');
  });

  it('refuses a value past its bound where it is typed', async () => {
    const sent = installFakeSocket();
    setParameters({ 'Height Per Volt': 0.1 });
    render(<PlasmaParametersScreen />);

    await userEvent.click(e2e('plasma-parameter-height-per-volt'));
    const entry = document.querySelector('[role=dialog] input') as HTMLInputElement;
    await userEvent.clear(entry);
    await userEvent.type(entry, '10');
    await userEvent.keyboard('{Enter}');

    // A Height Per Volt of 10 would command 100 mm of Z for every volt of arc error.
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(sent.find((command) => command.action === 'save_parameters')).toBeUndefined();
  });

  it('reload asks the backend to re-read both files', async () => {
    const sent = installFakeSocket();
    setParameters();
    render(<PlasmaParametersScreen />);

    await userEvent.click(e2e('plasma-parameters-reload'));

    expect(sent.map((command) => command.action)).toEqual(['reload_config']);
  });
});

describe('PlasmaParametersScreen — offset probing', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlasma();
    useAppStore.setState({ backendWebSocket: null });
  });

  it('shows where the probe sits, defaulting to under the torch', () => {
    setParameters();

    render(<PlasmaParametersScreen />);

    expect(e2e('plasma-offset-probe-x-axis').textContent).toContain('0');
    expect(e2e('plasma-offset-probe-delay').textContent).toContain('0');
  });

  it('saves the offset probe through its own command, not with the parameters', async () => {
    const sent = installFakeSocket();
    useAppStore.getState().setPlasmaParameters({
      values: { 'Pid P Gain': 10 },
      defaults: { 'Pid P Gain': 10 },
      enables: {},
      offsetProbing: { 'X axis': 0, 'Y axis': 0, Delay: 0 },
      unitsPerMm: 1,
      path: '/x.prefs',
    });
    render(<PlasmaParametersScreen />);

    await userEvent.click(e2e('plasma-offset-probe-x-axis'));
    const entry = document.querySelector('[role=dialog] input') as HTMLInputElement;
    await userEvent.clear(entry);
    await userEvent.type(entry, '25');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(e2e('plasma-parameters-save'));

    const actions = sent.map((command) => command.action);
    expect(actions).toContain('save_offset_probing');
    expect(actions).not.toContain('save_parameters');
    const save = sent.find((command) => command.action === 'save_offset_probing');
    expect(save!.params.values).toEqual({ 'X axis': 25 });
  });
});
