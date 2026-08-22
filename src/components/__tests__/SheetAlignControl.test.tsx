import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SheetAlignControl } from '@/components/plasma/SheetAlignControl';
import { useAppStore } from '@/store';
import type { PlasmaAlignment } from '@/store/types';

interface SentCommand {
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

function findE2e(name: string): HTMLElement | null {
  return document.querySelector(`[data-e2e="${name}"]`) as HTMLElement | null;
}

function e2e(name: string): HTMLElement {
  const element = findE2e(name);
  if (!element) throw new Error(`no element with data-e2e="${name}"`);
  return element;
}

function setAlignment(overrides: Partial<PlasmaAlignment> = {}) {
  useAppStore.getState().setPlasmaAlignment({
    state: 'idle',
    kind: 'laser',
    firstMark: null,
    fitted: { laser: true, camera: false },
    offsets: { laser: { 'X axis': 10, 'Y axis': 20 }, camera: { 'X axis': 0, 'Y axis': 0 } },
    ...overrides,
  });
}

describe('SheetAlignControl', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlasma();
    useAppStore.setState({ backendWebSocket: null, plasmaAvailable: true });
  });

  it('stays out of the way on a machine with no alignment laser', () => {
    setAlignment({ fitted: { laser: false, camera: false } });

    render(<SheetAlignControl />);

    expect(findE2e('plasma-align-laser')).toBeNull();
  });

  it('asks the backend where the routine stands', () => {
    const sent = installFakeSocket();

    render(<SheetAlignControl />);

    expect(sent.map((command) => command.action)).toEqual(['get_alignment']);
  });

  it('the label is the next instruction, not the last action', () => {
    setAlignment({ state: 'markedge' });

    render(<SheetAlignControl />);

    expect(e2e('plasma-align-laser-press').textContent).toBe('Mark edge');
  });

  it('a press asks the backend to advance, without guessing the next state', async () => {
    const sent = installFakeSocket();
    setAlignment();
    render(<SheetAlignControl />);

    await userEvent.click(e2e('plasma-align-laser-press'));

    expect(sent.find((command) => command.action === 'alignment_press')?.params).toEqual({
      kind: 'laser',
    });
    // The button still shows the state the backend last reported.
    expect(e2e('plasma-align-laser-press').textContent).toBe('Laser');
  });

  it('cancel only exists part-way through', async () => {
    const sent = installFakeSocket();
    setAlignment();
    render(<SheetAlignControl />);
    expect(findE2e('plasma-align-laser-cancel')).toBeNull();

    setAlignment({ state: 'setorigin' });
    render(<SheetAlignControl />);
    await userEvent.click(e2e('plasma-align-laser-cancel'));

    expect(sent.map((command) => command.action)).toContain('alignment_cancel');
  });

  it('shows the plate angle the routine ended on', () => {
    setAlignment({ angle: 183.75 });

    render(<SheetAlignControl />);

    expect(e2e('plasma-align-laser-angle').textContent).toContain('183.75');
  });
});
