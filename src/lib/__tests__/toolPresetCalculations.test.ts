import { describe, expect, it } from 'vitest';
import {
  feedFromFeedPerTooth,
  feedPerToothFromFeed,
  plungeFeedPerRevFromPlunge,
  plungeFromPlungeFeedPerRev,
  presetGeometryWarnings,
  rpmFromSurfaceSpeed,
  surfaceSpeedFromRpm,
} from '@/lib/toolPresetCalculations';

describe('toolPresetCalculations', () => {
  it('surfaceSpeedFromRpm and rpmFromSurfaceSpeed are inverse for D=6, n=5000', () => {
    const D = 6;
    const n = 5000;
    const vc = surfaceSpeedFromRpm(D, n);
    expect(vc).toBeCloseTo((Math.PI * 6 * 5000) / 1000, 5);
    expect(rpmFromSurfaceSpeed(D, vc)).toBeCloseTo(n, 5);
  });

  it('feed roundtrip with z=4', () => {
    const vf = 1000;
    const n = 5000;
    const z = 4;
    const fz = feedPerToothFromFeed(vf, n, z);
    expect(fz).toBeCloseTo(0.05, 5);
    expect(feedFromFeedPerTooth(fz, n, z)).toBeCloseTo(vf, 5);
  });

  it('returns undefined when geometry invalid', () => {
    expect(surfaceSpeedFromRpm(0, 1000)).toBeUndefined();
    expect(feedPerToothFromFeed(100, 1000, 0)).toBeUndefined();
  });

  it('plunge per rev roundtrip', () => {
    const n = 5000;
    const v = 333.33;
    const perRev = plungeFeedPerRevFromPlunge(v, n);
    expect(perRev).toBeCloseTo(v / n, 5);
    expect(plungeFromPlungeFeedPerRev(perRev, n)).toBeCloseTo(v, 3);
  });

  it('presetGeometryWarnings', () => {
    expect(presetGeometryWarnings({})).toHaveLength(2);
    expect(presetGeometryWarnings({ diameterMm: 6, numberOfFlutes: 4 })).toHaveLength(0);
  });
});
