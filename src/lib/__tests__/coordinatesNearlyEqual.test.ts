import { describe, expect, it } from 'vitest';
import { coordinatesNearlyEqual } from '@/lib/coordinatesNearlyEqual';
import type { Coordinates } from '@/store/types';

const base: Coordinates = {
  x: 1,
  y: 2,
  z: 3,
  a: 0,
  b: 0,
  c: 0,
  u: 0,
  v: 0,
  w: 0,
};

describe('coordinatesNearlyEqual', () => {
  it('treats identical coordinates as equal', () => {
    expect(coordinatesNearlyEqual(base, { ...base })).toBe(true);
  });

  it('treats sub-display-step differences as equal', () => {
    expect(coordinatesNearlyEqual(base, { ...base, x: 1.0004 })).toBe(true);
  });

  it('treats display-step differences as not equal', () => {
    expect(coordinatesNearlyEqual(base, { ...base, x: 1.001 })).toBe(false);
  });
});
