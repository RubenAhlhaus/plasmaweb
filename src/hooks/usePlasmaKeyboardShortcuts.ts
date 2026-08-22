import { useEffect, useRef } from 'react';

import { eventBus } from '@/eventBus';
import { useSendCommand } from '@/api/backendCommands';
import { shortcutForEvent, type PlasmaShortcut } from '@/lib/plasmaShortcuts';
import { shouldIgnoreGlobalHotkeyTarget } from '@/lib/virtualSidebarHotkeys';
import { usePlasmaCommands } from '@/hooks/usePlasmaCommands';
import { useAppStore } from '@/store';
import { clampJogVelocityMmPerMin, MAX_JOG_VELOCITY_MM_MIN } from '@/lib/jogVelocity';

/** Keys that modify a jog while held, as upstream allows: `+` is rapid, `-` is slow. */
const RAPID_KEYS = new Set(['Equal', 'NumpadAdd']);
const SLOW_KEYS = new Set(['Minus', 'NumpadSubtract']);

/** A slow jog is a tenth of the shown speed (upstream's own factor). */
const SLOW_FACTOR = 0.1;

/**
 * QtPlasmaC's keyboard shortcuts, for machines that have a keyboard.
 *
 * Off unless the machine's own prefs say otherwise (`[GUI_OPTIONS] Use keyboard shortcuts`),
 * which is upstream's default and the safe one: these jog a torch and abort programs.
 *
 * Jogging is held — press starts, release stops — so a key that goes down and never comes up
 * (window blurred, focus stolen, alt-tab) has to stop the axis too, which is why blur is
 * handled as an all-keys-up.
 *
 * What a held key actually does follows this UI's jog mode, the same as the on-screen arrows:
 * one increment per press in incremental mode, motion while held in continuous. Upstream is
 * always continuous, but a keyboard that behaves differently from the buttons beside it would
 * be the more surprising of the two.
 */
export function usePlasmaKeyboardShortcuts(): void {
  const enabled = useAppStore(
    (s) => s.plasmaParameters?.guiOptions?.keyboardShortcuts === true,
  );
  const sendCommand = useSendCommand();
  const plasma = usePlasmaCommands();

  // Which axes this hook has started jogging, so exactly those get stopped.
  const joggingRef = useRef<Set<'x' | 'y' | 'z'>>(new Set());
  // The jog speed to put back once a rapid or slow jog ends.
  const restoreVelocityRef = useRef<number | null>(null);
  const speedModifiersRef = useRef<{ rapid: boolean; slow: boolean }>({
    rapid: false,
    slow: false,
  });

  useEffect(() => {
    if (!enabled) return;

    const restoreVelocity = () => {
      if (restoreVelocityRef.current === null) return;
      useAppStore.getState().setJogVelocityMmPerMin(restoreVelocityRef.current);
      restoreVelocityRef.current = null;
    };

    const stopAll = () => {
      for (const axis of joggingRef.current) eventBus.publish('jog.stop', { axis });
      joggingRef.current.clear();
      speedModifiersRef.current = { rapid: false, slow: false };
      restoreVelocity();
    };

    const applySpeed = (shortcut: Extract<PlasmaShortcut, { kind: 'speed' }>) => {
      if (shortcut.target === 'feed') {
        eventBus.publish('ui.feed.setOverride', {
          percent: shortcut.percent,
          source: 'hotkey',
        });
        return;
      }
      if (shortcut.target === 'rapid') {
        // Rapid override is a machine command rather than a UI slider, and takes a fraction.
        sendCommand('machine', 'rapid_override', { factor: shortcut.percent / 100 });
        return;
      }
      // Upstream takes the digit as a percentage of the INI's DEFAULT_LINEAR_VELOCITY. This UI
      // owns its jog speed rather than deriving it from the INI, so the percentage applies to
      // the jog slider's range instead — same gesture, this UI's scale.
      useAppStore
        .getState()
        .setJogVelocityMmPerMin(
          clampJogVelocityMmPerMin((MAX_JOG_VELOCITY_MM_MIN * shortcut.percent) / 100),
        );
    };

    const runAction = (action: Extract<PlasmaShortcut, { kind: 'action' }>['action']) => {
      switch (action) {
        case 'abort':
          eventBus.publish('ui.program.stop', {});
          break;
        case 'pauseToggle':
          eventBus.publish('ui.program.pause', {});
          break;
        case 'cycleStart':
          eventBus.publish('ui.program.cycleStart', {});
          break;
        case 'homeAll':
          // Upstream's CTRL+HOME unhomes an already-homed machine; that is a deliberate act
          // there and would be a surprise from a keystroke here, so this only homes.
          sendCommand('motion', 'home', { joint: -1 });
          break;
        case 'touchOffXY':
          // The work origin, not a tool offset: END puts X0 Y0 where the torch is standing.
          sendCommand('motion', 'set_axis_coordinate', { axis: 'x', value: 0 });
          sendCommand('motion', 'set_axis_coordinate', { axis: 'y', value: 0 });
          break;
        case 'estopToggle':
          eventBus.publish('ui.estop.toggle', {});
          break;
        case 'powerToggle':
          eventBus.publish('ui.machine.toggle', {});
          break;
        case 'reloadProgram':
          sendCommand('program', 'open', {
            path: useAppStore.getState().linuxCncStatus?.program?.file ?? '',
          });
          break;
        case 'clearNotifications':
          useAppStore.getState().clearErrorToasts?.();
          break;
        case 'alignmentPress':
          plasma.alignmentPress('laser');
          break;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (shouldIgnoreGlobalHotkeyTarget(event.target)) return;
      // A dialog owns the keyboard while it is open: its own Escape and Enter must win.
      if (document.querySelector('[role="dialog"]')) return;

      if (RAPID_KEYS.has(event.code)) {
        speedModifiersRef.current.rapid = true;
        return;
      }
      if (SLOW_KEYS.has(event.code)) {
        speedModifiersRef.current.slow = true;
        return;
      }

      const shortcut = shortcutForEvent(event);
      if (!shortcut) return;

      if (shortcut.kind === 'jog') {
        // Auto-repeat would re-send the start every few milliseconds; the axis is already
        // moving, so only the first press matters.
        if (event.repeat) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        // A rapid or slow jog changes the speed for as long as the key is held, and puts it
        // back afterwards — the operator's own jog speed is not theirs to keep.
        const { rapid, slow } = speedModifiersRef.current;
        const store = useAppStore.getState();
        if ((rapid || event.shiftKey || slow) && restoreVelocityRef.current === null) {
          restoreVelocityRef.current = store.jogVelocityMmPerMin;
          store.setJogVelocityMmPerMin(
            rapid || event.shiftKey
              ? MAX_JOG_VELOCITY_MM_MIN
              : clampJogVelocityMmPerMin(store.jogVelocityMmPerMin * SLOW_FACTOR),
          );
        }
        joggingRef.current.add(shortcut.axis);
        eventBus.publish('jog.move', { axis: shortcut.axis, direction: shortcut.direction });
        return;
      }

      if (event.repeat) return;
      event.preventDefault();
      if (shortcut.kind === 'speed') applySpeed(shortcut);
      else runAction(shortcut.action);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (RAPID_KEYS.has(event.code)) speedModifiersRef.current.rapid = false;
      if (SLOW_KEYS.has(event.code)) speedModifiersRef.current.slow = false;

      const shortcut = shortcutForEvent(event);
      if (shortcut?.kind !== 'jog') return;
      if (!joggingRef.current.delete(shortcut.axis)) return;
      eventBus.publish('jog.stop', { axis: shortcut.axis });
      if (joggingRef.current.size === 0) restoreVelocity();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', stopAll);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', stopAll);
      // Unmounting while an axis is moving must not leave it moving.
      stopAll();
    };
  }, [enabled, plasma, sendCommand]);
}
