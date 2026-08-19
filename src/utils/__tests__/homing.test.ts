import { describe, expect, it } from 'vitest';
import { getUnhomedAxes, isAxisHomed } from '@/utils/homing';
import type { HomingStatusSource } from '@/utils/homing';

function statusWithHomed(homed: number[]): HomingStatusSource {
  return {
    motion: { homed },
    joints: [],
  };
}

describe('homing utils', () => {
  it('isAxisHomed reads motion.homed flags', () => {
    const status = statusWithHomed([1, 0, 1]);
    expect(isAxisHomed(status, 'x')).toBe(true);
    expect(isAxisHomed(status, 'y')).toBe(false);
    expect(isAxisHomed(status, 'z')).toBe(true);
  });

  it('getUnhomedAxes returns only axes that are not homed', () => {
    const status = statusWithHomed([1, 0, 0]);
    expect(getUnhomedAxes(status)).toEqual(['y', 'z']);
  });

  it('getUnhomedAxes returns all jog axes when homed data is missing', () => {
    expect(getUnhomedAxes(undefined)).toEqual(['x', 'y', 'z']);
  });

  it('isAxisHomed falls back to joints when motion.homed is missing', () => {
    const status: HomingStatusSource = {
      motion: {},
      joints: [{ homed: 1 }, { homed: 0 }, { homed: 1 }],
    };
    expect(isAxisHomed(status, 'x')).toBe(true);
    expect(isAxisHomed(status, 'y')).toBe(false);
    expect(isAxisHomed(status, 'z')).toBe(true);
  });
});

describe('isAxisHomed with gantry joint coordinates', () => {
  // trivkins coordinates=xyyz: joint 0 = X, joints 1+2 = Y, joint 3 = Z.
  const XYYZ = ['x', 'y', 'y', 'z'];

  it('reads Z from joint 3, not joint 2', () => {
    const status = { motion: { homed: [1, 1, 1, 0] }, joints: [] };

    expect(isAxisHomed(status, 'z', XYYZ)).toBe(false);
    // Without the map the same status looks homed — this is the bug being fixed.
    expect(isAxisHomed(status, 'z')).toBe(true);
  });

  it('treats a duplicated axis as homed only when every joint of it is homed', () => {
    expect(isAxisHomed({ motion: { homed: [1, 1, 0, 1] }, joints: [] }, 'y', XYYZ)).toBe(false);
    expect(isAxisHomed({ motion: { homed: [1, 1, 1, 1] }, joints: [] }, 'y', XYYZ)).toBe(true);
  });

  it('falls back to the per-joint list when motion.homed is absent', () => {
    const status = {
      motion: {},
      joints: [{ homed: 1 }, { homed: 1 }, { homed: 1 }, { homed: 0 }],
    };

    expect(isAxisHomed(status, 'z', XYYZ)).toBe(false);
    expect(isAxisHomed(status, 'x', XYYZ)).toBe(true);
  });

  it('reports an axis the machine does not have as not homed', () => {
    expect(isAxisHomed({ motion: { homed: [1, 1] }, joints: [] }, 'z', ['x', 'y'])).toBe(false);
  });

  it('keeps plain XYZ behaviour when no coordinates are given', () => {
    const status = { motion: { homed: [1, 0, 1] }, joints: [] };

    expect(isAxisHomed(status, 'x')).toBe(true);
    expect(isAxisHomed(status, 'y')).toBe(false);
    expect(isAxisHomed(status, 'z')).toBe(true);
  });
});

describe('getUnhomedAxes with gantry joint coordinates', () => {
  it('lists axes by their own joints', () => {
    const status = { motion: { homed: [1, 1, 1, 0] }, joints: [] };

    expect(getUnhomedAxes(status, ['x', 'y', 'y', 'z'])).toEqual(['z']);
  });

  it('lists only axes the machine has', () => {
    const status = { motion: { homed: [0, 1] }, joints: [] };

    expect(getUnhomedAxes(status, ['x', 'z'])).toEqual(['x']);
  });
});
