/**
 * UI + persistence helpers for nested pattern `customPatternPoints` (JSON array of { id, x, y }).
 * `id` is stable for React keys; G-Code expansion ignores `id` and reads only x/y.
 */

export type CustomPatternRowEditable = { id: string; x: string; y: string };

export function newCustomPatternRowId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `pt-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Add missing `id` on each row; repair empty/invalid JSON to a single default row. */
export function ensureCustomPatternPointsJsonHasRowIds(json: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return JSON.stringify([{ id: newCustomPatternRowId(), x: 0, y: 0 }]);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return JSON.stringify([{ id: newCustomPatternRowId(), x: 0, y: 0 }]);
  }
  const next = parsed.map((row) => {
    if (!row || typeof row !== 'object') {
      return { id: newCustomPatternRowId(), x: 0, y: 0 };
    }
    const o = row as Record<string, unknown>;
    const hasId = typeof o.id === 'string' && o.id.trim() !== '';
    const id = hasId ? o.id.trim() : newCustomPatternRowId();
    const x = o.x;
    const y = o.y;
    return {
      id,
      x: x === undefined || x === null ? 0 : x,
      y: y === undefined || y === null ? 0 : y,
    };
  });
  return JSON.stringify(next);
}

export function parseCustomPatternRowsForUi(json: string): CustomPatternRowEditable[] {
  const ensured = ensureCustomPatternPointsJsonHasRowIds(json);
  try {
    const p = JSON.parse(ensured) as Array<{ id: string; x?: unknown; y?: unknown }>;
    return p.map((row) => ({
      id: row.id,
      x: row.x === undefined || row.x === null ? '' : String(row.x),
      y: row.y === undefined || row.y === null ? '' : String(row.y),
    }));
  } catch {
    return [{ id: newCustomPatternRowId(), x: '', y: '' }];
  }
}

export function serializeCustomPatternRows(rows: CustomPatternRowEditable[]): string {
  const arr = rows.map((r) => {
    const xs = String(r.x ?? '').trim().replace(',', '.');
    const ys = String(r.y ?? '').trim().replace(',', '.');
    const x = xs === '' ? 0 : Number(xs);
    const y = ys === '' ? 0 : Number(ys);
    return {
      id: r.id.trim() !== '' ? r.id : newCustomPatternRowId(),
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
    };
  });
  return JSON.stringify(arr);
}
