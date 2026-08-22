import type { UiJogRequest } from '@/api/jogTypes';

/**
 * QtPlasmaC's keyboard shortcuts, as data (`qtplasmac.adoc` "Keyboard Shortcuts").
 *
 * They are **off by default**, both there and here, and that is not caution for its own sake:
 * these jog a torch and abort programs, so a keyboard sitting on a bench near a running table
 * must not be able to do either by accident. The machine's owner turns them on in the prefs
 * file, which is the same place every other machine decision lives.
 *
 * Kept separate from the listener so the mapping can be read, tested and compared with the
 * documented table without a DOM.
 */

/** One-shot actions: the key does its thing on press and nothing on release. */
export type PlasmaShortcutAction =
  | 'abort'
  | 'pauseToggle'
  | 'cycleStart'
  | 'homeAll'
  | 'touchOffXY'
  | 'estopToggle'
  | 'powerToggle'
  | 'reloadProgram'
  | 'clearNotifications'
  | 'alignmentPress';

/** Held actions: press starts, release stops. Only jogging behaves this way. */
export interface PlasmaJogShortcut {
  kind: 'jog';
  axis: UiJogRequest['axis'];
  direction: UiJogRequest['direction'];
}

export interface PlasmaActionShortcut {
  kind: 'action';
  action: PlasmaShortcutAction;
}

/** A digit sets a speed as a percentage: the jog speed, the rapid override or the feed. */
export interface PlasmaSpeedShortcut {
  kind: 'speed';
  /** Which speed the digit sets: jog, rapid override or feed override. */
  target: 'jog' | 'rapid' | 'feed';
  percent: number;
}

export type PlasmaShortcut = PlasmaJogShortcut | PlasmaActionShortcut | PlasmaSpeedShortcut;

/**
 * Codes we deliberately do not bind, with the reason. Listed rather than dropped: someone
 * comparing this with upstream's table should be able to see what is missing and why.
 */
export const UNBOUND: Record<string, string> = {
  F9: 'manual cut is not implemented yet',
  KeyO: 'the program browser is opened from the program screen, not by a keystroke',
  F12: 'there is no stylesheet editor in this UI',
  'ALT+Enter': 'the MDI is a screen here rather than a pop-up',
  BracketLeft: 'this machine has no A axis in the jog API',
  BracketRight: 'this machine has no A axis in the jog API',
  Period: 'this machine has no B axis in the jog API',
  Comma: 'this machine has no B axis in the jog API',
};

/** Digits in upstream's order: backquote is 0%, then 1..9 are 10%..90%, and 0 is 100%. */
const DIGIT_PERCENT: Record<string, number> = {
  Backquote: 0,
  Digit1: 10,
  Digit2: 20,
  Digit3: 30,
  Digit4: 40,
  Digit5: 50,
  Digit6: 60,
  Digit7: 70,
  Digit8: 80,
  Digit9: 90,
  Digit0: 100,
};

const JOGS: Record<string, PlasmaJogShortcut> = {
  ArrowRight: { kind: 'jog', axis: 'x', direction: 'positive' },
  ArrowLeft: { kind: 'jog', axis: 'x', direction: 'negative' },
  ArrowUp: { kind: 'jog', axis: 'y', direction: 'positive' },
  ArrowDown: { kind: 'jog', axis: 'y', direction: 'negative' },
  PageUp: { kind: 'jog', axis: 'z', direction: 'positive' },
  PageDown: { kind: 'jog', axis: 'z', direction: 'negative' },
};

/**
 * The shortcut for one key event, or `null` when the key is not bound.
 *
 * Modifiers are part of the identity, not decoration: CTRL+HOME homes, plain HOME does not, and
 * SHIFT+digit sets the rapid override rather than the jog speed. A key with an unexpected
 * modifier resolves to `null` rather than to its unmodified meaning — a mistyped CTRL must not
 * silently jog the machine.
 */
export function shortcutForEvent(event: {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): PlasmaShortcut | null {
  const { code, ctrlKey, shiftKey, altKey, metaKey } = event;
  if (metaKey || altKey) return null;

  // Speed digits: plain sets the jog speed, SHIFT the rapid override, CTRL the feed override.
  const percent = DIGIT_PERCENT[code];
  if (percent !== undefined) {
    if (ctrlKey && !shiftKey) {
      // CTRL+` is not in upstream's table; only 1-9 and 0 set the feed override.
      return code === 'Backquote' ? null : { kind: 'speed', target: 'feed', percent };
    }
    if (shiftKey && !ctrlKey) return { kind: 'speed', target: 'rapid', percent };
    if (!shiftKey && !ctrlKey) return { kind: 'speed', target: 'jog', percent };
    return null;
  }

  // Jogging. SHIFT (or +) is a rapid jog and - is a slow one; both still jog the same axis, so
  // the modifier is handled by the caller from the event rather than changing the mapping.
  const jog = JOGS[code];
  if (jog) return ctrlKey ? null : jog;

  if (ctrlKey) {
    switch (code) {
      case 'Home':
        return { kind: 'action', action: 'homeAll' };
      case 'KeyR':
        return { kind: 'action', action: 'cycleStart' };
      case 'Space':
        return { kind: 'action', action: 'clearNotifications' };
      default:
        return null;
    }
  }

  if (shiftKey) return null;

  switch (code) {
    case 'Escape':
      return { kind: 'action', action: 'abort' };
    case 'F1':
      return { kind: 'action', action: 'estopToggle' };
    case 'F2':
      return { kind: 'action', action: 'powerToggle' };
    case 'End':
      return { kind: 'action', action: 'touchOffXY' };
    case 'Delete':
      return { kind: 'action', action: 'alignmentPress' };
    case 'Space':
      return { kind: 'action', action: 'pauseToggle' };
    case 'KeyL':
      return { kind: 'action', action: 'reloadProgram' };
    default:
      return null;
  }
}
