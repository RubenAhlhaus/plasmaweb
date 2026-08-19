import { describe, expect, it } from 'vitest';
import {
  boolParam,
  migrateLegacyStartZToSafeZ,
  numParam,
  numSafeZParam,
  strParam,
} from '@/lib/macroParams';
import type { MacroParams } from '@/types/macros';

describe('strParam', () => {
  it('returns empty string for undefined / null / missing keys', () => {
    expect(strParam({}, 'missing')).toBe('');
    expect(strParam({ a: null as unknown as string }, 'a')).toBe('');
    expect(strParam({ a: undefined as unknown as string }, 'a')).toBe('');
  });

  it('stringifies present values', () => {
    expect(strParam({ a: 'hi' }, 'a')).toBe('hi');
    expect(strParam({ a: 0 }, 'a')).toBe('0');
    expect(strParam({ a: 12.5 }, 'a')).toBe('12.5');
    expect(strParam({ a: true }, 'a')).toBe('true');
    expect(strParam({ a: false }, 'a')).toBe('false');
    expect(strParam({ a: '' }, 'a')).toBe('');
  });
});

describe('boolParam', () => {
  it('returns true only for boolean true or the string "true"', () => {
    expect(boolParam({ a: true }, 'a')).toBe(true);
    expect(boolParam({ a: 'true' }, 'a')).toBe(true);
  });

  it('returns false for false, "false", and everything else', () => {
    expect(boolParam({ a: false }, 'a')).toBe(false);
    expect(boolParam({ a: 'false' }, 'a')).toBe(false);
    expect(boolParam({}, 'a')).toBe(false);
    expect(boolParam({ a: null as unknown as boolean }, 'a')).toBe(false);
    expect(boolParam({ a: 1 as unknown as boolean }, 'a')).toBe(false);
    expect(boolParam({ a: 0 as unknown as boolean }, 'a')).toBe(false);
    // case-sensitive: only lowercase "true" counts
    expect(boolParam({ a: 'TRUE' as unknown as boolean }, 'a')).toBe(false);
    expect(boolParam({ a: 'True' as unknown as boolean }, 'a')).toBe(false);
  });
});

describe('numParam', () => {
  it('returns finite numbers as-is', () => {
    expect(numParam({ a: 3 }, 'a')).toBe(3);
    expect(numParam({ a: -2.5 }, 'a')).toBe(-2.5);
    expect(numParam({ a: 0 }, 'a')).toBe(0);
  });

  it('parses numeric strings and expressions', () => {
    expect(numParam({ a: '5' }, 'a')).toBe(5);
    expect(numParam({ a: ' 2 + 3 ' }, 'a')).toBe(5);
  });

  it('returns null for empty, missing, and non-numeric values', () => {
    expect(numParam({}, 'a')).toBeNull();
    expect(numParam({ a: '' }, 'a')).toBeNull();
    expect(numParam({ a: '   ' }, 'a')).toBeNull();
    expect(numParam({ a: null as unknown as number }, 'a')).toBeNull();
    expect(numParam({ a: undefined as unknown as number }, 'a')).toBeNull();
    expect(numParam({ a: 'abc' }, 'a')).toBeNull();
  });

  it('returns null for non-finite numbers', () => {
    expect(numParam({ a: Number.NaN }, 'a')).toBeNull();
    expect(numParam({ a: Number.POSITIVE_INFINITY }, 'a')).toBeNull();
  });
});

describe('safeZ helpers', () => {
  it('numSafeZParam prefers safeZ over legacy startZ', () => {
    expect(numSafeZParam({ safeZ: '8', startZ: '3' })).toBe(8);
    expect(numSafeZParam({ startZ: '3' })).toBe(3);
    expect(numSafeZParam({})).toBeNull();
  });

  it('migrateLegacyStartZToSafeZ moves startZ when safeZ is empty', () => {
    const params: MacroParams = { startZ: '12', depth: '5' };
    migrateLegacyStartZToSafeZ(params);
    expect(params.safeZ).toBe('12');
    expect(params.startZ).toBeUndefined();
  });

  it('migrateLegacyStartZToSafeZ keeps safeZ and drops startZ', () => {
    const params: MacroParams = { safeZ: '9', startZ: '1' };
    migrateLegacyStartZToSafeZ(params);
    expect(params.safeZ).toBe('9');
    expect(params.startZ).toBeUndefined();
  });
});

// Type sanity: helpers accept a MacroParams object.
const sample: MacroParams = { coolantOn: 'true', x: '1+1', label: 'demo' };
describe('integration on MacroParams', () => {
  it('reads mixed fields', () => {
    expect(boolParam(sample, 'coolantOn')).toBe(true);
    expect(numParam(sample, 'x')).toBe(2);
    expect(strParam(sample, 'label')).toBe('demo');
  });
});
