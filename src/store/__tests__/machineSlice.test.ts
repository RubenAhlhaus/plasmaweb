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

describe('machineSlice.setIniRuntimeConfig jog speed', () => {
  const noJogLimits = {
    default_linear_velocity: null,
    min_linear_velocity: null,
    max_linear_velocity: null,
  };

  beforeEach(() => {
    useAppStore.getState().setIniRuntimeConfig(noJogLimits);
    useAppStore.setState({ jogVelocityMmPerMin: 100 });
  });

  it('moves a jog speed still on the old default to the INI default', () => {
    useAppStore.getState().setIniRuntimeConfig({
      default_linear_velocity: 50,
      max_linear_velocity: 150,
    });
    expect(useAppStore.getState().jogVelocityMmPerMin).toBe(3000);
  });

  it('keeps an operator-chosen speed, clamped to the INI range', () => {
    useAppStore.setState({ jogVelocityMmPerMin: 700 });
    useAppStore.getState().setIniRuntimeConfig({ default_linear_velocity: 5, max_linear_velocity: 10 });
    expect(useAppStore.getState().jogVelocityMmPerMin).toBe(600);
  });

  it('lets the jog speed setter go up to the INI ceiling', () => {
    useAppStore.getState().setIniRuntimeConfig({ max_linear_velocity: 150 });
    useAppStore.getState().setJogVelocityMmPerMin(8000);
    expect(useAppStore.getState().jogVelocityMmPerMin).toBe(8000);
    useAppStore.getState().setJogVelocityMmPerMin(20000);
    expect(useAppStore.getState().jogVelocityMmPerMin).toBe(9000);
  });
});
