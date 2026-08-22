import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { eventBus } from '@/eventBus';
import { usePlasmaKeyboardShortcuts } from '@/hooks/usePlasmaKeyboardShortcuts';
import { MAX_JOG_VELOCITY_MM_MIN } from '@/lib/jogVelocity';
import { useAppStore } from '@/store';

function Harness() {
  usePlasmaKeyboardShortcuts();
  return null;
}

function enableShortcuts(enabled: boolean) {
  useAppStore.getState().setPlasmaParameters({
    values: {},
    defaults: {},
    enables: {},
    guiOptions: { keyboardShortcuts: enabled },
    unitsPerMm: 1,
    path: '/x.prefs',
  });
}

function press(code: string, init: Partial<KeyboardEventInit> = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, ...init }));
}

function release(code: string, init: Partial<KeyboardEventInit> = {}) {
  document.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, ...init }));
}

describe('usePlasmaKeyboardShortcuts', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlasma();
    document.body.replaceChildren();
  });

  it('does nothing at all until the machine turns shortcuts on', () => {
    const jog = vi.fn();
    const unsubscribe = eventBus.subscribe('jog.move', jog);
    enableShortcuts(false);
    render(<Harness />);

    press('ArrowRight');

    expect(jog).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('jogs while the key is held and stops when it is released', () => {
    const moves: unknown[] = [];
    const stops: unknown[] = [];
    const unsubMove = eventBus.subscribe('jog.move', (payload) => moves.push(payload));
    const unsubStop = eventBus.subscribe('jog.stop', (payload) => stops.push(payload));
    enableShortcuts(true);
    render(<Harness />);

    press('ArrowRight');
    press('ArrowRight', { repeat: true }); // auto-repeat must not re-start the jog
    release('ArrowRight');

    expect(moves).toEqual([{ axis: 'x', direction: 'positive' }]);
    expect(stops).toEqual([{ axis: 'x' }]);
    unsubMove();
    unsubStop();
  });

  it('a lost keyup cannot leave an axis moving', () => {
    const stops: unknown[] = [];
    const unsubscribe = eventBus.subscribe('jog.stop', (payload) => stops.push(payload));
    enableShortcuts(true);
    render(<Harness />);

    press('ArrowUp');
    // Alt-tab, a stolen focus, a dialog opening elsewhere: the keyup never arrives.
    window.dispatchEvent(new Event('blur'));

    expect(stops).toEqual([{ axis: 'y' }]);
    unsubscribe();
  });

  it('unmounting stops what it started', () => {
    const stops: unknown[] = [];
    const unsubscribe = eventBus.subscribe('jog.stop', (payload) => stops.push(payload));
    enableShortcuts(true);
    const view = render(<Harness />);

    press('PageDown');
    view.unmount();

    expect(stops).toEqual([{ axis: 'z' }]);
    unsubscribe();
  });

  it('a shifted jog runs at the top speed and gives the operator theirs back', () => {
    enableShortcuts(true);
    useAppStore.getState().setJogVelocityMmPerMin(200);
    render(<Harness />);

    press('ArrowRight', { shiftKey: true });
    expect(useAppStore.getState().jogVelocityMmPerMin).toBe(MAX_JOG_VELOCITY_MM_MIN);

    release('ArrowRight', { shiftKey: true });
    expect(useAppStore.getState().jogVelocityMmPerMin).toBe(200);
  });

  it('a digit sets the jog speed as a percentage of the range', () => {
    enableShortcuts(true);
    render(<Harness />);

    press('Digit5');

    expect(useAppStore.getState().jogVelocityMmPerMin).toBe(MAX_JOG_VELOCITY_MM_MIN / 2);
  });

  it('escape aborts and space pauses, through the same path the buttons use', () => {
    const aborts = vi.fn();
    const pauses = vi.fn();
    const unsubAbort = eventBus.subscribe('ui.program.stop', aborts);
    const unsubPause = eventBus.subscribe('ui.program.pause', pauses);
    enableShortcuts(true);
    render(<Harness />);

    press('Escape');
    press('Space');

    expect(aborts).toHaveBeenCalledTimes(1);
    expect(pauses).toHaveBeenCalledTimes(1);
    unsubAbort();
    unsubPause();
  });

  it('a dialog owns the keyboard while it is open', () => {
    const aborts = vi.fn();
    const unsubscribe = eventBus.subscribe('ui.program.stop', aborts);
    enableShortcuts(true);
    render(<Harness />);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);

    press('Escape');

    // The dialog's own Escape must close the dialog, not abort the program.
    expect(aborts).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('typing in a field is typing, not machine control', () => {
    const jog = vi.fn();
    const unsubscribe = eventBus.subscribe('jog.move', jog);
    enableShortcuts(true);
    render(<Harness />);
    const input = document.createElement('input');
    document.body.appendChild(input);

    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true }));

    expect(jog).not.toHaveBeenCalled();
    unsubscribe();
  });
});
