/**
 * Effective feed for display: interpreter F (`program.settings[1]`) × feed override.
 */
export function effectiveFeedRateMmMin(
  programFeedSetting: number | undefined | null,
  feedOverride: number | undefined | null,
): number {
  const raw = programFeedSetting ?? 0;
  const base = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw);
  const f = Number.isFinite(base) ? base : 0;
  const ovRaw = feedOverride ?? 1;
  const ov = typeof ovRaw === 'number' && Number.isFinite(ovRaw) ? ovRaw : 1;
  return f * ov;
}
