import { evaluateNumericExpression } from '@/lib/evaluateNumericExpression';

export function parseMacroNumberStrict(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return evaluateNumericExpression(trimmed);
  }
  return null;
}

export function parseMacroNumberWithDefault(value: unknown, fallback: number): number {
  const parsed = parseMacroNumberStrict(value);
  return parsed ?? fallback;
}
