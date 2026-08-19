import { describe, expect, it, beforeEach } from 'vitest';
import { useAppStore } from '@/store';
import type { Coordinates } from '@/store/types';

const initialCoords: Coordinates = {
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

describe('machineSlice.setCoordinates', () => {
  beforeEach(() => {
    useAppStore.getState().setCoordinates(initialCoords);
  });

  it('skips store update when coordinates are within display precision', () => {
    const before = useAppStore.getState().coordinates;
    useAppStore.getState().setCoordinates({ ...before, x: before.x + 0.0004 });
    expect(useAppStore.getState().coordinates).toBe(before);
  });

  it('updates store when a coordinate changes beyond display precision', () => {
    useAppStore.getState().setCoordinates({ ...initialCoords, x: 1.001 });
    expect(useAppStore.getState().coordinates.x).toBe(1.001);
  });
});
