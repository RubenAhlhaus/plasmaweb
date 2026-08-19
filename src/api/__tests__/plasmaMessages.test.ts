import { describe, expect, it } from 'vitest';

import {
  isPlasmaPinsChangedEventMessage,
  isPlasmaPinsSnapshotEventMessage,
  isPlasmaStateChangedEventMessage,
  mapPlasmaPinsDiff,
  type BackendMessage,
} from '@/api/statusMapping';

const snapshot: BackendMessage = {
  type: 'machine_event',
  event: 'plasma.pins.snapshot',
  payload: { pins: { plasmac: { 'torch-on': false }, qtplasmac: {} }, missingPins: [] },
};

const diff: BackendMessage = {
  type: 'machine_event',
  event: 'plasma.pins.changed',
  payload: { pins: { plasmac: { 'torch-on': true } } },
};

const stateChanged: BackendMessage = {
  type: 'machine_event',
  event: 'plasma.state.changed',
  payload: {
    state: 6,
    stateName: 'TORCH_ON',
    stateDescription: 'turn the torch on',
    stopType: 0,
    stopTypeName: 'NONE',
    isCutting: true,
  },
};

describe('plasma message predicates', () => {
  it('recognises each plasma event and nothing else', () => {
    expect(isPlasmaPinsSnapshotEventMessage(snapshot)).toBe(true);
    expect(isPlasmaPinsSnapshotEventMessage(diff)).toBe(false);

    expect(isPlasmaPinsChangedEventMessage(diff)).toBe(true);
    expect(isPlasmaPinsChangedEventMessage(stateChanged)).toBe(false);

    expect(isPlasmaStateChangedEventMessage(stateChanged)).toBe(true);
    expect(isPlasmaStateChangedEventMessage(snapshot)).toBe(false);
  });

  it('ignores unrelated machine events', () => {
    const other: BackendMessage = {
      type: 'machine_event',
      event: 'motion.coordinates.changed',
      payload: { coordinates: { x: 1 } },
    };
    expect(isPlasmaPinsSnapshotEventMessage(other)).toBe(false);
    expect(isPlasmaPinsChangedEventMessage(other)).toBe(false);
    expect(isPlasmaStateChangedEventMessage(other)).toBe(false);
  });
});

describe('mapPlasmaPinsDiff', () => {
  it('keeps the known components', () => {
    expect(
      mapPlasmaPinsDiff({ pins: { plasmac: { 'torch-on': true }, qtplasmac: { 'ext-pause': true } } }),
    ).toEqual({ plasmac: { 'torch-on': true }, qtplasmac: { 'ext-pause': true } });
  });

  it('drops unknown components instead of creating a third pin bucket', () => {
    const payload = { pins: { plasmac: { 'torch-on': true }, nonsense: { foo: 1 } } } as never;
    expect(mapPlasmaPinsDiff(payload)).toEqual({ plasmac: { 'torch-on': true } });
  });

  it('survives an empty or missing payload', () => {
    expect(mapPlasmaPinsDiff({})).toEqual({});
    expect(mapPlasmaPinsDiff({ pins: {} })).toEqual({});
  });
});
