import type { MacroDefinition, MacroParams } from '@/types/macros';
import i18n from '@/i18n/config';
import { parseTouchNumericForCommit } from '@/lib/evaluateNumericExpression';
import { expandPatternPositions } from '@/lib/macroGcode/expandPatternPositions';
import { strParam } from '@/lib/macroParams';

export type NestedPatternSubmitResult =
  | { ok: true; resolved: MacroParams }
  | { ok: false; message: string };

function mt(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, { ns: 'macros', ...options });
}

function parseRequiredNumber(
  raw: unknown,
  label: string,
): { ok: true; n: number } | { ok: false; message: string } {
  const s = String(raw ?? '').trim();
  if (s === '') return { ok: false, message: mt('patternValidation.fillField', { field: label }) };
  const n = parseTouchNumericForCommit(s);
  if (n === null) {
    return {
      ok: false,
      message: mt('patternValidation.invalidExpression', { field: label }),
    };
  }
  return { ok: true, n };
}

const PATTERN_LABEL_KEYS: Record<string, string> = {
  name: 'patternLabels.name',
  surfaceZ: 'patternLabels.surfaceZ',
  centerX: 'patternLabels.centerX',
  centerY: 'patternLabels.centerY',
  count: 'patternLabels.count',
  pitchCircleDiameter: 'patternLabels.pitchCircleDiameter',
  startAngle: 'patternLabels.startAngle',
  startX: 'patternLabels.startX',
  startY: 'patternLabels.startY',
  columns: 'patternLabels.columns',
  rows: 'patternLabels.rows',
  spacingX: 'patternLabels.spacingX',
  spacingY: 'patternLabels.spacingY',
  rotationAngle: 'patternLabels.rotationAngle',
};

function patternFieldLabel(fieldKey: string): string {
  const path = PATTERN_LABEL_KEYS[fieldKey];
  return path ? mt(path) : fieldKey;
}

/**
 * Commit validation for nested pattern (`nested-pattern-block`) params.
 */
export function validateNestedPatternParamsForSubmit(
  definition: MacroDefinition,
  params: MacroParams,
): NestedPatternSubmitResult {
  const name = strParam(params, 'name').trim();
  if (!name) {
    return { ok: false, message: mt('patternValidation.fillField', { field: patternFieldLabel('name') }) };
  }

  const sz = parseRequiredNumber(params.surfaceZ, patternFieldLabel('surfaceZ'));
  if (!sz.ok) return sz;

  const pt = strParam(params, 'patternType');
  if (pt !== 'custom' && pt !== 'round' && pt !== 'rectangular') {
    return { ok: false, message: mt('patternValidation.invalidPatternType') };
  }

  const base: MacroParams = { ...definition.defaultParams, ...params, name, surfaceZ: sz.n };

  if (pt === 'custom') {
    const raw = strParam(params, 'customPatternPoints').trim();
    if (!raw) {
      return { ok: false, message: mt('patternValidation.minOnePosition') };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, message: mt('patternValidation.positionsInvalidJson') };
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { ok: false, message: mt('patternValidation.minOnePosition') };
    }
    for (const row of parsed) {
      if (!row || typeof row !== 'object') {
        return { ok: false, message: mt('patternValidation.positionsInvalidJson') };
      }
      const o = row as Record<string, unknown>;
      const x = parseRequiredNumber(o.x, mt('patternValidation.coordX'));
      if (!x.ok) return x;
      const y = parseRequiredNumber(o.y, mt('patternValidation.coordY'));
      if (!y.ok) return y;
    }
    base.customPatternPoints = raw;
    base.patternType = 'custom';
  } else if (pt === 'round') {
    for (const key of ['centerX', 'centerY', 'pitchCircleDiameter', 'startAngle', 'count'] as const) {
      const r = parseRequiredNumber(params[key], patternFieldLabel(key));
      if (!r.ok) return r;
      base[key] = r.n;
    }
    base.count = Math.max(1, Math.round(Number(base.count)));
    const d = Number(base.pitchCircleDiameter);
    if (!(d > 0)) {
      return { ok: false, message: mt('patternValidation.pitchDiameterPositive') };
    }
    base.endAngle = 360;
    base.stepAngle = 0;
    base.patternType = 'round';
  } else {
    for (const key of ['startX', 'startY', 'spacingX', 'spacingY', 'columns', 'rows'] as const) {
      const r = parseRequiredNumber(params[key], patternFieldLabel(key));
      if (!r.ok) return r;
      base[key] = r.n;
    }
    const rotRaw = strParam(params, 'rotationAngle').trim();
    if (rotRaw === '') {
      base.rotationAngle = 0;
    } else {
      const r = parseRequiredNumber(params.rotationAngle, patternFieldLabel('rotationAngle'));
      if (!r.ok) return r;
      base.rotationAngle = r.n;
    }
    base.columns = Math.max(1, Math.round(Number(base.columns)));
    base.rows = Math.max(1, Math.round(Number(base.rows)));
    base.patternType = 'rectangular';
  }

  delete base.applyToMacro;
  delete base.safeZ;
  delete base.moveToClearanceEachHole;

  try {
    expandPatternPositions(base);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }

  return { ok: true, resolved: base };
}
