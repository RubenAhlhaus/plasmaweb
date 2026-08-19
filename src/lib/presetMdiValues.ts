import type { ToolPreset } from '@/types/tools';
import { formatMdiLineWithComment } from '@/lib/mdiLineFormat';

/** From preset → integers for MDI `S` / `F`; `null` if incomplete or F ≤ 0. */
export function presetMdiValues(p: ToolPreset | undefined): { s: number; f: number } | null {
  if (!p) return null;
  const sr = p.spindle_rpm;
  const ff = p.feed_mm_min;
  if (sr == null || !Number.isFinite(sr) || ff == null || !Number.isFinite(ff)) return null;
  const s = Math.max(0, Math.round(sr));
  const f = Math.round(ff);
  if (f <= 0) return null;
  return { s, f };
}

export function presetDisplayLabel(p: ToolPreset): string {
  return p.name?.trim() || p.id;
}

export function presetSelectOptions(
  presets: ToolPreset[],
): Array<{ value: string; label: string }> {
  return presets.map((p) => ({ value: p.id, label: presetDisplayLabel(p) }));
}

/** MDI line for preset spindle speed and feed; optional `; preset` comment for history/UI. */
export function formatPresetMdiLine(
  values: { s: number; f: number },
  presetLabel?: string,
): string {
  return formatMdiLineWithComment(`S${values.s} F${values.f}`, presetLabel);
}
