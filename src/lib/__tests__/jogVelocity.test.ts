import { describe, expect, it } from 'vitest';

import {
  clampJogVelocityMmPerMin,
  DEFAULT_JOG_VELOCITY_MM_MIN,
  MAX_JOG_VELOCITY_MM_MIN,
  MIN_JOG_VELOCITY_MM_MIN,
} from '../jogVelocity';

describe('jogVelocity', () => {
  it('defaults to 100 mm/min', () => {
    expect(DEFAULT_JOG_VELOCITY_MM_MIN).toBe(100);
  });

  it('clamps and snaps to 1 mm/min steps', () => {
    expect(clampJogVelocityMmPerMin(0)).toBe(MIN_JOG_VELOCITY_MM_MIN);
    expect(clampJogVelocityMmPerMin(5000)).toBe(MAX_JOG_VELOCITY_MM_MIN);
    expect(MAX_JOG_VELOCITY_MM_MIN).toBe(1000);
    expect(clampJogVelocityMmPerMin(99.4)).toBe(99);
    expect(clampJogVelocityMmPerMin(99.6)).toBe(100);
  });
});
