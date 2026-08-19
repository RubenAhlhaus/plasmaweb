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
