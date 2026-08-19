/** Default jog speed in mm/min (matches former fixed `motion.jog` velocity). */
export const DEFAULT_JOG_VELOCITY_MM_MIN = 100;

export const MIN_JOG_VELOCITY_MM_MIN = 1;
/** Practical upper bound for button jogging (keeps the slider usable). */
export const MAX_JOG_VELOCITY_MM_MIN = 1000;
/** Picker / store resolution (mm/min). */
export const JOG_VELOCITY_STEP_MM_MIN = 1;
/** Coarser step for the range slider only. */
export const JOG_VELOCITY_SLIDER_STEP_MM_MIN = 10;

export function clampJogVelocityMmPerMin(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_JOG_VELOCITY_MM_MIN;
  }
  const stepped =
    Math.round(value / JOG_VELOCITY_STEP_MM_MIN) * JOG_VELOCITY_STEP_MM_MIN;
  return Math.min(MAX_JOG_VELOCITY_MM_MIN, Math.max(MIN_JOG_VELOCITY_MM_MIN, stepped));
}
