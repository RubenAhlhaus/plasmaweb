import {
  findGlobalHotkeyConflict,
  type HotkeyConflict,
  type OverridePresetKind,
  type OverridePresetPosition,
} from '@/lib/overridePresetHotkeys';
import { persistOverridePresetHotkey } from '@/lib/overridePresetHotkeysStorage';
import { persistShowVirtualSidebar } from '@/lib/uiPreferencesStorage';
import type { VirtualSidebarButtonId, VirtualSidebarHotkey } from '@/lib/virtualSidebarHotkeys';
import { persistVirtualSidebarHotkey } from '@/lib/virtualSidebarHotkeysStorage';
import {
  saveKioskModePreference,
  saveLinuxCncAutostartPreference,
  saveReloadToolOnStartupPreference,
} from '@/lib/userPreferencesApi';
import { useAppStore } from '@/store';

/** Updates store and persists the user's virtual sidebar preference. */
export function setShowVirtualSidebarPreference(show: boolean): void {
  useAppStore.getState().setShowVirtualSidebar(show);
  persistShowVirtualSidebar(show);
}

export type SetHotkeyPreferenceResult = {
  ok: boolean;
  conflict: HotkeyConflict | null;
};

function currentHotkeyMaps() {
  const state = useAppStore.getState();
  return {
    virtualSidebar: state.virtualSidebarHotkeys,
    feed: state.feedOverrideHotkeys,
    spindle: state.spindleOverrideHotkeys,
  };
}

/** Updates store and persists a hotkey for one virtual sidebar button. */
export function setVirtualSidebarHotkeyPreference(
  buttonId: VirtualSidebarButtonId,
  hotkey: VirtualSidebarHotkey | null,
): SetHotkeyPreferenceResult {
  const maps = currentHotkeyMaps();
  const conflict = findGlobalHotkeyConflict(hotkey, maps, {
    scope: 'virtualSidebar',
    buttonId,
  });
  if (conflict) {
    return { ok: false, conflict };
  }

  const next = persistVirtualSidebarHotkey(buttonId, hotkey, maps.virtualSidebar);
  useAppStore.setState({ virtualSidebarHotkeys: next });
  return { ok: true, conflict: null };
}

/** Updates store and persists a feed or spindle override preset hotkey. */
export function setOverridePresetHotkeyPreference(
  kind: OverridePresetKind,
  position: OverridePresetPosition,
  hotkey: VirtualSidebarHotkey | null,
): SetHotkeyPreferenceResult {
  const maps = currentHotkeyMaps();
  const conflict = findGlobalHotkeyConflict(hotkey, maps, { scope: kind, position });
  if (conflict) {
    return { ok: false, conflict };
  }

  const current = maps[kind];
  const next = persistOverridePresetHotkey(kind, position, hotkey, current);
  if (kind === 'feed') {
    useAppStore.setState({ feedOverrideHotkeys: next });
  } else {
    useAppStore.setState({ spindleOverrideHotkeys: next });
  }
  return { ok: true, conflict: null };
}

/** Updates store and persists kiosk vs windowed launch preference (effective after restart). */
export async function setKioskModePreference(kioskMode: boolean): Promise<boolean> {
  const ok = await saveKioskModePreference(kioskMode);
  if (ok) {
    useAppStore.getState().setKioskMode(kioskMode);
  }
  return ok;
}

/** Updates store and persists LinuxCNC autostart at graphical login. */
export async function setLinuxCncAutostartPreference(
  runLinuxCncAtStartup: boolean,
): Promise<{ ok: boolean; code?: string; message?: string }> {
  const result = await saveLinuxCncAutostartPreference(runLinuxCncAtStartup);
  if (result.ok) {
    const store = useAppStore.getState();
    store.setRunLinuxCncAtStartup(runLinuxCncAtStartup);
    store.setLinuxCncIniPath(result.linuxCncIniPath);
  }
  return result;
}

/** Updates store and persists reload-last-tool-after-homing toggle. */
export async function setReloadToolOnStartupPreference(
  reloadToolOnStartup: boolean,
): Promise<boolean> {
  const ok = await saveReloadToolOnStartupPreference(reloadToolOnStartup);
  if (ok) {
    useAppStore.getState().setReloadToolOnStartup(reloadToolOnStartup);
  }
  return ok;
}
