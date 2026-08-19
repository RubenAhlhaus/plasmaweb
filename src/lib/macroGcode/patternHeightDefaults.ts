import { parseMacroNumberStrict, parseMacroNumberWithDefault } from '@/lib/macroNumeric';
import type { MacroParams } from '@/types/macros';

/**
 * Clearance above pattern / workpiece `surfaceZ` used as default safe Z
 * when no explicit pattern `safeZ` is available (legacy patterns used absolute
 * `safeZ: 5` with `surfaceZ: 0`).
 */
export const PATTERN_DEFAULT_SAFE_CLEARANCE_MM = 5;

export type PatternHeightDefaults = {
  /** Workpiece surface Z from the parent pattern. */
  surfaceZ: number;
  /** Suggested safe Z (XY travel / retract) for nested drill or helix phases. */
  safeZ: number;
};

/** Absolute safe Z above a surface (shared by dialog prefill and emitters). */
export function defaultSafeZAboveSurface(surfaceZ: number): number {
  return surfaceZ + PATTERN_DEFAULT_SAFE_CLEARANCE_MM;
}

/**
 * Legacy patterns may still store absolute `safeZ`; current patterns omit it.
 * Invalid / empty → `null` (callers then use child `safeZ` / legacy `startZ` or {@link defaultSafeZAboveSurface}).
 */
export function readOptionalPatternSafeZ(params: MacroParams): number | null {
  const raw = params.safeZ;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  return parseMacroNumberStrict(raw);
}

/**
 * Heights to prefill when adding a drill / helical-bore phase inside a pattern.
 * Prefers legacy pattern `safeZ` when present; otherwise {@link defaultSafeZAboveSurface}.
 */
export function patternHeightDefaultsFromParams(params: MacroParams): PatternHeightDefaults {
  const surfaceZ = parseMacroNumberWithDefault(params.surfaceZ, 0);
  const safeZ = readOptionalPatternSafeZ(params);
  if (safeZ !== null) {
    return { surfaceZ, safeZ };
  }
  return { surfaceZ, safeZ: defaultSafeZAboveSurface(surfaceZ) };
}
