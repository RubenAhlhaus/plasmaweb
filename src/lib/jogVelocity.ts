import type { IniRuntimeConfig } from '@/store/types';

/** Fallback jog speed in mm/min, used when the INI has no `[DISPLAY] DEFAULT_LINEAR_VELOCITY`. */
export const DEFAULT_JOG_VELOCITY_MM_MIN = 100;

/** Fallback floor, used when the INI has no `[DISPLAY] MIN_LINEAR_VELOCITY`. */
export const MIN_JOG_VELOCITY_MM_MIN = 1;
/** Fallback ceiling, used when the INI has no `[DISPLAY] MAX_LINEAR_VELOCITY`. */
export const MAX_JOG_VELOCITY_MM_MIN = 1000;
/** Picker / store resolution (mm/min). */
export const JOG_VELOCITY_STEP_MM_MIN = 1;
/** Coarser step for the range slider only. */
export const JOG_VELOCITY_SLIDER_STEP_MM_MIN = 10;

/** Jog speed range and starting value, in machine units per minute. */
export interface JogVelocityLimits {
  min: number;
  max: number;
  default: number;
}

export const FALLBACK_JOG_VELOCITY_LIMITS: JogVelocityLimits = {
  min: MIN_JOG_VELOCITY_MM_MIN,
  max: MAX_JOG_VELOCITY_MM_MIN,
  default: DEFAULT_JOG_VELOCITY_MM_MIN,
};

type IniJogFields = Pick<
  IniRuntimeConfig,
  'default_linear_velocity' | 'min_linear_velocity' | 'max_linear_velocity'
>;

/** A positive INI velocity (machine units per second) as units per minute, else null. */
function perMinute(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value * 60 : null;
}

/**
 * Jog limits from the INI's `[DISPLAY] DEFAULT/MIN/MAX_LINEAR_VELOCITY` (units per second,
 * as every LinuxCNC GUI reads them), each falling back to this UI's built-in value.
 */
export function jogVelocityLimitsFromIni(ini: IniJogFields | null | undefined): JogVelocityLimits {
  const max = perMinute(ini?.max_linear_velocity) ?? MAX_JOG_VELOCITY_MM_MIN;
  const min = Math.min(perMinute(ini?.min_linear_velocity) ?? MIN_JOG_VELOCITY_MM_MIN, max);
  const preferred = perMinute(ini?.default_linear_velocity) ?? DEFAULT_JOG_VELOCITY_MM_MIN;
  return { min, max, default: Math.min(max, Math.max(min, preferred)) };
}

export function clampJogVelocityMmPerMin(
  value: number,
  limits: JogVelocityLimits = FALLBACK_JOG_VELOCITY_LIMITS,
): number {
  if (!Number.isFinite(value)) {
    return limits.default;
  }
  const stepped =
    Math.round(value / JOG_VELOCITY_STEP_MM_MIN) * JOG_VELOCITY_STEP_MM_MIN;
  return Math.min(limits.max, Math.max(limits.min, stepped));
}
