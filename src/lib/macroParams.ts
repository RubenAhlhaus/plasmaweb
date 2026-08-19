import type { MacroParams } from '@/types/macros';
import { parseMacroNumberStrict } from '@/lib/macroNumeric';

/** Reads a macro param as a display string; `undefined`/`null` become `''`. */
export function strParam(p: MacroParams, key: string): string {
  const v = p[key];
  if (v === undefined || v === null) return '';
  return String(v);
}

/**
 * Reads a macro param as a boolean.
 * `true`/`'true'` → `true`; everything else (incl. `false`/`'false'`) → `false`.
 */
export function boolParam(p: MacroParams, key: string): boolean {
  const v = p[key];
  if (v === true || v === 'true') return true;
  return false;
}

/** Reads a macro param as a number (accepts numeric expressions); invalid/empty → `null`. */
export function numParam(p: MacroParams, key: string): number | null {
  return parseMacroNumberStrict(p[key]);
}

/**
 * Safe / XY-travel height: prefer `safeZ`, fall back to legacy `startZ`.
 */
export function numSafeZParam(p: MacroParams): number | null {
  return numParam(p, 'safeZ') ?? numParam(p, 'startZ');
}

/**
 * Move legacy drill/helix `startZ` into `safeZ` when `safeZ` is empty.
 * Mutates `params` and drops `startZ` after a successful migrate.
 */
export function migrateLegacyStartZToSafeZ(params: MacroParams): void {
  const safeRaw = String(params.safeZ ?? '').trim();
  if (safeRaw !== '') {
    delete params.startZ;
    return;
  }
  const legacy = params.startZ;
  if (legacy === undefined || legacy === null || String(legacy).trim() === '') {
    delete params.startZ;
    return;
  }
  params.safeZ = legacy;
  delete params.startZ;
}
