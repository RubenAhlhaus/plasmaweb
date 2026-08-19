import { useEffect, useRef } from 'react';
import { eventBus } from '@/eventBus';
import { useSendCommand } from '@/api/backendCommands';
import {
  applyFeedOverridePreset,
  FEED_ZERO_PAUSE_IDLE,
  feedZeroPausePhaseEquals,
  OVERRIDE_MIN_FACTOR,
  reactToFeedZeroPauseCommandResult,
  reactToFeedZeroPauseStatus,
  type FeedOverridePresetCommand,
  type FeedZeroPausePhase,
} from '@/lib/feedOverridePresetAction';
import { createLatestWinsScheduler } from '@/lib/latestWinsScheduler';
import { useAppStore } from '@/store';
import { TaskState } from '@/store/types';
import type { LinuxCncStatusRoot } from '@/store/types';

/** Quiet window before sending the latest override percent (rotary encoders). */
export const OVERRIDE_HOTKEY_COALESCE_MS = 50;

function sendPresetCommands(
  sendCommand: ReturnType<typeof useSendCommand>,
  commands: FeedOverridePresetCommand[],
): void {
  for (const cmd of commands) {
    sendCommand(
      cmd.category,
      cmd.action,
      cmd.params,
      'commandId' in cmd ? cmd.commandId : undefined,
    );
  }
}

/**
 * Subscribes to ui.machine.toggle, ui.estop.toggle, ui.flood.toggle, ui.spindle.direction,
 * ui.hal.softkey, and feed/spindle override presets; maps them to machine.* / hal.* WebSocket commands.
 * Call once at app root (e.g. App.tsx).
 */
export function useMachineEventBridge(): void {
  const sendCommand = useSendCommand();
  const feedZeroPausePhaseRef = useRef<FeedZeroPausePhase>(FEED_ZERO_PAUSE_IDLE);
  /** Last feed preset percent accepted by applyFeedOverridePreset (null until first). */
  const lastAcceptedFeedPresetPercentRef = useRef<number | null>(null);

  useEffect(() => {
    const feedOverrideScheduler = createLatestWinsScheduler<number>(
      OVERRIDE_HOTKEY_COALESCE_MS,
      (percent) => {
        const status = useAppStore.getState().linuxCncStatus as LinuxCncStatusRoot;
        const resolved = applyFeedOverridePreset(
          percent,
          status,
          feedZeroPausePhaseRef.current,
          undefined,
          lastAcceptedFeedPresetPercentRef.current,
        );
        feedZeroPausePhaseRef.current = resolved.phase;
        if (resolved.accepted) {
          lastAcceptedFeedPresetPercentRef.current = percent;
        }
        sendPresetCommands(sendCommand, resolved.commands);
      },
    );
    const spindleOverrideScheduler = createLatestWinsScheduler<number>(
      OVERRIDE_HOTKEY_COALESCE_MS,
      (percent) => {
        const factor = percent <= 0 ? OVERRIDE_MIN_FACTOR : percent / 100;
        sendCommand('machine', 'spindle_override', {
          factor,
          spindle: 0,
        });
      },
    );

    const unsubMachine = eventBus.subscribe('ui.machine.toggle', () => {
      const taskState = useAppStore.getState().linuxCncStatus?.machine?.task_state;

      if (taskState === TaskState.STATE_ON) {
        sendCommand('machine', 'set_task_state', { status: TaskState.STATE_OFF });
      } else if (
        taskState === TaskState.STATE_OFF ||
        taskState === TaskState.STATE_ESTOP_RESET ||
        taskState === 0 ||
        taskState == null
      ) {
        sendCommand('machine', 'set_task_state', { status: TaskState.STATE_ON });
      }
      // When STATE_ESTOP, do nothing for machine toggle (user must reset estop first)
    });

    const unsubEstop = eventBus.subscribe('ui.estop.toggle', () => {
      const machine = useAppStore.getState().linuxCncStatus?.machine;
      const taskState = machine?.task_state;
      const hardwareEstop = machine?.error === true;
      const inEstop =
        taskState === TaskState.STATE_ESTOP || hardwareEstop === true;

      if (inEstop) {
        sendCommand('machine', 'set_task_state', {
          status: TaskState.STATE_ESTOP_RESET,
        });
      } else {
        sendCommand('machine', 'set_task_state', { status: TaskState.STATE_ESTOP });
      }
    });

    const unsubFlood = eventBus.subscribe('ui.flood.toggle', () => {
      const status = useAppStore.getState().linuxCncStatus;
      const taskState = status?.machine?.task_state;
      if (taskState !== TaskState.STATE_ON) {
        return;
      }

      const floodOn = (status?.io?.flood ?? 0) !== 0;
      sendCommand('machine', 'flood', { on: !floodOn });
    });

    const unsubSpindle = eventBus.subscribe('ui.spindle.direction', ({ direction }) => {
      sendCommand('machine', 'spindle', { direction });
    });

    const unsubHalSoftkey = eventBus.subscribe('ui.hal.softkey', ({ slot }) => {
      sendCommand('hal', 'softkey_pulse', { slot });
    });

    const unsubFeedOverride = eventBus.subscribe('ui.feed.setOverride', ({ percent }) => {
      feedOverrideScheduler.schedule(percent);
    });

    const unsubSpindleOverride = eventBus.subscribe(
      'ui.spindle.setOverride',
      ({ percent }) => {
        spindleOverrideScheduler.schedule(percent);
      },
    );

    const unsubStatus = useAppStore.subscribe((state, prevState) => {
      const nextInterp = state.linuxCncStatus.program?.interp_state;
      const prevInterp = prevState.linuxCncStatus.program?.interp_state;
      const nextMode = state.linuxCncStatus.machine?.task_mode;
      const prevMode = prevState.linuxCncStatus.machine?.task_mode;
      const nextPaused = state.linuxCncStatus.program?.paused;
      const prevPaused = prevState.linuxCncStatus.program?.paused;
      if (
        nextInterp === prevInterp &&
        nextMode === prevMode &&
        nextPaused === prevPaused
      ) {
        return;
      }

      const resolved = reactToFeedZeroPauseStatus(
        state.linuxCncStatus as LinuxCncStatusRoot,
        feedZeroPausePhaseRef.current,
      );
      if (
        resolved.commands.length === 0 &&
        feedZeroPausePhaseEquals(resolved.phase, feedZeroPausePhaseRef.current)
      ) {
        return;
      }
      feedZeroPausePhaseRef.current = resolved.phase;
      sendPresetCommands(sendCommand, resolved.commands);
    });

    const unsubCommandResult = useAppStore.subscribe((state, prevState) => {
      if (state.lastWsCommandResult === prevState.lastWsCommandResult) return;
      const result = state.lastWsCommandResult;
      if (!result) return;
      feedZeroPausePhaseRef.current = reactToFeedZeroPauseCommandResult(
        result,
        feedZeroPausePhaseRef.current,
      );
    });

    return () => {
      unsubMachine();
      unsubEstop();
      unsubFlood();
      unsubSpindle();
      unsubHalSoftkey();
      unsubFeedOverride();
      unsubSpindleOverride();
      unsubStatus();
      unsubCommandResult();
      feedOverrideScheduler.dispose();
      spindleOverrideScheduler.dispose();
    };
  }, [sendCommand]);
}
