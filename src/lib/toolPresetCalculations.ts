/** Pure helpers for tool cut preset fields (mm, m/min, U/min). */

const PI = Math.PI;

function positive(n: number | undefined): n is number {
  return n !== undefined && Number.isFinite(n) && n > 0;
}

function nonNegative(n: number | undefined): n is number {
  return n !== undefined && Number.isFinite(n) && n >= 0;
}

/** Surface speed m/min from diameter mm and spindle rpm. */
export function surfaceSpeedFromRpm(diameterMm: number | undefined, rpm: number | undefined): number | undefined {
  if (!positive(diameterMm) || !positive(rpm)) return undefined;
  return (PI * diameterMm * rpm) / 1000;
}

/** Spindle rpm from surface speed m/min and diameter mm. */
export function rpmFromSurfaceSpeed(diameterMm: number | undefined, vcMPerMin: number | undefined): number | undefined {
  if (!positive(diameterMm) || !positive(vcMPerMin)) return undefined;
  const n = (vcMPerMin * 1000) / (PI * diameterMm);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Feed per tooth (mm) from feed mm/min, rpm, flute count. */
export function feedPerToothFromFeed(
  feedMmMin: number | undefined,
  rpm: number | undefined,
  flutes: number | undefined,
): number | undefined {
  if (!nonNegative(feedMmMin) || !positive(rpm) || !positive(flutes)) return undefined;
  const fz = feedMmMin / (rpm * flutes);
  return Number.isFinite(fz) && fz >= 0 ? fz : undefined;
}

/** Cutting feed mm/min from feed per tooth mm, rpm, flute count. */
export function feedFromFeedPerTooth(
  feedPerToothMm: number | undefined,
  rpm: number | undefined,
  flutes: number | undefined,
): number | undefined {
  if (!nonNegative(feedPerToothMm) || !positive(rpm) || !positive(flutes)) return undefined;
  const vf = feedPerToothMm * rpm * flutes;
  return Number.isFinite(vf) && vf >= 0 ? vf : undefined;
}

/** Plunge feed per revolution (mm) from plunge mm/min and rpm. */
export function plungeFeedPerRevFromPlunge(plungeMmMin: number | undefined, rpm: number | undefined): number | undefined {
  if (!nonNegative(plungeMmMin) || !positive(rpm)) return undefined;
  const p = plungeMmMin / rpm;
  return Number.isFinite(p) && p >= 0 ? p : undefined;
}

/** Plunge feed mm/min from mm/rev and rpm. */
export function plungeFromPlungeFeedPerRev(
  plungeFeedPerRevMm: number | undefined,
  rpm: number | undefined,
): number | undefined {
  if (!nonNegative(plungeFeedPerRevMm) || !positive(rpm)) return undefined;
  const v = plungeFeedPerRevMm * rpm;
  return Number.isFinite(v) && v >= 0 ? v : undefined;
}

export type ToolGeometryForPreset = {
  diameterMm?: number;
  numberOfFlutes?: number;
};

export type ToolPresetGeometryWarningKey = 'missingDiameter' | 'invalidFlutes';

/** Reasons the UI may show a warning (missing geometry for linked fields). */
export function presetGeometryWarnings(geo: ToolGeometryForPreset): ToolPresetGeometryWarningKey[] {
  const w: ToolPresetGeometryWarningKey[] = [];
  if (!positive(geo.diameterMm)) {
    w.push('missingDiameter');
  }
  const z = geo.numberOfFlutes;
  if (z === undefined || !Number.isFinite(z) || z <= 0) {
    w.push('invalidFlutes');
  }
  return w;
}
