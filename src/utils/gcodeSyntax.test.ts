import { describe, expect, it } from 'vitest';
import { tokenizeGcode, tokenizeGcodeLine, type GcodeSegment } from './gcodeSyntax';

function sig(segments: GcodeSegment[]): string[] {
  return segments.map((s) =>
    s.part !== undefined ? `${s.kind}:${s.part}` : s.kind,
  );
}

function joined(segments: GcodeSegment[]): string {
  return segments.map((s) => s.text).join('');
}

describe('tokenizeGcodeLine', () => {
  it('empty line', () => {
    expect(tokenizeGcodeLine('')).toEqual([]);
  });

  it('G01 X1.0 M6 F100 — G/M whole, axis/F split', () => {
    const s = tokenizeGcodeLine('G01 X1.0 M6 F100');
    expect(joined(s)).toBe('G01 X1.0 M6 F100');
    expect(sig(s)).toEqual([
      'motion',
      'plain',
      'axis:letter',
      'axis:value',
      'plain',
      'misc',
      'plain',
      'feed:letter',
      'feed:value',
    ]);
  });

  it('G and axis with whitespace between', () => {
    const s = tokenizeGcodeLine('G 0 X 0');
    expect(joined(s)).toBe('G 0 X 0');
    expect(sig(s)).toEqual([
      'motion',
      'plain',
      'axis:letter',
      'plain',
      'axis:value',
    ]);
  });

  it('case insensitivity', () => {
    const s = tokenizeGcodeLine('g1 m3 f50');
    expect(sig(s)).toEqual([
      'motion',
      'plain',
      'misc',
      'plain',
      'feed:letter',
      'feed:value',
    ]);
  });

  it('semicolon comment', () => {
    const s = tokenizeGcodeLine('G0 ; rest');
    expect(sig(s)).toEqual(['motion', 'plain', 'comment']);
    expect(s[s.length - 1]?.text).toBe('; rest');
  });

  it('paren comment', () => {
    const s = tokenizeGcodeLine('(note)G1');
    expect(sig(s)).toEqual(['comment', 'motion']);
    expect(s[0]?.text).toBe('(note)');
  });

  it('unclosed paren comment', () => {
    const s = tokenizeGcodeLine('(no end');
    expect(s).toHaveLength(1);
    expect(s[0]?.kind).toBe('comment');
    expect(s[0]?.text).toBe('(no end');
  });

  it('parameter # — hash and digits split', () => {
    const s = tokenizeGcodeLine('#100 #');
    expect(sig(s)).toEqual(['hash:letter', 'hash:value', 'plain', 'plain']);
    expect(s[0]?.text).toBe('#');
    expect(s[1]?.text).toBe('100');
    expect(s[2]?.text).toBe(' ');
  });
});

describe('tokenizeGcode', () => {
  it('multiple lines', () => {
    const s = tokenizeGcode('G0\nM2');
    expect(joined(s)).toBe('G0\nM2');
    expect(sig(s)).toEqual(['motion', 'plain', 'misc']);
  });
});
