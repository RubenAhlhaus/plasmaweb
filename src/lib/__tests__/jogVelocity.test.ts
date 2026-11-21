import { describe, expect, it } from 'vitest';

import {
  clampJogVelocityMmPerMin,
  DEFAULT_JOG_VELOCITY_MM_MIN,
  FALLBACK_JOG_VELOCITY_LIMITS,
  jogVelocityLimitsFromIni,
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

describe('jogVelocityLimitsFromIni', () => {
  it('converts the INI [DISPLAY] velocities from units/s to units/min', () => {
    expect(
      jogVelocityLimitsFromIni({
        default_linear_velocity: 50,
        min_linear_velocity: 0.5,
        max_linear_velocity: 150,
      }),
    ).toEqual({ min: 30, max: 9000, default: 3000 });
  });

  it('falls back to the built-in range for keys the INI leaves out', () => {
    expect(jogVelocityLimitsFromIni({})).toEqual(FALLBACK_JOG_VELOCITY_LIMITS);
    expect(jogVelocityLimitsFromIni(null)).toEqual(FALLBACK_JOG_VELOCITY_LIMITS);
  });

  it('keeps the default inside the range', () => {
    expect(
      jogVelocityLimitsFromIni({ default_linear_velocity: 500, max_linear_velocity: 10 }).default,
    ).toBe(600);
  });

  it('clamps to the given limits', () => {
    const limits = jogVelocityLimitsFromIni({ max_linear_velocity: 150 });
    expect(clampJogVelocityMmPerMin(5000, limits)).toBe(5000);
    expect(clampJogVelocityMmPerMin(20000, limits)).toBe(9000);
  });
});
