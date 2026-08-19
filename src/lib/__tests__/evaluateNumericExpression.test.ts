import { describe, expect, it } from 'vitest';
import {
  evaluateNumericExpression,
  parsePositiveIntFromNumericExpression,
  parseTouchNumericForCommit,
  parseUnsignedIntFromNumericExpression,
} from '@/lib/evaluateNumericExpression';

describe('evaluateNumericExpression', () => {
  it('evaluates simple subtraction', () => {
    expect(evaluateNumericExpression('5-3')).toBe(2);
  });

  it('respects multiplication before addition', () => {
    expect(evaluateNumericExpression('10+0.5*2')).toBe(11);
  });

  it('accepts comma as decimal separator', () => {
    expect(evaluateNumericExpression('1,5+1,5')).toBe(3);
  });

  it('handles parentheses', () => {
    expect(evaluateNumericExpression('(2+3)*4')).toBe(20);
  });

  it('handles unary minus', () => {
    expect(evaluateNumericExpression('-5+2')).toBe(-3);
    expect(evaluateNumericExpression('5+-3')).toBe(2);
  });

  it('trims whitespace', () => {
    expect(evaluateNumericExpression('  7  *  8  ')).toBe(56);
  });

  it('returns null for empty', () => {
    expect(evaluateNumericExpression('')).toBeNull();
    expect(evaluateNumericExpression('   ')).toBeNull();
  });

  it('returns null for division by zero', () => {
    expect(evaluateNumericExpression('1/0')).toBeNull();
    expect(evaluateNumericExpression('5/(3-3)')).toBeNull();
  });

  it('returns null for invalid syntax', () => {
    expect(evaluateNumericExpression('++1')).toBeNull();
    expect(evaluateNumericExpression('5+')).toBeNull();
    expect(evaluateNumericExpression('*5')).toBeNull();
    expect(evaluateNumericExpression('(1+2')).toBeNull();
    expect(evaluateNumericExpression('1+2)')).toBeNull();
  });

  it('parseTouchNumericForCommit matches evaluate', () => {
    expect(parseTouchNumericForCommit('  4/2  ')).toBe(2);
  });
});

describe('parseUnsignedIntFromNumericExpression', () => {
  it('rounds and allows zero', () => {
    expect(parseUnsignedIntFromNumericExpression('2400/2')).toBe(1200);
    expect(parseUnsignedIntFromNumericExpression('0')).toBe(0);
    expect(parseUnsignedIntFromNumericExpression('2.4')).toBe(2);
  });

  it('rejects negative', () => {
    expect(parseUnsignedIntFromNumericExpression('-1')).toBeNull();
    expect(parseUnsignedIntFromNumericExpression('3-5')).toBeNull();
  });
});

describe('parsePositiveIntFromNumericExpression', () => {
  it('requires value > 0', () => {
    expect(parsePositiveIntFromNumericExpression('600')).toBe(600);
    expect(parsePositiveIntFromNumericExpression('0')).toBeNull();
    expect(parsePositiveIntFromNumericExpression('2-2')).toBeNull();
  });
});
