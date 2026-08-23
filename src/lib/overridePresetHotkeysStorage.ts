import {
  parseOverridePresetHotkeysMap,
  type OverridePresetHotkeysMap,
  type OverridePresetKind,
  type OverridePresetPosition,
} from '@/lib/overridePresetHotkeys';
import type { VirtualSidebarHotkey } from '@/lib/virtualSidebarHotkeys';

export const FEED_OVERRIDE_HOTKEYS_STORAGE_KEY = 'plasmaweb.feedOverrideHotkeys';
export const SPINDLE_OVERRIDE_HOTKEYS_STORAGE_KEY = 'plasmaweb.spindleOverrideHotkeys';

function storageKeyForKind(kind: OverridePresetKind): string {
  return kind === 'feed'
    ? FEED_OVERRIDE_HOTKEYS_STORAGE_KEY
    : SPINDLE_OVERRIDE_HOTKEYS_STORAGE_KEY;
}

export function readStoredOverridePresetHotkeys(
  kind: OverridePresetKind,
): OverridePresetHotkeysMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(storageKeyForKind(kind));
    if (!raw) return {};
    return parseOverridePresetHotkeysMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function persistOverridePresetHotkeys(
  kind: OverridePresetKind,
  map: OverridePresetHotkeysMap,
): void {
  try {
    window.localStorage.setItem(storageKeyForKind(kind), JSON.stringify(map));
  } catch {
    /* ignore quota / private mode */
  }
}

export function persistOverridePresetHotkey(
  kind: OverridePresetKind,
  position: OverridePresetPosition,
  hotkey: VirtualSidebarHotkey | null,
  current: OverridePresetHotkeysMap,
): OverridePresetHotkeysMap {
  const next = { ...current };
  if (hotkey) {
    next[position] = hotkey;
  } else {
    delete next[position];
  }
  persistOverridePresetHotkeys(kind, next);
  return next;
}
