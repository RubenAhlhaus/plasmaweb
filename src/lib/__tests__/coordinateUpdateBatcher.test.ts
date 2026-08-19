import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COORDINATE_UI_FLUSH_MS,
  createCoordinateUpdateBatcher,
} from '@/lib/coordinateUpdateBatcher';
import type { Coordinates } from '@/store/types';

const coords = (x: number): Coordinates => ({
  x,
  y: 0,
  z: 0,
  a: 0,
  b: 0,
  c: 0,
  u: 0,
  v: 0,
  w: 0,
});

describe('createCoordinateUpdateBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits the latest coordinates after the flush interval', () => {
    const commit = vi.fn();
    const batcher = createCoordinateUpdateBatcher(commit);

    batcher.schedule(coords(1));
    batcher.schedule(coords(2));
    expect(commit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(COORDINATE_UI_FLUSH_MS);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(coords(2));

    batcher.dispose();
  });

  it('flushNow commits pending coordinates immediately', () => {
    const commit = vi.fn();
    const batcher = createCoordinateUpdateBatcher(commit);

    batcher.schedule(coords(5));
    batcher.flushNow();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(coords(5));
    batcher.dispose();
  });
});
