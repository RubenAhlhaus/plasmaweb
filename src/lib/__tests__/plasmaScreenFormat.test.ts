import { describe, expect, it } from 'vitest';

import {
  formatForViewport,
  UPSTREAM_FORMATS,
  type PlasmaScreenFormat,
} from '@/lib/plasmaScreenFormat';

describe('plasma screen format', () => {
  it('recognises each of the three screens QtPlasmaC ships', () => {
    for (const [name, size] of Object.entries(UPSTREAM_FORMATS)) {
      expect(formatForViewport(size.width, size.height)).toBe(name as PlasmaScreenFormat);
    }
  });

  it('decides on shape, not on pixel count', () => {
    // A 4:3 panel at 1600x1200 is wide by pixels and 4:3 by shape; the shape decides whether
    // a right-hand column fits beside the readouts.
    expect(formatForViewport(1600, 1200)).toBe('standard');
    // A small 16:9 screen is still 16:9.
    expect(formatForViewport(1024, 576)).toBe('wide');
  });

  it('anything taller than it is wide is the tall screen', () => {
    expect(formatForViewport(800, 1000)).toBe('tall');
    expect(formatForViewport(1080, 1920)).toBe('tall');
  });

  it('the kiosk size this UI runs at is the wide screen', () => {
    expect(formatForViewport(1280, 800)).toBe('wide');
  });

  it('a zero height does not divide by nothing', () => {
    expect(formatForViewport(1280, 0)).toBe('wide');
  });
});
