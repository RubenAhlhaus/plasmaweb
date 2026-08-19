import { describe, expect, it } from 'vitest';
import {
  defaultSafeZAboveSurface,
  PATTERN_DEFAULT_SAFE_CLEARANCE_MM,
  patternHeightDefaultsFromParams,
  readOptionalPatternSafeZ,
} from '@/lib/macroGcode/patternHeightDefaults';

describe('patternHeightDefaults', () => {
  it('defaultSafeZAboveSurface adds the shared clearance', () => {
    expect(defaultSafeZAboveSurface(-2)).toBe(-2 + PATTERN_DEFAULT_SAFE_CLEARANCE_MM);
  });

  it('readOptionalPatternSafeZ returns null when absent or invalid', () => {
    expect(readOptionalPatternSafeZ({})).toBeNull();
    expect(readOptionalPatternSafeZ({ safeZ: '' })).toBeNull();
    expect(readOptionalPatternSafeZ({ safeZ: 'nope' })).toBeNull();
  });

  it('readOptionalPatternSafeZ parses explicit legacy safeZ', () => {
    expect(readOptionalPatternSafeZ({ safeZ: 12 })).toBe(12);
    expect(readOptionalPatternSafeZ({ safeZ: '7.5' })).toBe(7.5);
  });

  it('patternHeightDefaultsFromParams uses surfaceZ plus clearance when safeZ is absent', () => {
    expect(patternHeightDefaultsFromParams({ surfaceZ: -2 })).toEqual({
      surfaceZ: -2,
      safeZ: defaultSafeZAboveSurface(-2),
    });
  });

  it('patternHeightDefaultsFromParams prefers explicit legacy safeZ', () => {
    expect(patternHeightDefaultsFromParams({ surfaceZ: 0, safeZ: 12 })).toEqual({
      surfaceZ: 0,
      safeZ: 12,
    });
  });

  it('patternHeightDefaultsFromParams falls back to surfaceZ 0 when unset', () => {
    expect(patternHeightDefaultsFromParams({})).toEqual({
      surfaceZ: 0,
      safeZ: PATTERN_DEFAULT_SAFE_CLEARANCE_MM,
    });
  });
});
