import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DirectionalControl } from '../DirectionalControl';
import { eventBus } from '@/eventBus';
import { useAppStore } from '@/store';
import type { LinuxCncMachineStatus } from '@/store/types';
import { TaskMode, TaskState } from '@/store/types';

function enableJogPreconditions() {
  const state = useAppStore.getState();
  const current = state.linuxCncStatus;
  state.setLinuxCncStatus({
    ...current,
    machine: {
      ...current.machine,
      task_state: TaskState.STATE_ON,
      task_mode: TaskMode.MODE_MANUAL,
      error: false,
    },
  });
}

function jogYPositiveButton(): HTMLElement {
  const el = document.querySelector('[data-e2e="jog-y-positive"]');
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

describe('DirectionalControl', () => {
  let machineBefore: LinuxCncMachineStatus | undefined;

  afterEach(() => {
    act(() => {
      const state = useAppStore.getState();
      state.setJogMode('incremental');
      state.setLinuxCncStatus({
        ...state.linuxCncStatus,
        machine: machineBefore ?? {},
      });
    });
  });

  it('prevents context menu in continuous mode so touch long-press keeps jogging', () => {
    machineBefore = useAppStore.getState().linuxCncStatus.machine;
    act(() => {
      enableJogPreconditions();
      useAppStore.getState().setJogMode('continuous');
    });

    const published: Array<{ type: string; payload: unknown }> = [];
    const unsubMove = eventBus.subscribe('jog.move', (payload) => {
      published.push({ type: 'jog.move', payload });
    });
    const unsubStop = eventBus.subscribe('jog.stop', (payload) => {
      published.push({ type: 'jog.stop', payload });
    });

    try {
      render(<DirectionalControl />);
      const button = jogYPositiveButton();

      fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
      expect(published).toEqual([
        { type: 'jog.move', payload: { axis: 'y', direction: 'positive' } },
      ]);
      expect(button.className).toMatch(/touch-none/);

      const contextEvent = createEvent.contextMenu(button);
      fireEvent(button, contextEvent);
      expect(contextEvent.defaultPrevented).toBe(true);
      expect(published).toHaveLength(1);

      fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
      expect(published).toContainEqual({
        type: 'jog.stop',
        payload: { axis: 'y' },
      });
    } finally {
      unsubMove();
      unsubStop();
    }
  });

  it('ignores secondary-button pointerdown in continuous mode', () => {
    machineBefore = useAppStore.getState().linuxCncStatus.machine;
    act(() => {
      enableJogPreconditions();
      useAppStore.getState().setJogMode('continuous');
    });

    const moves: unknown[] = [];
    const unsub = eventBus.subscribe('jog.move', (payload) => {
      moves.push(payload);
    });

    try {
      render(<DirectionalControl />);
      fireEvent.pointerDown(jogYPositiveButton(), { button: 2, pointerId: 1 });
      expect(moves).toHaveLength(0);
    } finally {
      unsub();
    }
  });

  it('does not apply continuous touch-hold classes in incremental mode', () => {
    machineBefore = useAppStore.getState().linuxCncStatus.machine;
    act(() => {
      enableJogPreconditions();
      useAppStore.getState().setJogMode('incremental');
    });

    render(<DirectionalControl />);
    expect(jogYPositiveButton().className).not.toMatch(/touch-none/);
    expect(screen.getByRole('button', { name: 'Y axis forward' })).toHaveAttribute(
      'data-e2e',
      'jog-y-positive',
    );
  });
});
