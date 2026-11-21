import { describe, expect, it } from 'vitest';

import {
  clampOverridePercent,
  feedOverridePercentRange,
  spindleOverridePercentRange,
} from '../overrideLimits';

describe('overrideLimits', () => {
  it('takes the feed override ceiling from MAX_FEED_OVERRIDE', () => {
    expect(feedOverridePercentRange({ max_feed_override: 4 })).toEqual({ min: 1, max: 400 });
    expect(feedOverridePercentRange({})).toEqual({ min: 1, max: 200 });
  });

  it('takes the spindle override range from MIN/MAX_SPINDLE_OVERRIDE', () => {
    expect(
      spindleOverridePercentRange({ min_spindle_override: 0.5, max_spindle_override: 1 }),
    ).toEqual({ min: 50, max: 100 });
    expect(spindleOverridePercentRange({ min_spindle_override: 0 })).toEqual({ min: 1, max: 200 });
  });

  it('clamps into the range', () => {
    expect(clampOverridePercent(350, { min: 1, max: 200 })).toBe(200);
    expect(clampOverridePercent(10, { min: 50, max: 100 })).toBe(50);
  });
});
