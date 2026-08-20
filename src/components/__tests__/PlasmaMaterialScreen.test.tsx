import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PlasmaMaterialScreen } from '@/screens/PlasmaMaterialScreen';
import { useAppStore } from '@/store';
import type { PlasmaMaterial } from '@/store/types';

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

/** The repo's tests query by `data-e2e`, the attribute the kiosk E2E suite also uses. */
function e2e(name: string): HTMLElement {
  const element = document.querySelector(`[data-e2e="${name}"]`);
  if (!element) throw new Error(`no element with data-e2e="${name}"`);
  return element as HTMLElement;
}

function findE2e(name: string): HTMLElement | null {
  return document.querySelector(`[data-e2e="${name}"]`) as HTMLElement | null;
}

function material(number: number, name: string, overrides: Partial<PlasmaMaterial> = {}): PlasmaMaterial {
  return {
    number,
    name,
    temporary: number >= 1000000,
    kerfWidth: 1.5,
    pierceHeight: 3.6,
    pierceDelay: 0.1,
    puddleJumpHeight: 0,
    puddleJumpDelay: 0,
    cutHeight: 1.4,
    cutSpeed: 4100,
    cutAmps: 45,
    cutVolts: 122,
    pauseAtEnd: 0,
    gasPressure: 0,
    cutMode: 1,
    thickness: 5,
    ...overrides,
  };
}

function setMaterials(materials: PlasmaMaterial[], selected: number | null = 0, dflt = 0) {
  useAppStore.getState().setPlasmaMaterials({
    materials,
    selected,
    default: dflt,
    path: '/home/ruben/linuxcnc/configs/qtplasmac/qtplasmac-metric_material.cfg',
  });
}

describe('PlasmaMaterialScreen', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlasma();
    useAppStore.setState({ backendWebSocket: null });
  });

  it('says so when the machine has no material file', () => {
    render(<PlasmaMaterialScreen />);

    expect(findE2e('plasma-materials-unavailable')).not.toBeNull();
  });

  it('lists materials with the selected and default markers', () => {
    setMaterials([material(0, 'Default'), material(3, '5mm mild steel')], 3, 0);

    render(<PlasmaMaterialScreen />);

    expect(e2e('plasma-material-row-0').textContent).toContain('00000: Default');
    expect(e2e('plasma-material-row-3').textContent).toContain('00003: 5mm mild steel');
    expect(e2e('plasma-material-row-0').textContent).toContain('Default');
    expect(e2e('plasma-material-row-3').textContent).toContain('In use');
  });

  it('selecting a material asks the backend to put it on the setpoints', async () => {
    const sent = installFakeSocket();
    setMaterials([material(0, 'Default'), material(3, '5mm mild steel')], 0, 0);
    render(<PlasmaMaterialScreen />);

    await userEvent.click(e2e('plasma-material-row-3'));

    expect(sent.map((command) => [command.action, command.params])).toEqual([
      ['select_material', { number: 3 }],
    ]);
  });

  it('shows the selected material and only saves once something changed', () => {
    setMaterials([material(3, '5mm mild steel')], 3, 3);

    render(<PlasmaMaterialScreen />);

    expect((e2e('plasma-material-name') as HTMLInputElement).value).toBe('5mm mild steel');
    expect((e2e('plasma-material-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a temporary material can be looked at but not edited', () => {
    setMaterials([material(1000000, 'Temporary 1000000')], 1000000, 1000000);

    render(<PlasmaMaterialScreen />);

    expect(e2e('plasma-material-row-1000000').textContent).toContain('From program');
    expect((e2e('plasma-material-name') as HTMLInputElement).disabled).toBe(true);
    expect((e2e('plasma-material-save') as HTMLButtonElement).disabled).toBe(true);
    expect((e2e('plasma-material-delete') as HTMLButtonElement).disabled).toBe(true);
  });

  it('the last material cannot be deleted', () => {
    setMaterials([material(0, 'Default')], 0, 0);

    render(<PlasmaMaterialScreen />);

    expect((e2e('plasma-material-delete') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renaming a material and saving sends the whole material', async () => {
    const sent = installFakeSocket();
    setMaterials([material(0, 'Default'), material(3, '5mm mild steel')], 3, 0);
    render(<PlasmaMaterialScreen />);

    await userEvent.clear(e2e('plasma-material-name'));
    await userEvent.type(e2e('plasma-material-name'), '6mm');
    await userEvent.click(e2e('plasma-material-save'));

    const save = sent.find((command) => command.action === 'save_material');
    expect(save).toBeDefined();
    expect(save?.params.number).toBe(3);
    expect(save?.params.name).toBe('6mm');
    expect((save?.params.values as Record<string, number>).cutVolts).toBe(122);
  });

  it('NEW picks a free number rather than overwriting a material', async () => {
    installFakeSocket();
    setMaterials([material(0, 'Default'), material(1, 'thin'), material(3, 'thick')], 0, 0);
    render(<PlasmaMaterialScreen />);

    await userEvent.click(e2e('plasma-material-new'));

    expect(e2e('plasma-material-number').textContent).toContain('00002');
  });
});
