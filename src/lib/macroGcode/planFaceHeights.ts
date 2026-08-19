import { numParam } from '@/lib/macroParams';
import { parseMacroNumberStrict } from '@/lib/macroNumeric';
import type { MacroParams } from '@/types/macros';

/** Default stock removal when creating a new face-milling step (former default `stepDown`). */
export const DEFAULT_PLAN_FACE_STOCK_REMOVAL_MM = 0.2;

export function hasMacroParamValue(
  params: MacroParams | null | undefined,
  key: string,
): boolean {
  if (params == null) return false;
  const v = params[key];
  return v !== undefined && v !== null && String(v).trim() !== '';
}

export function defaultPlanFaceTargetZ(surfaceZ: number): number {
  return surfaceZ - DEFAULT_PLAN_FACE_STOCK_REMOVAL_MM;
}

/**
 * Absolute cut Z for face milling. Prefers `targetZ`; falls back to legacy
 * relative `stepDown` below `surfaceZ`.
 */
export function resolvePlanFaceTargetZ(params: MacroParams, surfaceZ: number): number | null {
  const targetZ = numParam(params, 'targetZ');
  if (targetZ !== null && Number.isFinite(targetZ)) return targetZ;

  const stepDown = numParam(params, 'stepDown');
  if (stepDown !== null && stepDown > 0) return surfaceZ - stepDown;
  return null;
}

/**
 * Convert legacy relative `stepDown` to absolute `targetZ` on dialog open.
 * Returns true when `targetZ` was set from `stepDown`.
 */
export function migratePlanFaceLegacyStepDown(
  next: MacroParams,
  initialParams: MacroParams | null,
): boolean {
  const initialHasTarget = hasMacroParamValue(initialParams, 'targetZ');
  const initialHasStep = hasMacroParamValue(initialParams, 'stepDown');

  let migrated = false;
  if (!initialHasTarget && initialHasStep && initialParams != null) {
    const step = parseMacroNumberStrict(String(initialParams.stepDown));
    const surface =
      typeof next.surfaceZ === 'number'
        ? next.surfaceZ
        : parseMacroNumberStrict(String(next.surfaceZ ?? ''));
    if (step !== null && surface !== null) {
      next.targetZ = surface - step;
      migrated = true;
    }
  }
  delete next.stepDown;
  return migrated;
}
