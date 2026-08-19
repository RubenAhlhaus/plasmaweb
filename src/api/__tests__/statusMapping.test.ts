import { describe, expect, it } from 'vitest';
import {
  mapStatusMessageToStoreUpdates,
  mapCoordinatesChangedEventToStoreUpdates,
  isToolChangeRequestedEventMessage,
  type MotionCoordinatesChangedEventMessage,
  type StoreSnapshot,
  type LinuxCncStatusMessage,
} from '../statusMapping';
import { TaskState } from '@/store/types';

function makeEmptySnapshot(): StoreSnapshot {
  return {
    linuxCncStatus: {
      machine: {},
      motion: {},
      io: {},
      program: {},
      overrides: {},
      spindle: [],
      joints: [],
      axes: [],
      tools: {},
    },
    coordinates: {
      x: 0,
      y: 0,
      z: 0,
      a: 0,
      b: 0,
      c: 0,
      u: 0,
      v: 0,
      w: 0,
    },
  };
}

describe('mapStatusMessageToStoreUpdates', () => {
  it('maps task_state number to TaskState enum and keeps other machine fields', () => {
    const snapshot = makeEmptySnapshot();

    const msg: LinuxCncStatusMessage = {
      type: 'linuxcnc_status',
      payload: {
        machine: {
          task_state: 4,
          enabled: true,
        },
      },
    };

    const updates = mapStatusMessageToStoreUpdates(msg, snapshot);

    expect(updates.linuxCncStatusPartial?.machine).toEqual({
      task_state: TaskState.STATE_ON,
      enabled: true,
    });
  });

  it('derives coordinates from motion.actual_position and preserves unspecified axes', () => {
    const snapshot: StoreSnapshot = {
      ...makeEmptySnapshot(),
      coordinates: {
        x: 10,
        y: 20,
        z: 30,
        a: 0,
        b: 0,
        c: 0,
        u: 0,
        v: 0,
        w: 0,
      },
    };

    const msg: LinuxCncStatusMessage = {
      type: 'linuxcnc_status',
      payload: {
        motion: {
          actual_position: [11, undefined as unknown as number, 31],
        },
      },
    };

    const updates = mapStatusMessageToStoreUpdates(msg, snapshot);

    expect(updates.coordinatesUpdate).toEqual({
      x: 11, // updated
      y: 20, // unchanged
      z: 31, // updated
      a: 0,
      b: 0,
      c: 0,
      u: 0,
      v: 0,
      w: 0,
    });
  });

  it('falls back to previous motion when motion is missing in incoming status', () => {
    const snapshot: StoreSnapshot = {
      ...makeEmptySnapshot(),
      linuxCncStatus: {
        ...makeEmptySnapshot().linuxCncStatus,
        motion: {
          actual_position: [1, 2, 3],
        },
      },
    };

    const msg: LinuxCncStatusMessage = {
      type: 'linuxcnc_status',
      payload: {},
    };

    const updates = mapStatusMessageToStoreUpdates(msg, snapshot);

    expect(updates.coordinatesUpdate).toEqual({
      ...snapshot.coordinates,
      x: 1,
      y: 2,
      z: 3,
    });
  });

  it('always sets connectionStatus to connected', () => {
    const updates = mapStatusMessageToStoreUpdates(
      {
        type: 'linuxcnc_status',
        payload: {},
      },
      makeEmptySnapshot(),
    );

    expect(updates.connectionStatus).toBe('connected');
  });

  it('derives display coordinates using active offsets with subtraction', () => {
    const snapshot = makeEmptySnapshot();

    const msg: LinuxCncStatusMessage = {
      type: 'linuxcnc_status',
      payload: {
        coordinate_systems: [
          {
            id: 'G54',
            is_active: true,
            offsets: { x: 9, y: -2, z: 1.5 },
          },
        ],
        motion: {
          actual_position: [10, 3, 5],
        },
      },
    };

    const updates = mapStatusMessageToStoreUpdates(msg, snapshot);

    expect(updates.coordinatesUpdate).toEqual({
      ...snapshot.coordinates,
      x: 1,
      y: 5,
      z: 3.5,
    });
  });

  it('subtracts motion.tool_offset so DRO matches G43 after tool touch-off', () => {
    const snapshot = makeEmptySnapshot();

    const msg: LinuxCncStatusMessage = {
      type: 'linuxcnc_status',
      payload: {
        motion: {
          actual_position: [10, 0, 100],
          g5x_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0],
          g92_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0],
          tool_offset: [0, 0, 9, 0, 0, 0, 0, 0, 0],
        },
      },
    };

    const updates = mapStatusMessageToStoreUpdates(msg, snapshot);

    expect(updates.coordinatesUpdate).toEqual({
      ...snapshot.coordinates,
      x: 10,
      y: 0,
      z: 91,
    });
  });

  it('prefers motion g5x/g92 offsets over coordinate_systems offsets', () => {
    const snapshot = makeEmptySnapshot();

    const msg: LinuxCncStatusMessage = {
      type: 'linuxcnc_status',
      payload: {
        // intentionally conflicting offsets to ensure motion.* wins
        coordinate_systems: [
          {
            id: 'G54',
            is_active: true,
            offsets: { x: 100 },
          },
        ],
        motion: {
          actual_position: [10, 0, 0],
          g5x_offset: [9, 0, 0, 0, 0, 0, 0, 0, 0],
          g92_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
      },
    };

    const updates = mapStatusMessageToStoreUpdates(msg, snapshot);

    expect(updates.coordinatesUpdate).toEqual({
      ...snapshot.coordinates,
      x: 1,
      y: 0,
      z: 0,
    });
  });

  it('merges motion.coordinates.changed into store coordinates', () => {
    const snapshot: StoreSnapshot = {
      ...makeEmptySnapshot(),
      coordinates: {
        x: 10,
        y: 20,
        z: 30,
        a: 1,
        b: 2,
        c: 3,
        u: 4,
        v: 5,
        w: 6,
      },
    };

    const updates = mapCoordinatesChangedEventToStoreUpdates(
      {
        type: 'machine_event',
        event: 'motion.coordinates.changed',
        payload: {
          coordinates: { x: 11.5, z: 33.25 },
        },
      } as MotionCoordinatesChangedEventMessage,
      snapshot,
    );

    expect(updates.coordinatesUpdate).toEqual({
      x: 11.5,
      y: 20, // unchanged
      z: 33.25,
      a: 1,
      b: 2,
      c: 3,
      u: 4,
      v: 5,
      w: 6,
    });
  });

  it('sanitizes non-finite coordinate values from motion.coordinates.changed', () => {
    const snapshot: StoreSnapshot = {
      ...makeEmptySnapshot(),
      coordinates: {
        x: 10,
        y: 20,
        z: 30,
        a: 1,
        b: 2,
        c: 3,
        u: 4,
        v: 5,
        w: 6,
      },
    };

    const updates = mapCoordinatesChangedEventToStoreUpdates(
      {
        type: 'machine_event',
        event: 'motion.coordinates.changed',
        payload: {
          coordinates: {
            x: Number.NaN,
            y: Number.POSITIVE_INFINITY,
            z: 33.25,
          },
        },
      } as MotionCoordinatesChangedEventMessage,
      snapshot,
    );

    expect(updates.coordinatesUpdate).toEqual({
      x: 10, // unchanged (NaN ignored)
      y: 20, // unchanged (Infinity ignored)
      z: 33.25, // updated (finite number)
      a: 1,
      b: 2,
      c: 3,
      u: 4,
      v: 5,
      w: 6,
    });
  });
});

describe('isToolChangeRequestedEventMessage', () => {
  it('returns true for valid tool change event', () => {
    expect(
      isToolChangeRequestedEventMessage({
        type: 'machine_event',
        event: 'machine.tool_change.requested',
        payload: { tool_number: 5, description: 'mill' },
      }),
    ).toBe(true);
  });

  it('returns false when tool_number is not a number', () => {
    expect(
      isToolChangeRequestedEventMessage({
        type: 'machine_event',
        event: 'machine.tool_change.requested',
        payload: { tool_number: '5' },
      }),
    ).toBe(false);
  });
});

