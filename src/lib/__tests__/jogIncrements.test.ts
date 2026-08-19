import { describe, expect, it } from 'vitest';
import {
  MAX_JOG_INCREMENT_BUTTONS,
  parseJogIncrementLabelToMm,
  parseJogIncrementsSpec,
} from '../jogIncrements';

describe('parseJogIncrementsSpec', () => {
  it('parses comma-separated INI spec', () => {
    const parsed = parseJogIncrementsSpec('3 mm, 2 mm, 1/8 in');
    expect(parsed.map((p) => p.label)).toEqual(['3 mm', '2 mm', '1/8 in']);
    expect(parsed.map((p) => p.valueMu)).toEqual([3, 2, 25.4 / 8]);
  });

  it('parses gmoccapy space-separated INI spec', () => {
    const parsed = parseJogIncrementsSpec('10mm 5mm 1mm .1mm .01mm .005mm');
    expect(parsed.map((p) => p.label)).toEqual(['10mm', '5mm', '1mm', '.1mm']);
    expect(parsed.map((p) => p.valueMu)).toEqual([10, 5, 1, 0.1]);
  });

  it('parses space-separated value and unit pairs without commas', () => {
    const parsed = parseJogIncrementsSpec('1 mm 0.5 mm 0.1 mm');
    expect(parsed.map((p) => p.label)).toEqual(['1 mm', '0.5 mm', '0.1 mm']);
    expect(parsed.map((p) => p.valueMu)).toEqual([1, 0.5, 0.1]);
  });

  it(`limits visible increments to ${MAX_JOG_INCREMENT_BUTTONS}`, () => {
    expect(parseJogIncrementsSpec('10mm 5mm 1mm .1mm .01mm .005mm')).toHaveLength(
      MAX_JOG_INCREMENT_BUTTONS,
    );
  });

  it('returns empty array for unparseable spec', () => {
    expect(parseJogIncrementsSpec('not valid increments')).toEqual([]);
  });
});

describe('parseJogIncrementLabelToMm', () => {
  it('parses comma-separated style with space before unit', () => {
    expect(parseJogIncrementLabelToMm('3 mm')).toBe(3);
    expect(parseJogIncrementLabelToMm('0.5 mm')).toBe(0.5);
    expect(parseJogIncrementLabelToMm('1/8 in')).toBeCloseTo(25.4 / 8);
  });

  it('parses gmoccapy style with glued unit suffix', () => {
    expect(parseJogIncrementLabelToMm('10mm')).toBe(10);
    expect(parseJogIncrementLabelToMm('5mm')).toBe(5);
    expect(parseJogIncrementLabelToMm('.1mm')).toBe(0.1);
    expect(parseJogIncrementLabelToMm('.01mm')).toBe(0.01);
    expect(parseJogIncrementLabelToMm('.005mm')).toBe(0.005);
  });

  it('throws for invalid labels', () => {
    expect(() => parseJogIncrementLabelToMm('')).toThrow(/invalid label/);
    expect(() => parseJogIncrementLabelToMm('not-a-step')).toThrow(/invalid label/);
  });
});
