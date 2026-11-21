import type { IniRuntimeConfig } from '@/store/types';

/** Built-in override ceiling (percent), used when the INI sets none. */
export const FALLBACK_MAX_OVERRIDE_PERCENT = 200;
/** Lowest override the dialogs offer (percent); 0 % is a pause, handled elsewhere. */
export const MIN_OVERRIDE_PERCENT = 1;

export interface OverridePercentRange {
  min: number;
  max: number;
}

function percent(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value * 100)
    : null;
}

/** Feed override range from the INI's `[DISPLAY] MAX_FEED_OVERRIDE` (a factor, 1.0 = 100 %). */
export function feedOverridePercentRange(
  ini: Pick<IniRuntimeConfig, 'max_feed_override'> | null | undefined,
): OverridePercentRange {
  const max = Math.max(MIN_OVERRIDE_PERCENT, percent(ini?.max_feed_override) ?? FALLBACK_MAX_OVERRIDE_PERCENT);
  return { min: MIN_OVERRIDE_PERCENT, max };
}

/** Spindle override range from the INI's `[DISPLAY] MIN/MAX_SPINDLE_OVERRIDE`. */
export function spindleOverridePercentRange(
  ini: Pick<IniRuntimeConfig, 'min_spindle_override' | 'max_spindle_override'> | null | undefined,
): OverridePercentRange {
  const max = Math.max(
    MIN_OVERRIDE_PERCENT,
    percent(ini?.max_spindle_override) ?? FALLBACK_MAX_OVERRIDE_PERCENT,
  );
  const min = Math.min(max, Math.max(MIN_OVERRIDE_PERCENT, percent(ini?.min_spindle_override) ?? 0));
  return { min, max };
}

export function clampOverridePercent(value: number, range: OverridePercentRange): number {
  return Math.min(range.max, Math.max(range.min, value));
}
