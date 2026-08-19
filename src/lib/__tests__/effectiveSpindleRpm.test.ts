import { describe, expect, it } from 'vitest';
import { effectiveSpindleRpm } from '@/lib/effectiveSpindleRpm';

describe('effectiveSpindleRpm', () => {
  it('multiplies programmed S by override', () => {
    expect(effectiveSpindleRpm(100, 0.8)).toBe(80);
    expect(effectiveSpindleRpm(100, 0.5)).toBe(50);
    expect(effectiveSpindleRpm(1000, 1.25)).toBe(1250);
  });

  it('defaults override to 1', () => {
    expect(effectiveSpindleRpm(500, undefined)).toBe(500);
    expect(effectiveSpindleRpm(500, null)).toBe(500);
  });

  it('ignores override factor when override_enabled is false', () => {
    expect(effectiveSpindleRpm(100, 0.5, undefined, false)).toBe(100);
    expect(effectiveSpindleRpm(100, 1.5, undefined, false)).toBe(100);
  });

  it('still multiplies when override_enabled is true or unset', () => {
    expect(effectiveSpindleRpm(100, 0.5, undefined, true)).toBe(50);
    expect(effectiveSpindleRpm(100, 0.5, undefined, undefined)).toBe(50);
  });

  it('falls back to |spindle.speed| without re-applying override', () => {
    expect(effectiveSpindleRpm(0, 0.5, 200)).toBe(200);
    expect(effectiveSpindleRpm(undefined, 0.8, 100)).toBe(100);
  });

  it('uses absolute values for signed spindle.speed fallback', () => {
    expect(effectiveSpindleRpm(0, 0.5, -200)).toBe(200);
  });
});
