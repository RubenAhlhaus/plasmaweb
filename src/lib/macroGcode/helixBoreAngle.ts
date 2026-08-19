import { parseTouchNumericForCommit } from '@/lib/evaluateNumericExpression';

/** Upper bound (exclusive) for helix lead angle in degrees; matches UI and emitter. */
export const HELIX_BORE_ANGLE_MAX_EXCLUSIVE_DEG = 89.5;

export type HelixBorePitchErrorCode = 'angle_range' | 'pitch_derivation';

export function parseHelixAngleDegrees(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return parseTouchNumericForCommit(String(value ?? '').trim());
}

export function isHelixBoreAngleInOpenRange(deg: number | null): deg is number {
  return deg !== null && deg > 0 && deg < HELIX_BORE_ANGLE_MAX_EXCLUSIVE_DEG;
}

export function helixPitchMmPerRevFromDiameterAndAngle(
  nominalDiameterMm: number,
  angleDeg: number,
): number | null {
  const p = Math.PI * nominalDiameterMm * Math.tan((angleDeg * Math.PI) / 180);
  if (!Number.isFinite(p) || p <= 0) return null;
  return p;
}

/**
 * Validates helix angle and derives mm/rev pitch for `lcncgui_helix_bore` (#7).
 * Call only after nominal diameter is known to be finite and > 0.
 */
export function resolveHelixPitchMmPerRev(
  nominalDiameterMm: number,
  helixAngleRaw: unknown,
):
  | { ok: true; angleDeg: number; pitch: number }
  | { ok: false; code: HelixBorePitchErrorCode } {
  const angleDeg = parseHelixAngleDegrees(helixAngleRaw);
  if (!isHelixBoreAngleInOpenRange(angleDeg)) {
    return { ok: false, code: 'angle_range' };
  }
  const pitch = helixPitchMmPerRevFromDiameterAndAngle(nominalDiameterMm, angleDeg);
  if (pitch === null) {
    return { ok: false, code: 'pitch_derivation' };
  }
  return { ok: true, angleDeg, pitch };
}
