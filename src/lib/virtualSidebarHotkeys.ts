import { VIRTUAL_SIDEBAR_BUTTON_IDS } from '@/lib/virtualSidebarButtons';

export { VIRTUAL_SIDEBAR_BUTTON_IDS };

export type VirtualSidebarButtonId = (typeof VIRTUAL_SIDEBAR_BUTTON_IDS)[number];

export type VirtualSidebarHotkey = {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
};

export type VirtualSidebarHotkeysMap = Partial<
  Record<VirtualSidebarButtonId, VirtualSidebarHotkey>
>;

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

function isVirtualSidebarButtonId(value: number): value is VirtualSidebarButtonId {
  return (VIRTUAL_SIDEBAR_BUTTON_IDS as readonly number[]).includes(value);
}

/** Normalizes `KeyboardEvent.key` for storage and matching. */
export function normalizeHotkeyKey(key: string): string | null {
  if (MODIFIER_KEYS.has(key)) return null;
  if (key === ' ') return 'Space';
  return key;
}

export function hotkeyFromKeyboardEvent(event: KeyboardEvent): VirtualSidebarHotkey | null {
  const key = normalizeHotkeyKey(event.key);
  if (!key) return null;
  const hotkey: VirtualSidebarHotkey = { key };
  if (event.ctrlKey) hotkey.ctrl = true;
  if (event.altKey) hotkey.alt = true;
  if (event.shiftKey) hotkey.shift = true;
  if (event.metaKey) hotkey.meta = true;
  return hotkey;
}

export function hotkeysEqual(
  a: VirtualSidebarHotkey | null | undefined,
  b: VirtualSidebarHotkey | null | undefined,
): boolean {
  if (!a || !b) return false;
  return (
    a.key === b.key &&
    !!a.ctrl === !!b.ctrl &&
    !!a.alt === !!b.alt &&
    !!a.shift === !!b.shift &&
    !!a.meta === !!b.meta
  );
}

export type HotkeyDisplayLabels = {
  ctrl: string;
  alt: string;
  shift: string;
  meta: string;
  space: string;
};

export const DEFAULT_HOTKEY_DISPLAY_LABELS: HotkeyDisplayLabels = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  meta: 'Meta',
  space: 'Space',
};

function formatKeyLabel(key: string, spaceLabel: string): string {
  if (key === 'Space' || key === ' ') return spaceLabel;
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** Human-readable shortcut label, e.g. Ctrl+Shift+F1 (labels are localizable). */
export function formatHotkey(
  hotkey: VirtualSidebarHotkey,
  labels: HotkeyDisplayLabels = DEFAULT_HOTKEY_DISPLAY_LABELS,
): string {
  const parts: string[] = [];
  if (hotkey.ctrl) parts.push(labels.ctrl);
  if (hotkey.alt) parts.push(labels.alt);
  if (hotkey.shift) parts.push(labels.shift);
  if (hotkey.meta) parts.push(labels.meta);
  parts.push(formatKeyLabel(hotkey.key, labels.space));
  return parts.join('+');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses a stored hotkey object; returns null when the shape is invalid. */
export function parseHotkey(value: unknown): VirtualSidebarHotkey | null {
  if (!isRecord(value)) return null;
  if (typeof value.key !== 'string' || value.key.length === 0) return null;
  const hotkey: VirtualSidebarHotkey = { key: value.key };
  if (value.ctrl === true) hotkey.ctrl = true;
  if (value.alt === true) hotkey.alt = true;
  if (value.shift === true) hotkey.shift = true;
  if (value.meta === true) hotkey.meta = true;
  return hotkey;
}

export function parseVirtualSidebarHotkeysMap(value: unknown): VirtualSidebarHotkeysMap {
  if (!isRecord(value)) return {};
  const map: VirtualSidebarHotkeysMap = {};
  for (const [rawId, rawHotkey] of Object.entries(value)) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || !isVirtualSidebarButtonId(id)) continue;
    const hotkey = parseHotkey(rawHotkey);
    if (hotkey) map[id] = hotkey;
  }
  return map;
}

export function findButtonIdForHotkey(
  map: VirtualSidebarHotkeysMap,
  hotkey: VirtualSidebarHotkey,
): VirtualSidebarButtonId | null {
  for (const id of VIRTUAL_SIDEBAR_BUTTON_IDS) {
    if (hotkeysEqual(map[id], hotkey)) return id;
  }
  return null;
}

/**
 * Returns true when global shortcuts should be ignored.
 * Only blocks while the user is typing in a field or actively capturing a new shortcut —
 * not when dialogs are open or the Settings screen is visible.
 */
export function shouldIgnoreGlobalHotkeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(target.closest('[data-hotkey-capture="true"]'));
}
