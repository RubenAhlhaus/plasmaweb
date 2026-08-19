import { describe, expect, it } from 'vitest';
import { gmLookupKeyFromTokenText } from './gmCodeLookupFromText';

describe('gmLookupKeyFromTokenText', () => {
  it('normalizes G words for JSON keys', () => {
    expect(gmLookupKeyFromTokenText('G01')).toEqual({ kind: 'g', label: 'G1' });
    expect(gmLookupKeyFromTokenText('g 1')).toEqual({ kind: 'g', label: 'G1' });
    expect(gmLookupKeyFromTokenText('G0')).toEqual({ kind: 'g', label: 'G0' });
    expect(gmLookupKeyFromTokenText('g0')).toEqual({ kind: 'g', label: 'G0' });
  });

  it('normalizes fractional G codes', () => {
    expect(gmLookupKeyFromTokenText('G54.1')).toEqual({ kind: 'g', label: 'G54.1' });
    expect(gmLookupKeyFromTokenText('G54.10')).toEqual({ kind: 'g', label: 'G54.1' });
  });

  it('handles M codes', () => {
    expect(gmLookupKeyFromTokenText('M03')).toEqual({ kind: 'm', label: 'M3' });
    expect(gmLookupKeyFromTokenText('m 6')).toEqual({ kind: 'm', label: 'M6' });
  });

  it('returns null when text is not a G/M word', () => {
    expect(gmLookupKeyFromTokenText('F100')).toBeNull();
  });
});
