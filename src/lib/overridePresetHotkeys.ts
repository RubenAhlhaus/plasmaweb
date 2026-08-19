import { VIRTUAL_SIDEBAR_BUTTON_IDS } from '@/lib/virtualSidebarButtons';
import type {
  VirtualSidebarButtonId,
  VirtualSidebarHotkey,
  VirtualSidebarHotkeysMap,
} from '@/lib/virtualSidebarHotkeys';
import { hotkeysEqual, parseHotkey } from '@/lib/virtualSidebarHotkeys';

/** Encoder / rotary positions 0–15. */
export const OVERRIDE_PRESET_POSITIONS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
] as const;

export type OverridePresetPosition = (typeof OVERRIDE_PRESET_POSITIONS)[number];

export type OverridePresetKind = 'feed' | 'spindle';

export type OverridePresetHotkeysMap = Partial<
  Record<OverridePresetPosition, VirtualSidebarHotkey>
>;

function isOverridePresetPosition(value: number): value is OverridePresetPosition {
  return (OVERRIDE_PRESET_POSITIONS as readonly number[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Absolute override percent for a rotary position.
 * 0–10 → 0–100 in steps of 10; 11–15 → 125–200 in steps of 25 (capped at 200).
 */
export function overridePercentForPosition(position: OverridePresetPosition): number {
  if (position <= 10) return position * 10;
  return Math.min(200, 125 + (position - 11) * 25);
}

export function parseOverridePresetHotkeysMap(value: unknown): OverridePresetHotkeysMap {
  if (!isRecord(value)) return {};
  const map: OverridePresetHotkeysMap = {};
  for (const [rawId, rawHotkey] of Object.entries(value)) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || !isOverridePresetPosition(id)) continue;
    const hotkey = parseHotkey(rawHotkey);
    if (hotkey) map[id] = hotkey;
  }
  return map;
}

export function findOverridePositionForHotkey(
  map: OverridePresetHotkeysMap,
  hotkey: VirtualSidebarHotkey,
): OverridePresetPosition | null {
  for (const position of OVERRIDE_PRESET_POSITIONS) {
    if (hotkeysEqual(map[position], hotkey)) return position;
  }
  return null;
}

export type HotkeyConflict =
  | { scope: 'virtualSidebar'; buttonId: VirtualSidebarButtonId }
  | { scope: 'feed' | 'spindle'; position: OverridePresetPosition };

/** Finds a conflicting assignment across sidebar + feed + spindle hotkey maps. */
export function findGlobalHotkeyConflict(
  hotkey: VirtualSidebarHotkey | null,
  maps: {
    virtualSidebar: VirtualSidebarHotkeysMap;
    feed: OverridePresetHotkeysMap;
    spindle: OverridePresetHotkeysMap;
  },
  exclude: HotkeyConflict,
): HotkeyConflict | null {
  if (!hotkey) return null;

  for (const id of VIRTUAL_SIDEBAR_BUTTON_IDS) {
    if (exclude.scope === 'virtualSidebar' && exclude.buttonId === id) continue;
    if (hotkeysEqual(maps.virtualSidebar[id], hotkey)) {
      return { scope: 'virtualSidebar', buttonId: id };
    }
  }

  for (const kind of ['feed', 'spindle'] as const) {
    for (const position of OVERRIDE_PRESET_POSITIONS) {
      if (exclude.scope === kind && exclude.position === position) continue;
      if (hotkeysEqual(maps[kind][position], hotkey)) {
        return { scope: kind, position };
      }
    }
  }

  return null;
}
