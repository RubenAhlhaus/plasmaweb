import { generateCommandId } from '@/api/backendCommands';
import type { LastWsCommandResult, LinuxCncStatusRoot } from '@/store/types';
import { InterpState, TaskMode } from '@/store/types';
import { isProgramInterpreterPaused } from '@/utils/isProgramInterpreterPaused';

/** LinuxCNC clamps feed/spindle override to ~1%; UI "0 %" maps to this factor. */
export const OVERRIDE_MIN_FACTOR = 0.01;

export type FeedZeroPausePhase =
  | { phase: 'idle' }
  | { phase: 'pause_requested'; commandId: string }
  | { phase: 'owned' }
  | { phase: 'resume_pending'; percent: number; pauseCommandId: string };

export type FeedOverridePresetCommand =
  | {
      category: 'machine';
      action: 'feed_override';
      params: { factor: number };
    }
  | {
      category: 'program';
      action: 'auto';
      params: { command: 'pause' | 'resume' };
      commandId?: string;
    };

export type FeedOverridePresetResolution = {
  commands: FeedOverridePresetCommand[];
  phase: FeedZeroPausePhase;
  /** False when the from-zero wrap guard rejected the preset. */
  accepted: boolean;
};

export const FEED_ZERO_PAUSE_IDLE: FeedZeroPausePhase = { phase: 'idle' };

/**
 * True when feed is treated as preset 0 for the encoder-wrap guard:
 * pause-ownership (`pause_requested`/`owned`), last accepted hotkey ≤ 0,
 * or (no hotkey history yet) status ~1 %.
 */
export function isFeedOverrideAtZero(
  lastAcceptedPercent: number | null,
  phase: FeedZeroPausePhase,
  status: LinuxCncStatusRoot,
): boolean {
  if (phase.phase === 'pause_requested' || phase.phase === 'owned') {
    return true;
  }
  if (lastAcceptedPercent != null) {
    return lastAcceptedPercent <= 0;
  }
  const feedrate = status.overrides?.feedrate;
  return typeof feedrate === 'number' && feedrate <= OVERRIDE_MIN_FACTOR;
}

/**
 * Blocks encoder wrap from feed 0 % to >100 % (positions 11–15).
 */
export function shouldIgnoreFeedOverrideLeavingZero(
  lastAcceptedPercent: number | null,
  nextPercent: number,
  phase: FeedZeroPausePhase,
  status: LinuxCncStatusRoot,
): boolean {
  return nextPercent > 100 && isFeedOverrideAtZero(lastAcceptedPercent, phase, status);
}

/** True when AUTO program is actively running (pause is valid; not already paused). */
export function isProgramRunningForFeedPause(status: LinuxCncStatusRoot): boolean {
  const taskMode = status.machine?.task_mode;
  const interpState = status.program?.interp_state;
  return (
    taskMode === TaskMode.MODE_AUTO &&
    (interpState === InterpState.INTERP_READING ||
      interpState === InterpState.INTERP_WAITING)
  );
}

function feedOverrideCommand(percent: number): FeedOverridePresetCommand {
  return {
    category: 'machine',
    action: 'feed_override',
    params: { factor: percent / 100 },
  };
}

function phasesEqual(a: FeedZeroPausePhase, b: FeedZeroPausePhase): boolean {
  if (a.phase !== b.phase) return false;
  if (a.phase === 'pause_requested' && b.phase === 'pause_requested') {
    return a.commandId === b.commandId;
  }
  if (a.phase === 'resume_pending' && b.phase === 'resume_pending') {
    return a.percent === b.percent && a.pauseCommandId === b.pauseCommandId;
  }
  return true;
}

function accepted(
  commands: FeedOverridePresetCommand[],
  phase: FeedZeroPausePhase,
): FeedOverridePresetResolution {
  return { commands, phase, accepted: true };
}

/**
 * Resolves a feed-override rotary preset against the current pause-ownership phase.
 * Position 0 (percent ≤ 0): request program pause while AUTO is running; otherwise ~1 %.
 * Leaving 0: set override, then resume only after ownership is confirmed (or when already paused).
 * From feed 0, percent > 100 is rejected (`accepted: false`).
 */
export function applyFeedOverridePreset(
  percent: number,
  status: LinuxCncStatusRoot,
  phase: FeedZeroPausePhase,
  allocatePauseCommandId: () => string = generateCommandId,
  lastAcceptedPercent: number | null = null,
): FeedOverridePresetResolution {
  if (shouldIgnoreFeedOverrideLeavingZero(lastAcceptedPercent, percent, phase, status)) {
    return { commands: [], phase, accepted: false };
  }

  if (percent <= 0) {
    if (isProgramRunningForFeedPause(status)) {
      const commandId =
        phase.phase === 'pause_requested'
          ? phase.commandId
          : phase.phase === 'resume_pending'
            ? phase.pauseCommandId
            : allocatePauseCommandId();
      const alreadyRequested =
        phase.phase === 'pause_requested' || phase.phase === 'resume_pending';
      return accepted(
        alreadyRequested
          ? []
          : [
              {
                category: 'program',
                action: 'auto',
                params: { command: 'pause' },
                commandId,
              },
            ],
        { phase: 'pause_requested', commandId },
      );
    }

    if (isProgramInterpreterPaused(status)) {
      if (
        phase.phase === 'owned' ||
        phase.phase === 'pause_requested' ||
        phase.phase === 'resume_pending'
      ) {
        return accepted([], { phase: 'owned' });
      }
      return accepted(
        [
          {
            category: 'machine',
            action: 'feed_override',
            params: { factor: OVERRIDE_MIN_FACTOR },
          },
        ],
        FEED_ZERO_PAUSE_IDLE,
      );
    }

    return accepted(
      [
        {
          category: 'machine',
          action: 'feed_override',
          params: { factor: OVERRIDE_MIN_FACTOR },
        },
      ],
      FEED_ZERO_PAUSE_IDLE,
    );
  }

  const commands: FeedOverridePresetCommand[] = [feedOverrideCommand(percent)];

  if (phase.phase === 'owned') {
    if (isProgramInterpreterPaused(status)) {
      commands.push({
        category: 'program',
        action: 'auto',
        params: { command: 'resume' },
      });
    }
    return accepted(commands, FEED_ZERO_PAUSE_IDLE);
  }

  if (phase.phase === 'pause_requested') {
    if (isProgramInterpreterPaused(status)) {
      commands.push({
        category: 'program',
        action: 'auto',
        params: { command: 'resume' },
      });
      return accepted(commands, FEED_ZERO_PAUSE_IDLE);
    }
    return accepted(commands, {
      phase: 'resume_pending',
      percent,
      pauseCommandId: phase.commandId,
    });
  }

  if (phase.phase === 'resume_pending') {
    if (isProgramInterpreterPaused(status)) {
      commands.push({
        category: 'program',
        action: 'auto',
        params: { command: 'resume' },
      });
      return accepted(commands, FEED_ZERO_PAUSE_IDLE);
    }
    return accepted(commands, {
      phase: 'resume_pending',
      percent,
      pauseCommandId: phase.pauseCommandId,
    });
  }

  return accepted(commands, FEED_ZERO_PAUSE_IDLE);
}

/**
 * Reacts to LinuxCNC status after a feed-0 pause was requested (or resume was deferred).
 * Confirms ownership only once the interpreter is actually paused.
 */
export function reactToFeedZeroPauseStatus(
  status: LinuxCncStatusRoot,
  phase: FeedZeroPausePhase,
): FeedOverridePresetResolution {
  if (phase.phase === 'pause_requested') {
    if (isProgramInterpreterPaused(status)) {
      return accepted([], { phase: 'owned' });
    }
    if (!isProgramRunningForFeedPause(status)) {
      return accepted([], FEED_ZERO_PAUSE_IDLE);
    }
    return accepted([], phase);
  }

  if (phase.phase === 'resume_pending') {
    if (isProgramInterpreterPaused(status)) {
      return accepted(
        [
          feedOverrideCommand(phase.percent),
          {
            category: 'program',
            action: 'auto',
            params: { command: 'resume' },
          },
        ],
        FEED_ZERO_PAUSE_IDLE,
      );
    }
    if (!isProgramRunningForFeedPause(status)) {
      return accepted([], FEED_ZERO_PAUSE_IDLE);
    }
    return accepted([], phase);
  }

  if (phase.phase === 'owned') {
    if (!isProgramInterpreterPaused(status)) {
      return accepted([], FEED_ZERO_PAUSE_IDLE);
    }
    return accepted([], phase);
  }

  return accepted([], phase);
}

/** Clears pending pause ownership when our pause command fails. */
export function reactToFeedZeroPauseCommandResult(
  result: Pick<LastWsCommandResult, 'commandId' | 'ok'>,
  phase: FeedZeroPausePhase,
): FeedZeroPausePhase {
  if (result.ok) return phase;

  if (phase.phase === 'pause_requested' && phase.commandId === result.commandId) {
    return FEED_ZERO_PAUSE_IDLE;
  }
  if (phase.phase === 'resume_pending' && phase.pauseCommandId === result.commandId) {
    return FEED_ZERO_PAUSE_IDLE;
  }
  return phase;
}

export function feedZeroPausePhaseEquals(
  a: FeedZeroPausePhase,
  b: FeedZeroPausePhase,
): boolean {
  return phasesEqual(a, b);
}
