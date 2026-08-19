import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '@/store';
import {
  setOverridePresetHotkeyPreference,
  setShowVirtualSidebarPreference,
  setVirtualSidebarHotkeyPreference,
} from '../uiPreferences';
import {
  readStoredShowVirtualSidebar,
  persistShowVirtualSidebar,
  SHOW_VIRTUAL_SIDEBAR_STORAGE_KEY,
} from '../uiPreferencesStorage';
import {
  readStoredOverridePresetHotkeys,
  FEED_OVERRIDE_HOTKEYS_STORAGE_KEY,
} from '../overridePresetHotkeysStorage';
import {
  readStoredVirtualSidebarHotkeys,
  VIRTUAL_SIDEBAR_HOTKEYS_STORAGE_KEY,
} from '../virtualSidebarHotkeysStorage';
import {
  findButtonIdForHotkey,
  formatHotkey,
  hotkeyFromKeyboardEvent,
  hotkeysEqual,
  parseVirtualSidebarHotkeysMap,
} from '../virtualSidebarHotkeys';

describe('virtualSidebarHotkeys', () => {
  it('hotkeyFromKeyboardEvent builds modifier combinations', () => {
    const event = {
      key: 'F1',
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      metaKey: false,
    } as KeyboardEvent;

    expect(hotkeyFromKeyboardEvent(event)).toEqual({
      key: 'F1',
      ctrl: true,
      shift: true,
    });
  });

  it('hotkeyFromKeyboardEvent ignores modifier-only presses', () => {
    const event = { key: 'Control', ctrlKey: true } as KeyboardEvent;
    expect(hotkeyFromKeyboardEvent(event)).toBeNull();
  });

  it('formatHotkey renders readable labels', () => {
    expect(formatHotkey({ key: 'F1', ctrl: true, shift: true })).toBe('Ctrl+Shift+F1');
    expect(formatHotkey({ key: ' ' })).toBe('Space');
  });

  it('parseVirtualSidebarHotkeysMap ignores invalid entries', () => {
    expect(
      parseVirtualSidebarHotkeysMap({
        '1': { key: 'F1' },
        '99': { key: 'F2' },
        '2': { nope: true },
        three: { key: 'F3' },
      }),
    ).toEqual({ 1: { key: 'F1' } });
  });

  it('findButtonIdForHotkey returns the matching button', () => {
    const map = {
      1: { key: 'F1' },
      4: { key: 'F4', ctrl: true },
    };
    expect(findButtonIdForHotkey(map, { key: 'F4', ctrl: true })).toBe(4);
    expect(findButtonIdForHotkey(map, { key: 'F4' })).toBeNull();
  });

  it('hotkeysEqual compares modifiers', () => {
    expect(hotkeysEqual({ key: 'a', ctrl: true }, { key: 'a', ctrl: true })).toBe(true);
    expect(hotkeysEqual({ key: 'a', ctrl: true }, { key: 'a' })).toBe(false);
  });
});

describe('virtualSidebarHotkeysStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('readStoredVirtualSidebarHotkeys returns empty map when unset', () => {
    expect(readStoredVirtualSidebarHotkeys()).toEqual({});
  });

  it('rejects duplicate hotkeys', () => {
    useAppStore.setState({
      virtualSidebarHotkeys: { 1: { key: 'F1' } },
      feedOverrideHotkeys: {},
      spindleOverrideHotkeys: {},
    });
    const result = setVirtualSidebarHotkeyPreference(2, { key: 'F1' });
    expect(result.ok).toBe(false);
    expect(result.conflict).toEqual({ scope: 'virtualSidebar', buttonId: 1 });
    expect(useAppStore.getState().virtualSidebarHotkeys[2]).toBeUndefined();
  });

  it('rejects duplicates against override preset hotkeys', () => {
    useAppStore.setState({
      virtualSidebarHotkeys: {},
      feedOverrideHotkeys: { 8: { key: 'F8' } },
      spindleOverrideHotkeys: {},
    });
    const result = setVirtualSidebarHotkeyPreference(1, { key: 'F8' });
    expect(result.ok).toBe(false);
    expect(result.conflict).toEqual({ scope: 'feed', position: 8 });
  });

  it('persists hotkeys via setVirtualSidebarHotkeyPreference', () => {
    useAppStore.setState({
      virtualSidebarHotkeys: {},
      feedOverrideHotkeys: {},
      spindleOverrideHotkeys: {},
    });
    const result = setVirtualSidebarHotkeyPreference(3, { key: 'F3', ctrl: true });
    expect(result.ok).toBe(true);
    expect(useAppStore.getState().virtualSidebarHotkeys[3]).toEqual({ key: 'F3', ctrl: true });
    expect(readStoredVirtualSidebarHotkeys()[3]).toEqual({ key: 'F3', ctrl: true });
  });

  it('clears hotkeys from storage', () => {
    window.localStorage.setItem(
      VIRTUAL_SIDEBAR_HOTKEYS_STORAGE_KEY,
      JSON.stringify({ 5: { key: 'x' } }),
    );
    useAppStore.setState({
      virtualSidebarHotkeys: { 5: { key: 'x' } },
      feedOverrideHotkeys: {},
      spindleOverrideHotkeys: {},
    });
    setVirtualSidebarHotkeyPreference(5, null);
    expect(useAppStore.getState().virtualSidebarHotkeys[5]).toBeUndefined();
    expect(readStoredVirtualSidebarHotkeys()).toEqual({});
  });
});

describe('overridePresetHotkeysStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAppStore.setState({
      virtualSidebarHotkeys: {},
      feedOverrideHotkeys: {},
      spindleOverrideHotkeys: {},
    });
  });

  it('persists feed override preset hotkeys', () => {
    const result = setOverridePresetHotkeyPreference('feed', 8, { key: 'q' });
    expect(result.ok).toBe(true);
    expect(useAppStore.getState().feedOverrideHotkeys[8]).toEqual({ key: 'q' });
    expect(readStoredOverridePresetHotkeys('feed')[8]).toEqual({ key: 'q' });
    expect(window.localStorage.getItem(FEED_OVERRIDE_HOTKEYS_STORAGE_KEY)).toContain('"8"');
  });

  it('persists spindle override preset hotkeys', () => {
    const result = setOverridePresetHotkeyPreference('spindle', 11, {
      key: 'w',
      shift: true,
    });
    expect(result.ok).toBe(true);
    expect(useAppStore.getState().spindleOverrideHotkeys[11]).toEqual({
      key: 'w',
      shift: true,
    });
    expect(readStoredOverridePresetHotkeys('spindle')[11]).toEqual({
      key: 'w',
      shift: true,
    });
  });
});

describe('uiPreferencesStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('readStoredShowVirtualSidebar returns null when unset', () => {
    expect(readStoredShowVirtualSidebar()).toBeNull();
  });

  it('persistShowVirtualSidebar stores boolean as string', () => {
    persistShowVirtualSidebar(false);
    expect(window.localStorage.getItem(SHOW_VIRTUAL_SIDEBAR_STORAGE_KEY)).toBe('false');
    expect(readStoredShowVirtualSidebar()).toBe(false);

    persistShowVirtualSidebar(true);
    expect(readStoredShowVirtualSidebar()).toBe(true);
  });

  it('readStoredShowVirtualSidebar ignores invalid values', () => {
    window.localStorage.setItem(SHOW_VIRTUAL_SIDEBAR_STORAGE_KEY, 'maybe');
    expect(readStoredShowVirtualSidebar()).toBeNull();
  });
});

describe('setShowVirtualSidebarPreference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAppStore.setState({ showVirtualSidebar: true });
  });

  it('updates store and localStorage', () => {
    setShowVirtualSidebarPreference(false);
    expect(useAppStore.getState().showVirtualSidebar).toBe(false);
    expect(readStoredShowVirtualSidebar()).toBe(false);

    setShowVirtualSidebarPreference(true);
    expect(useAppStore.getState().showVirtualSidebar).toBe(true);
    expect(readStoredShowVirtualSidebar()).toBe(true);
  });
});
