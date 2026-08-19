import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { createLatestWinsScheduler } from '../latestWinsScheduler';

describe('createLatestWinsScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes the latest value after the delay', () => {
    const flush = vi.fn();
    const scheduler = createLatestWinsScheduler<number>(50, flush);

    scheduler.schedule(1);
    scheduler.schedule(2);
    scheduler.schedule(3);
    expect(flush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(49);
    expect(flush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(3);

    scheduler.dispose();
  });

  it('dispose cancels a pending flush', () => {
    const flush = vi.fn();
    const scheduler = createLatestWinsScheduler<number>(50, flush);
    scheduler.schedule(9);
    scheduler.dispose();
    vi.advanceTimersByTime(100);
    expect(flush).not.toHaveBeenCalled();
  });
});
