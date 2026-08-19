import { describe, expect, it } from 'vitest';
import {
  COORDINATE_DISPLAY_DECIMALS,
  formatMachineCoordinate,
} from '@/lib/formatCoordinates';

describe('COORDINATE_DISPLAY_DECIMALS', () => {
  it('is 3', () => {
    expect(COORDINATE_DISPLAY_DECIMALS).toBe(3);
  });
});

describe('formatMachineCoordinate', () => {
  it('formats zero as "0.000" (matches the legacy default fallback)', () => {
    expect(formatMachineCoordinate(0)).toBe('0.000');
  });

  it('pads to three decimals', () => {
    expect(formatMachineCoordinate(1)).toBe('1.000');
    expect(formatMachineCoordinate(1.5)).toBe('1.500');
    expect(formatMachineCoordinate(-2.25)).toBe('-2.250');
  });

  it('rounds to three decimals like toFixed(3)', () => {
    expect(formatMachineCoordinate(1.23456)).toBe('1.235');
    expect(formatMachineCoordinate(0.0005)).toBe(((0.0005).toFixed(3)));
  });

  it('stays equivalent to the inline value.toFixed(3) it replaces', () => {
    for (const v of [0, 1, -1, 12.3456, -987.6543, 0.001, 100000.5]) {
      expect(formatMachineCoordinate(v)).toBe(v.toFixed(3));
    }
  });
});
