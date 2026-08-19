import type { VirtualSidebarButtonId } from '@/lib/virtualSidebarHotkeys';

/** User-visible / API HAL softkey slot numbers (14, 15, 16). */
export type HalSoftkeySlotNumber = 14 | 15 | 16;

/** String keys in ``linuxcnc_status.io.hal_softkeys``. */
export type HalSoftkeyStatusKey = '14' | '15' | '16';

/** Internal sidebar button ids for the three HAL softkeys (legacy slot positions). */
export const VIRTUAL_SIDEBAR_HAL_SOFTKEY_IDS: readonly VirtualSidebarButtonId[] = [
  8, 13, 16,
] as const;

export type VirtualSidebarHalSoftkeyButtonId = (typeof VIRTUAL_SIDEBAR_HAL_SOFTKEY_IDS)[number];

/** Maps internal button id → displayed / API / HAL slot number (14, 15, 16).
 *  Keep in sync with ``HAL_SOFTKEY_SLOT_BY_SIDEBAR_BUTTON`` in ``backend/panel/constants.py``. */
export const HAL_SOFTKEY_DISPLAY_SLOT_BY_BUTTON_ID: Readonly<
  Record<VirtualSidebarHalSoftkeyButtonId, HalSoftkeySlotNumber>
> = {
  8: 14,
  13: 15,
  16: 16,
};

export function halSoftkeyDisplaySlotForButton(
  buttonId: VirtualSidebarHalSoftkeyButtonId,
): HalSoftkeySlotNumber {
  return HAL_SOFTKEY_DISPLAY_SLOT_BY_BUTTON_ID[buttonId];
}

export function halSoftkeyStatusKey(slot: HalSoftkeySlotNumber): HalSoftkeyStatusKey {
  return String(slot) as HalSoftkeyStatusKey;
}

export function isHalSoftkeyButtonId(
  buttonId: VirtualSidebarButtonId,
): buttonId is VirtualSidebarHalSoftkeyButtonId {
  return (VIRTUAL_SIDEBAR_HAL_SOFTKEY_IDS as readonly number[]).includes(buttonId);
}

export function isHalSoftkeyActive(
  halSoftkeys: Partial<Record<HalSoftkeyStatusKey, number>> | undefined,
  buttonId: VirtualSidebarHalSoftkeyButtonId,
): boolean {
  const key = halSoftkeyStatusKey(halSoftkeyDisplaySlotForButton(buttonId));
  return halSoftkeys?.[key] === 1;
}

/** Physical order: HAL softkeys (labels 14–16) at the end of the sidebar. */
export const VIRTUAL_SIDEBAR_BUTTON_ORDER: readonly VirtualSidebarButtonId[] = [
  1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 8, 13, 16,
];

/** All virtual sidebar button slot numbers (same set as {@link VIRTUAL_SIDEBAR_BUTTON_ORDER}). */
export const VIRTUAL_SIDEBAR_BUTTON_IDS: readonly VirtualSidebarButtonId[] =
  VIRTUAL_SIDEBAR_BUTTON_ORDER;

/** Buttons that trigger an action (includes HAL softkeys 8, 13, 16 → labels 14–16). */
export const VIRTUAL_SIDEBAR_ACTION_BUTTON_IDS = new Set<VirtualSidebarButtonId>([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
]);

export function dataE2eForVirtualSidebarButton(num: number): string | undefined {
  if (num === 2) return 'virtual-sidebar-home';
  if (num === 9) return 'virtual-sidebar-coolant';
  if (num === 10) return 'virtual-sidebar-spindle-left';
  if (num === 11) return 'virtual-sidebar-spindle-stop';
  if (num === 12) return 'virtual-sidebar-spindle-right';
  if (num === 3) return 'virtual-sidebar-cycle-start';
  if (num === 14) return 'virtual-sidebar-pause';
  if (num === 15) return 'virtual-sidebar-stop';
  if (num === 8) return 'virtual-sidebar-hal-softkey-14';
  if (num === 13) return 'virtual-sidebar-hal-softkey-15';
  if (num === 16) return 'virtual-sidebar-hal-softkey-16';
  return `virtual-sidebar-button-${num}`;
}

/** Returns the settings/sidebar label for one virtual sidebar button. */
export function getVirtualSidebarButtonLabel(
  buttonId: VirtualSidebarButtonId,
  t: (key: string) => string,
  labelKeyPrefix: string,
): string {
  const lk = (suffix: string) => t(`${labelKeyPrefix}${suffix}`);
  if (isHalSoftkeyButtonId(buttonId)) {
    return String(HAL_SOFTKEY_DISPLAY_SLOT_BY_BUTTON_ID[buttonId]);
  }
  switch (buttonId) {
    case 1:
      return `${lk('machineLine1')} ${lk('machineLine2')}`;
    case 2:
      return lk('home');
    case 3:
      return lk('cycleStart');
    case 4:
      return lk('estop');
    case 5:
      return 'X';
    case 6:
      return 'Y';
    case 7:
      return 'Z';
    case 9:
      return lk('coolant');
    case 10:
      return lk('spindleLeft');
    case 11:
      return lk('spindleStop');
    case 12:
      return lk('spindleRight');
    case 14:
      return lk('pause');
    case 15:
      return lk('stop');
    default:
      return String(buttonId);
  }
}
