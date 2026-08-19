/**
 * Effective spindle RPM for display: programmed S (`program.settings[2]`) × spindle
 * override when override is enabled. Falls back to `|spindle[0].speed|` as-is when S
 * is unset (that status value may already reflect the commanded/effective speed).
 */
export function effectiveSpindleRpm(
  programSpindleSetting: number | undefined | null,
  spindleOverride: number | undefined | null,
  spindleSpeedFallback?: number | undefined | null,
  overrideEnabled?: boolean | null,
): number {
  const raw = programSpindleSetting ?? 0;
  const base = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw);
  const programmed = Number.isFinite(base) ? Math.abs(base) : 0;

  if (programmed <= 0) {
    const fb = spindleSpeedFallback ?? 0;
    const fbN = typeof fb === 'number' && Number.isFinite(fb) ? fb : Number(fb);
    return Number.isFinite(fbN) ? Math.abs(fbN) : 0;
  }

  if (overrideEnabled === false) {
    return programmed;
  }
  const ovRaw = spindleOverride ?? 1;
  const ov = typeof ovRaw === 'number' && Number.isFinite(ovRaw) ? ovRaw : 1;
  return programmed * ov;
}
