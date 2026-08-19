import {
  parseVirtualSidebarHotkeysMap,
  type VirtualSidebarHotkey,
  type VirtualSidebarHotkeysMap,
  type VirtualSidebarButtonId,
} from '@/lib/virtualSidebarHotkeys';

/** localStorage key for virtual sidebar button hotkeys. */
export const VIRTUAL_SIDEBAR_HOTKEYS_STORAGE_KEY = 'lcncgui.virtualSidebarHotkeys';

export function readStoredVirtualSidebarHotkeys(): VirtualSidebarHotkeysMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(VIRTUAL_SIDEBAR_HOTKEYS_STORAGE_KEY);
    if (!raw) return {};
    return parseVirtualSidebarHotkeysMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function persistVirtualSidebarHotkeys(map: VirtualSidebarHotkeysMap): void {
  try {
    window.localStorage.setItem(VIRTUAL_SIDEBAR_HOTKEYS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / private mode */
  }
}

export function persistVirtualSidebarHotkey(
  buttonId: VirtualSidebarButtonId,
  hotkey: VirtualSidebarHotkey | null,
  current: VirtualSidebarHotkeysMap,
): VirtualSidebarHotkeysMap {
  const next = { ...current };
  if (hotkey) {
    next[buttonId] = hotkey;
  } else {
    delete next[buttonId];
  }
  persistVirtualSidebarHotkeys(next);
  return next;
}
