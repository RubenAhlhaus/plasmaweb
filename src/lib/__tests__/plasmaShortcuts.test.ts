import { describe, expect, it } from 'vitest';

import { shortcutForEvent, UNBOUND } from '@/lib/plasmaShortcuts';

function key(
  code: string,
  modifiers: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {},
) {
  return {
    code,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...modifiers,
  };
}

describe('plasma keyboard shortcuts', () => {
  it('maps the documented one-shot keys', () => {
    expect(shortcutForEvent(key('Escape'))).toEqual({ kind: 'action', action: 'abort' });
    expect(shortcutForEvent(key('Space'))).toEqual({ kind: 'action', action: 'pauseToggle' });
    expect(shortcutForEvent(key('F1'))).toEqual({ kind: 'action', action: 'estopToggle' });
    expect(shortcutForEvent(key('F2'))).toEqual({ kind: 'action', action: 'powerToggle' });
    expect(shortcutForEvent(key('End'))).toEqual({ kind: 'action', action: 'touchOffXY' });
    expect(shortcutForEvent(key('Delete'))).toEqual({
      kind: 'action',
      action: 'alignmentPress',
    });
    expect(shortcutForEvent(key('KeyL'))).toEqual({
      kind: 'action',
      action: 'reloadProgram',
    });
  });

  it('the CTRL keys are their own bindings, not the plain ones with a modifier', () => {
    expect(shortcutForEvent(key('KeyR', { ctrlKey: true }))).toEqual({
      kind: 'action',
      action: 'cycleStart',
    });
    expect(shortcutForEvent(key('Home', { ctrlKey: true }))).toEqual({
      kind: 'action',
      action: 'homeAll',
    });
    expect(shortcutForEvent(key('Space', { ctrlKey: true }))).toEqual({
      kind: 'action',
      action: 'clearNotifications',
    });
    // Plain HOME is not a binding, so it must not home.
    expect(shortcutForEvent(key('Home'))).toBeNull();
    // Nor is CTRL+ESC an abort.
    expect(shortcutForEvent(key('Escape', { ctrlKey: true }))).toBeNull();
  });

  it('jogs each axis in both directions', () => {
    expect(shortcutForEvent(key('ArrowRight'))).toEqual({
      kind: 'jog',
      axis: 'x',
      direction: 'positive',
    });
    expect(shortcutForEvent(key('ArrowLeft'))).toEqual({
      kind: 'jog',
      axis: 'x',
      direction: 'negative',
    });
    expect(shortcutForEvent(key('ArrowUp'))).toEqual({
      kind: 'jog',
      axis: 'y',
      direction: 'positive',
    });
    expect(shortcutForEvent(key('ArrowDown'))).toEqual({
      kind: 'jog',
      axis: 'y',
      direction: 'negative',
    });
    expect(shortcutForEvent(key('PageUp'))).toEqual({
      kind: 'jog',
      axis: 'z',
      direction: 'positive',
    });
    expect(shortcutForEvent(key('PageDown'))).toEqual({
      kind: 'jog',
      axis: 'z',
      direction: 'negative',
    });
  });

  it('a shifted jog is still that jog — the modifier changes the speed, not the axis', () => {
    expect(shortcutForEvent(key('ArrowRight', { shiftKey: true }))).toEqual({
      kind: 'jog',
      axis: 'x',
      direction: 'positive',
    });
  });

  it('digits set the jog speed, shifted the rapid override, with control the feed', () => {
    expect(shortcutForEvent(key('Digit5'))).toEqual({
      kind: 'speed',
      target: 'jog',
      percent: 50,
    });
    expect(shortcutForEvent(key('Digit0'))).toEqual({
      kind: 'speed',
      target: 'jog',
      percent: 100,
    });
    expect(shortcutForEvent(key('Backquote'))).toEqual({
      kind: 'speed',
      target: 'jog',
      percent: 0,
    });
    expect(shortcutForEvent(key('Digit3', { shiftKey: true }))).toEqual({
      kind: 'speed',
      target: 'rapid',
      percent: 30,
    });
    expect(shortcutForEvent(key('Digit3', { ctrlKey: true }))).toEqual({
      kind: 'speed',
      target: 'feed',
      percent: 30,
    });
  });

  it('a feed override of zero is not offered, because upstream does not offer it', () => {
    expect(shortcutForEvent(key('Backquote', { ctrlKey: true }))).toBeNull();
  });

  it('an unexpected modifier is not a binding at all', () => {
    // A mistyped ALT or CMD must not jog the machine.
    expect(shortcutForEvent(key('ArrowRight', { altKey: true }))).toBeNull();
    expect(shortcutForEvent(key('ArrowRight', { metaKey: true }))).toBeNull();
    expect(shortcutForEvent(key('ArrowRight', { ctrlKey: true }))).toBeNull();
    expect(shortcutForEvent(key('Digit3', { ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it('unbound keys are listed with a reason rather than dropped', () => {
    expect(shortcutForEvent(key('F9'))).toBeNull();
    expect(UNBOUND.F9).toContain('manual cut');
    expect(UNBOUND.BracketLeft).toContain('A axis');
  });
});
