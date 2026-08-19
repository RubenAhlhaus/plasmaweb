import { describe, expect, it } from 'vitest';
import {
  applyFeedOverridePreset,
  FEED_ZERO_PAUSE_IDLE,
  isFeedOverrideAtZero,
  OVERRIDE_MIN_FACTOR,
  reactToFeedZeroPauseCommandResult,
  reactToFeedZeroPauseStatus,
  shouldIgnoreFeedOverrideLeavingZero,
  type FeedZeroPausePhase,
} from '../feedOverridePresetAction';
import { InterpState, TaskMode } from '@/store/types';
import type { LinuxCncStatusRoot } from '@/store/types';

function status(partial: {
  task_mode?: TaskMode;
  interp_state?: InterpState;
  paused?: boolean;
  feedrate?: number;
}): LinuxCncStatusRoot {
  return {
    machine: { task_mode: partial.task_mode },
    program: {
      interp_state: partial.interp_state,
      paused: partial.paused,
    },
    overrides:
      partial.feedrate === undefined ? undefined : { feedrate: partial.feedrate },
  } as LinuxCncStatusRoot;
}

const running = status({
  task_mode: TaskMode.MODE_AUTO,
  interp_state: InterpState.INTERP_READING,
});
const paused = status({
  task_mode: TaskMode.MODE_AUTO,
  interp_state: InterpState.INTERP_PAUSED,
});
const idle = status({
  task_mode: TaskMode.MODE_MANUAL,
  interp_state: InterpState.INTERP_IDLE,
});

describe('isFeedOverrideAtZero / shouldIgnoreFeedOverrideLeavingZero', () => {
  it('detects zero via last accepted preset, ownership phase, or status ~1% without history', () => {
    expect(isFeedOverrideAtZero(0, FEED_ZERO_PAUSE_IDLE, idle)).toBe(true);
    expect(isFeedOverrideAtZero(100, { phase: 'owned' }, idle)).toBe(true);
    expect(
      isFeedOverrideAtZero(
        null,
        FEED_ZERO_PAUSE_IDLE,
        status({ feedrate: OVERRIDE_MIN_FACTOR }),
      ),
    ).toBe(true);
    expect(
      isFeedOverrideAtZero(
        100,
        FEED_ZERO_PAUSE_IDLE,
        status({ feedrate: OVERRIDE_MIN_FACTOR }),
      ),
    ).toBe(false);
    expect(isFeedOverrideAtZero(100, FEED_ZERO_PAUSE_IDLE, idle)).toBe(false);
    expect(isFeedOverrideAtZero(null, FEED_ZERO_PAUSE_IDLE, idle)).toBe(false);
  });

  it('ignores >100% only when at feed zero', () => {
    expect(shouldIgnoreFeedOverrideLeavingZero(0, 200, FEED_ZERO_PAUSE_IDLE, idle)).toBe(
      true,
    );
    expect(shouldIgnoreFeedOverrideLeavingZero(0, 125, FEED_ZERO_PAUSE_IDLE, idle)).toBe(
      true,
    );
    expect(shouldIgnoreFeedOverrideLeavingZero(0, 100, FEED_ZERO_PAUSE_IDLE, idle)).toBe(
      false,
    );
    expect(
      shouldIgnoreFeedOverrideLeavingZero(100, 200, { phase: 'owned' }, idle),
    ).toBe(true);
    expect(
      shouldIgnoreFeedOverrideLeavingZero(
        null,
        200,
        FEED_ZERO_PAUSE_IDLE,
        status({ feedrate: OVERRIDE_MIN_FACTOR }),
      ),
    ).toBe(true);
  });

  it('allows >100% when not at feed zero', () => {
    expect(shouldIgnoreFeedOverrideLeavingZero(null, 200, FEED_ZERO_PAUSE_IDLE, idle)).toBe(
      false,
    );
    expect(shouldIgnoreFeedOverrideLeavingZero(100, 200, FEED_ZERO_PAUSE_IDLE, idle)).toBe(
      false,
    );
    expect(shouldIgnoreFeedOverrideLeavingZero(50, 150, FEED_ZERO_PAUSE_IDLE, idle)).toBe(
      false,
    );
  });
});

describe('applyFeedOverridePreset', () => {
  it('sets ~1% when percent is 0 and no program is running', () => {
    const result = applyFeedOverridePreset(0, idle, FEED_ZERO_PAUSE_IDLE, () => 'pause-1');
    expect(result.accepted).toBe(true);
    expect(result.phase).toEqual(FEED_ZERO_PAUSE_IDLE);
    expect(result.commands).toEqual([
      {
        category: 'machine',
        action: 'feed_override',
        params: { factor: OVERRIDE_MIN_FACTOR },
      },
    ]);
  });

  it('requests pause when percent is 0 and AUTO program is running', () => {
    const result = applyFeedOverridePreset(0, running, FEED_ZERO_PAUSE_IDLE, () => 'pause-1');
    expect(result.accepted).toBe(true);
    expect(result.phase).toEqual({ phase: 'pause_requested', commandId: 'pause-1' });
    expect(result.commands).toEqual([
      {
        category: 'program',
        action: 'auto',
        params: { command: 'pause' },
        commandId: 'pause-1',
      },
    ]);
  });

  it('does not claim ownership until status confirms pause', () => {
    const requested: FeedZeroPausePhase = {
      phase: 'pause_requested',
      commandId: 'pause-1',
    };
    const stillRunning = applyFeedOverridePreset(0, running, requested, () => 'pause-2');
    expect(stillRunning.accepted).toBe(true);
    expect(stillRunning.phase).toEqual(requested);
    expect(stillRunning.commands).toEqual([]);
  });

  it('sets ~1% on percent 0 when manually paused (does not claim ownership)', () => {
    const result = applyFeedOverridePreset(0, paused, FEED_ZERO_PAUSE_IDLE, () => 'pause-1');
    expect(result.accepted).toBe(true);
    expect(result.phase).toEqual(FEED_ZERO_PAUSE_IDLE);
    expect(result.commands).toEqual([
      {
        category: 'machine',
        action: 'feed_override',
        params: { factor: OVERRIDE_MIN_FACTOR },
      },
    ]);
  });

  it('defers resume when leaving 0 before pause is confirmed', () => {
    const requested: FeedZeroPausePhase = {
      phase: 'pause_requested',
      commandId: 'pause-1',
    };
    const result = applyFeedOverridePreset(50, running, requested, () => 'pause-2');
    expect(result.accepted).toBe(true);
    expect(result.phase).toEqual({
      phase: 'resume_pending',
      percent: 50,
      pauseCommandId: 'pause-1',
    });
    expect(result.commands).toEqual([
      {
        category: 'machine',
        action: 'feed_override',
        params: { factor: 0.5 },
      },
    ]);
  });

  it('resumes immediately when leaving 0 after ownership is confirmed', () => {
    const owned: FeedZeroPausePhase = { phase: 'owned' };
    const result = applyFeedOverridePreset(50, paused, owned, () => 'pause-1');
    expect(result.accepted).toBe(true);
    expect(result.phase).toEqual(FEED_ZERO_PAUSE_IDLE);
    expect(result.commands).toEqual([
      {
        category: 'machine',
        action: 'feed_override',
        params: { factor: 0.5 },
      },
      { category: 'program', action: 'auto', params: { command: 'resume' } },
    ]);
  });

  it('does not resume when override > 0 after a manual pause', () => {
    const result = applyFeedOverridePreset(80, paused, FEED_ZERO_PAUSE_IDLE, () => 'pause-1');
    expect(result.accepted).toBe(true);
    expect(result.phase).toEqual(FEED_ZERO_PAUSE_IDLE);
    expect(result.commands).toEqual([
      {
        category: 'machine',
        action: 'feed_override',
        params: { factor: 0.8 },
      },
    ]);
  });

  it('rejects >100% from feed zero without changing phase', () => {
    const owned: FeedZeroPausePhase = { phase: 'owned' };
    const result = applyFeedOverridePreset(200, paused, owned, () => 'pause-1', 0);
    expect(result).toEqual({ commands: [], phase: owned, accepted: false });
  });

  it('rejects >100% when status feedrate is ~1% and no preset history', () => {
    const atMin = status({
      task_mode: TaskMode.MODE_MANUAL,
      interp_state: InterpState.INTERP_IDLE,
      feedrate: OVERRIDE_MIN_FACTOR,
    });
    const result = applyFeedOverridePreset(
      200,
      atMin,
      FEED_ZERO_PAUSE_IDLE,
      () => 'pause-1',
      null,
    );
    expect(result.accepted).toBe(false);
    expect(result.commands).toEqual([]);
  });

  it('does not treat stale ~1% status as zero after a >0 preset was accepted', () => {
    const atMin = status({
      task_mode: TaskMode.MODE_MANUAL,
      interp_state: InterpState.INTERP_IDLE,
      feedrate: OVERRIDE_MIN_FACTOR,
    });
    const result = applyFeedOverridePreset(
      200,
      atMin,
      FEED_ZERO_PAUSE_IDLE,
      () => 'pause-1',
      100,
    );
    expect(result.accepted).toBe(true);
    expect(result.commands).toEqual([
      {
        category: 'machine',
        action: 'feed_override',
        params: { factor: 2 },
      },
    ]);
  });
});

describe('reactToFeedZeroPauseStatus', () => {
  it('confirms ownership when pause becomes visible', () => {
    const result = reactToFeedZeroPauseStatus(paused, {
      phase: 'pause_requested',
      commandId: 'pause-1',
    });
    expect(result).toEqual({
      commands: [],
      phase: { phase: 'owned' },
      accepted: true,
    });
  });

  it('resumes a deferred leave-0 once pause is visible', () => {
    const result = reactToFeedZeroPauseStatus(paused, {
      phase: 'resume_pending',
      percent: 50,
      pauseCommandId: 'pause-1',
    });
    expect(result.phase).toEqual(FEED_ZERO_PAUSE_IDLE);
    expect(result.accepted).toBe(true);
    expect(result.commands).toEqual([
      {
        category: 'machine',
        action: 'feed_override',
        params: { factor: 0.5 },
      },
      { category: 'program', action: 'auto', params: { command: 'resume' } },
    ]);
  });

  it('clears ownership when the program is no longer paused', () => {
    const result = reactToFeedZeroPauseStatus(running, { phase: 'owned' });
    expect(result).toEqual({
      commands: [],
      phase: FEED_ZERO_PAUSE_IDLE,
      accepted: true,
    });
  });

  it('clears pause_requested when the program aborts to idle', () => {
    const result = reactToFeedZeroPauseStatus(idle, {
      phase: 'pause_requested',
      commandId: 'pause-1',
    });
    expect(result).toEqual({
      commands: [],
      phase: FEED_ZERO_PAUSE_IDLE,
      accepted: true,
    });
  });
});

describe('reactToFeedZeroPauseCommandResult', () => {
  it('clears pause_requested when our pause command fails', () => {
    const next = reactToFeedZeroPauseCommandResult(
      { commandId: 'pause-1', ok: false },
      { phase: 'pause_requested', commandId: 'pause-1' },
    );
    expect(next).toEqual(FEED_ZERO_PAUSE_IDLE);
  });

  it('clears resume_pending when the underlying pause command fails', () => {
    const next = reactToFeedZeroPauseCommandResult(
      { commandId: 'pause-1', ok: false },
      { phase: 'resume_pending', percent: 50, pauseCommandId: 'pause-1' },
    );
    expect(next).toEqual(FEED_ZERO_PAUSE_IDLE);
  });

  it('ignores unrelated or successful command results', () => {
    const phase: FeedZeroPausePhase = {
      phase: 'pause_requested',
      commandId: 'pause-1',
    };
    expect(
      reactToFeedZeroPauseCommandResult({ commandId: 'other', ok: false }, phase),
    ).toEqual(phase);
    expect(
      reactToFeedZeroPauseCommandResult({ commandId: 'pause-1', ok: true }, phase),
    ).toEqual(phase);
  });
});
