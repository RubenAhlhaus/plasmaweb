import type { MacroParams } from '@/types/macros';
import { parseTouchNumericForCommit } from '@/lib/evaluateNumericExpression';
import { parseCustomPatternRowsForUi } from '@/lib/customPatternPoints';
import { strParam } from '@/lib/macroParams';

export type PatternPoint = { x: number; y: number };

/** Hard cap to avoid huge generated programs (e.g. polar with tiny step angle). */
export const MAX_PATTERN_POSITIONS = 2000;

const DEG = Math.PI / 180;

function assertUnderCap(currentLen: number): void {
  if (currentLen > MAX_PATTERN_POSITIONS) {
    throw new Error(
      `Pattern expands to more than ${MAX_PATTERN_POSITIONS} positions. Reduce hole count, grid size, or step angle.`,
    );
  }
}

/**
 * Liest einen numerischen Muster-Parameter wie bei der G-Code-Expansion (Komma als Dezimaltrennzeichen).
 * Für UI-Vorschau und Expansion gemeinsam nutzbar.
 */
export function patternNumericParam(p: MacroParams, key: string, fallback = 0): number {
  const v = p[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/**
 * Cartesian grid: hole (0,0) at (startX, startY), spacing along axes, optional rotation (deg) CCW.
 */
function expandCartesian(params: MacroParams): PatternPoint[] {
  const startX = patternNumericParam(params, 'startX');
  const startY = patternNumericParam(params, 'startY');
  const sx = patternNumericParam(params, 'spacingX');
  const sy = patternNumericParam(params, 'spacingY');
  const cols = Math.max(1, Math.round(patternNumericParam(params, 'columns', 1)));
  const rows = Math.max(1, Math.round(patternNumericParam(params, 'rows', 1)));
  assertUnderCap(cols * rows);
  const rotDeg = patternNumericParam(params, 'rotationAngle');
  const c = Math.cos(rotDeg * DEG);
  const s = Math.sin(rotDeg * DEG);
  const out: PatternPoint[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const lx = col * sx;
      const ly = row * sy;
      const xr = lx * c - ly * s;
      const yr = lx * s + ly * c;
      out.push({ x: startX + xr, y: startY + yr });
    }
  }
  return out;
}

/**
 * Point on a pitch circle. Angles are machine-plan degrees with **0° at +Y** (above the
 * centre) and increasing **counter-clockwise** (90° = −X, 180° = −Y, 270° = +X).
 * Implemented as standard math angle offset by +90°.
 */
function pointOnPitchCircle(cx: number, cy: number, r: number, angDeg: number): PatternPoint {
  const a = (angDeg + 90) * DEG;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

/**
 * Explicit XY list from `customPatternPoints` JSON.
 */
function expandCustom(params: MacroParams): PatternPoint[] {
  const raw = strParam(params, 'customPatternPoints').trim();
  if (!raw) {
    throw new Error('customPatternPoints is empty.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('customPatternPoints is not valid JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('customPatternPoints must be a JSON array.');
  }
  const out: PatternPoint[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== 'object') {
      throw new Error('Each custom pattern entry must be an object with x and y.');
    }
    const o = row as Record<string, unknown>;
    const x = patternNumericParam(o as MacroParams, 'x');
    const y = patternNumericParam(o as MacroParams, 'y');
    assertUnderCap(out.length + 1);
    out.push({ x, y });
  }
  if (out.length === 0) {
    throw new Error('custom pattern must contain at least one position.');
  }
  return out;
}

/**
 * Polar: holes on pitch circle. Full 360° uses equal spacing by count; otherwise arc from startAngle to endAngle.
 * Start angle 0° places the first hole directly above the centre (+Y).
 */
function expandPolar(params: MacroParams): PatternPoint[] {
  const cx = patternNumericParam(params, 'centerX');
  const cy = patternNumericParam(params, 'centerY');
  const d = patternNumericParam(params, 'pitchCircleDiameter');
  const r = d / 2;
  const count = Math.max(1, Math.round(patternNumericParam(params, 'count', 1)));
  const startDeg = patternNumericParam(params, 'startAngle');
  const endDeg = patternNumericParam(params, 'endAngle', 360);
  const stepDeg = patternNumericParam(params, 'stepAngle');

  const out: PatternPoint[] = [];

  if (count === 1) {
    out.push(pointOnPitchCircle(cx, cy, r, startDeg));
    return out;
  }

  const span = endDeg - startDeg;
  const fullCircle = Math.abs(span) >= 359.99 || Math.abs(span) <= 0.001;

  if (stepDeg > 0.0001) {
    let ang = startDeg;
    const endLimit = startDeg + span;
    while (ang <= endLimit + 1e-6) {
      assertUnderCap(out.length + 1);
      out.push(pointOnPitchCircle(cx, cy, r, ang));
      ang += stepDeg;
    }
    return out;
  }

  if (fullCircle) {
    assertUnderCap(count);
    for (let i = 0; i < count; i++) {
      out.push(pointOnPitchCircle(cx, cy, r, startDeg + (360 * i) / count));
    }
    return out;
  }

  assertUnderCap(count);
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0;
    out.push(pointOnPitchCircle(cx, cy, r, startDeg + t * span));
  }
  return out;
}

export function expandPatternPositions(patternParams: MacroParams): PatternPoint[] {
  const pt = strParam(patternParams, 'patternType') || 'rectangular';
  if (pt === 'custom') return expandCustom(patternParams);
  if (pt === 'round' || pt === 'polar') {
    if (pt === 'round') {
      // Full circle with equal spacing; startAngle rotates the whole pattern.
      // endAngle must be start + 360 so span is 360 — not 360 − start (that arc mode
      // bunches the last gap and breaks equal angular step).
      const startDeg = patternNumericParam(patternParams, 'startAngle');
      const merged = { ...patternParams, endAngle: startDeg + 360, stepAngle: 0 };
      return expandPolar(merged);
    }
    return expandPolar(patternParams);
  }
  return expandCartesian(patternParams);
}

/** Same geometry as G-Code expansion; returns null if parameters are invalid or expansion fails. */
export function tryExpandPatternPositions(patternParams: MacroParams): PatternPoint[] | null {
  try {
    return expandPatternPositions(patternParams);
  } catch (err) {
    if (import.meta.env.DEV) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[tryExpandPatternPositions]', msg);
    }
    return null;
  }
}

const PREVIEW_INTEGER_MACRO_FIELDS = new Set(['count', 'columns', 'rows']);

export type PatternLiveNumericDraft =
  | { kind: 'macro'; field: string; draft: string }
  | { kind: 'custom'; rowId: string; axis: 'x' | 'y'; draft: string };

/**
 * Builds params for XY pattern preview while a touch numeric dialog is open:
 * overlays `draft` when it parses as a number; otherwise keeps the committed value
 * (or full `base` for macro keys if the expression is still incomplete/invalid).
 * For macro keys, a whitespace-only draft returns `base` by reference (no overlay).
 */
export function buildPatternPreviewParams(
  base: MacroParams,
  live: PatternLiveNumericDraft | null,
): MacroParams {
  if (!live) return base;

  if (live.kind === 'macro') {
    const t = live.draft.trim();
    if (t === '') {
      return base;
    }
    const merged: MacroParams = { ...base };
    const n = parseTouchNumericForCommit(live.draft);
    if (n === null) {
      return base;
    }
    if (PREVIEW_INTEGER_MACRO_FIELDS.has(live.field)) {
      merged[live.field] = String(Math.round(n));
    } else {
      merged[live.field] = String(n);
    }
    return merged;
  }

  const rows = parseCustomPatternRowsForUi(strParam(base, 'customPatternPoints'));
  const arr = rows.map((r) => {
    const useX = r.id === live.rowId && live.axis === 'x' ? live.draft : r.x;
    const useY = r.id === live.rowId && live.axis === 'y' ? live.draft : r.y;
    const fbX = patternNumericParam({ x: r.x, y: r.y } as MacroParams, 'x');
    const fbY = patternNumericParam({ x: r.x, y: r.y } as MacroParams, 'y');
    const parseOr = (s: string, fallback: number): number => {
      const p = parseTouchNumericForCommit(s.trim() === '' ? '' : s);
      return p !== null ? p : fallback;
    };
    return {
      id: r.id,
      x: parseOr(String(useX), fbX),
      y: parseOr(String(useY), fbY),
    };
  });
  return { ...base, customPatternPoints: JSON.stringify(arr) };
}
