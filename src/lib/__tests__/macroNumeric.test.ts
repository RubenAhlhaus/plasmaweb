import { describe, expect, it } from 'vitest';
import { parseMacroNumberStrict, parseMacroNumberWithDefault } from '@/lib/macroNumeric';

describe('macroNumeric', () => {
  it('parses strict numeric expressions and finite numbers', () => {
    expect(parseMacroNumberStrict(12)).toBe(12);
    expect(parseMacroNumberStrict('2 + 3 * 4')).toBe(14);
    expect(parseMacroNumberStrict('')).toBeNull();
    expect(parseMacroNumberStrict('abc')).toBeNull();
  });

  it('returns fallback for invalid values', () => {
    expect(parseMacroNumberWithDefault('10/2', 7)).toBe(5);
    expect(parseMacroNumberWithDefault('bad', 7)).toBe(7);
    expect(parseMacroNumberWithDefault(undefined, 7)).toBe(7);
  });
});
