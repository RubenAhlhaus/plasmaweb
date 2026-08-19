# 09_VIRTUAL_SIDEBAR_HOTKEYS

## Description

Each virtual sidebar softkey (slots 1–16) can be assigned a **keyboard shortcut** in **Settings → Virtual sidebar hotkeys**. Shortcuts are stored in browser **`localStorage`** under **`lcncgui.virtualSidebarHotkeys`** and trigger the **same actions** as clicking the corresponding softkey. They work **globally**: with the sidebar hidden, while **dialogs are open**, and on the **Settings screen** itself (unless focus is in a text field or a shortcut is being captured).

Implementation: shared action dispatch in [`dispatchVirtualSidebarButton`](../../src/lib/dispatchVirtualSidebarButton.ts) (via [`useVirtualSidebarActions`](../../src/hooks/useVirtualSidebarActions.ts)); global listener [`useGlobalHotkeyListener`](../../src/hooks/useGlobalHotkeyListener.ts) in `App.tsx` (also handles feed/spindle override presets — see [`18_OVERRIDE_PRESET_HOTKEYS.md`](18_OVERRIDE_PRESET_HOTKEYS.md)). Event-bus actions publish with `source: 'hotkey'` (see [`docs/frontend-eventbus-overview.md`](../frontend-eventbus-overview.md)).

**Alternative without keyboard:** external panel HAL trigger pins (same actions, `source: 'hal'`). See [`15_PANEL_HAL_INPUTS.md`](15_PANEL_HAL_INPUTS.md).

## UI Interaction

- Open **Settings** → group **Virtual sidebar hotkeys** (same button order as the physical sidebar).
- Click a shortcut field → **Press keys…** → press the desired key or combination (e.g. `Ctrl+Shift+F1`).
- **Backspace** / **Delete** while capturing clears the assignment; **Escape** cancels capture without saving.
- **Clear** removes an existing assignment.
- Duplicate combinations are rejected with an info toast (unique across sidebar **and** override-preset hotkeys).

Slots **8**, **13**, and **16** (sidebar labels **14**, **15**, **16**) are **HAL softkeys** at the bottom of the sidebar; shortcuts trigger the same `hal.softkey_pulse` action as a click. See [`13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md`](13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md).

## Preconditions

- Same as the underlying softkey action (typically WebSocket connected for machine commands).
- Shortcut is **not** fired while focus is in `INPUT` / `TEXTAREA` / `SELECT` / `contenteditable`, or while **capturing** a new shortcut (`data-hotkey-capture`).

## Event order

- User presses a configured shortcut.
- `useGlobalHotkeyListener` matches the key against `virtualSidebarHotkeys` in the store (feed/spindle override maps are checked only if no sidebar match).
- On a sidebar match, `useVirtualSidebarActions.executeButton(buttonId, 'hotkey')` runs the same branch as a sidebar click:
  - Event-bus actions: `ui.machine.toggle`, `ui.estop.toggle`, `ui.homing.openDialog`, `ui.program.*`, `ui.coordinates.openAxisDialog`, `ui.flood.toggle`, `ui.spindle.direction`, `ui.hal.softkey` with `source: 'hotkey'`.
  - `useMachineEventBridge` translates flood/spindle/HAL softkey events into WebSocket commands (same as sidebar clicks).

## User feedback

- Assigned shortcut shown in the settings field (localized modifier labels, e.g. **Strg** in German).
- Duplicate assignment: toast with the conflicting target name.
- Action feedback is identical to clicking the softkey (dialogs, HeaderBar, command results, etc.).

## Edge cases

- **Sidebar hidden:** shortcuts still work.
- **Dialog open:** shortcuts still work (e.g. cycle start while another dialog is visible).
- **Settings screen:** shortcuts work when focus is not in a text field.
- **Capture mode:** global shortcuts suppressed until capture finishes.
- **HAL softkeys (labels 14–16):** see [`13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md`](13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md).

## Errors

- Duplicate hotkey: not saved; info toast only.
- Underlying action errors (WebSocket, preconditions): same as softkey click (e.g. global error toast on failed `command_result`).

## Related Features

- 03_MACHINE_ESTOP (softkey 4 / hotkey)
- 04_MACHINE_ON_OFF (softkey 1 / hotkey)
- 06_PROGRAM_SCREEN (cycle start, pause, stop / hotkeys)
- 02_COORDINATES_DISPLAY (X/Y/Z axis dialogs / hotkeys)
- 10_VIRTUAL_SIDEBAR_COOLANT (softkey 9 / flood hotkey)
- 18_OVERRIDE_PRESET_HOTKEYS (feed/spindle rotary preset hotkeys; shared capture UX and global uniqueness)
