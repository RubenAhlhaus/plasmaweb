import { describe, expect, it } from 'vitest';
import { findGmTokenAtTextIndex } from './gmTokenAtTextIndex';

describe('findGmTokenAtTextIndex', () => {
  it('detects cursor inside a G word', () => {
    const line = 'G1 X0 Y0';
    expect(findGmTokenAtTextIndex(line, 0)).toEqual({ kind: 'g', label: 'G1' });
    expect(findGmTokenAtTextIndex(line, 1)).toEqual({ kind: 'g', label: 'G1' });
  });

  it('detects lower-case G/M words', () => {
    expect(findGmTokenAtTextIndex('g0 x1', 0)).toEqual({ kind: 'g', label: 'G0' });
    expect(findGmTokenAtTextIndex('g0 x1', 1)).toEqual({ kind: 'g', label: 'G0' });
    expect(findGmTokenAtTextIndex('m3', 0)).toEqual({ kind: 'm', label: 'M3' });
  });

  it('returns null outside G/M tokens', () => {
    const line = 'G1 X0';
    expect(findGmTokenAtTextIndex(line, 4)).toBeNull();
  });

  it('handles multiline text by line', () => {
    const text = 'M3\nG0 X1';
    expect(findGmTokenAtTextIndex(text, 0)).toEqual({ kind: 'm', label: 'M3' });
    const g0Index = text.indexOf('G');
    expect(findGmTokenAtTextIndex(text, g0Index)).toEqual({ kind: 'g', label: 'G0' });
  });
});
