# 13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS

## Description

Three virtual sidebar softkeys at the **bottom** of the column are user-configurable via **HAL**. They are labeled **14**, **15**, and **16**. On click (or hotkey), lcncgui sends a short **pulse** on a HAL output pin; the operator wires that to machine logic (lubrication, mist, relays, etc.). Optionally, an **active feedback** input pin drives the green button highlight while the function is on.

Reference HAL snippet: [`resources/linuxcnc-config/lcncgui-softkeys.hal`](../../resources/linuxcnc-config/lcncgui-softkeys.hal).

## HAL pins (user-facing)

Per softkey **14** / **15** / **16**:

| Pin | Direction | Purpose |
|-----|-----------|---------|
| `lcncgui-sk-14.out` | lcncgui → machine | **Pulse** on button press (~0,1 s). Wire to your trigger logic. |
| `lcncgui-sk-14-fb.in` | machine → lcncgui | **Active state**. Wire your “is on” signal here; button **14** glows green while TRUE. |

(Slots 15 and 16: `lcncgui-sk-15.out` / `lcncgui-sk-15-fb.in`, `lcncgui-sk-16.out` / `lcncgui-sk-16-fb.in`.)

lcncgui polls the debounced feedback outputs internally; you only wire **`…-fb.in`**.

## UI Interaction

- **Virtual sidebar, bottom three buttons** (labels **14**, **15**, **16**)
  - Click → `hal.softkey_pulse` → pulse on `*.out`.
  - Green highlight when `io.hal_softkeys["14"|"15"|"16"] === 1` in the status stream (missing key = unreadable/off).
  - Automation: `data-e2e="virtual-sidebar-hal-softkey-14"` (and `-15`, `-16`).
- **Keyboard shortcut (Settings → virtual sidebar hotkeys)**
  - Hotkeys use internal button ids 8 / 13 / 16; settings rows show labels **14** / **15** / **16**. See [`09_VIRTUAL_SIDEBAR_HOTKEYS.md`](09_VIRTUAL_SIDEBAR_HOTKEYS.md).

## Preconditions

- WebSocket connected; `halcmd` available in the LinuxCNC session.
- HAL snippet sourced from a **HALFILE** (`source …/lcncgui-softkeys.hal`), **or** the combined panel+softkeys snippet (`lcncgui-panel-and-softkeys.hal`) when using panel pins as well. Do **not** load these via `POSTGUI_HALFILE` — `loadrt` belongs in the main HAL phase so pins like `lcncgui-sk-14.in` exist before the GUI runs.
- Do **not** source `lcncgui-softkeys.hal` and `lcncgui-panel.hal` together — both call `loadrt dbounce`, and LinuxCNC allows only one `loadrt` per component.
- For button highlight: feedback pin wired (`…-fb.in`).

## Event order

- Click or hotkey → `hal.softkey_pulse` → pulse on `lcncgui-sk-XX.out`.
- Status publisher (~1 s) reads `lcncgui-sk-XX-fb.out` via `halcmd getp` → `linuxcnc_status.io.hal_softkeys`.
- Sidebar updates green state from the store.

## User feedback

- **Pulse:** no persistent UI change unless feedback is wired.
- **Active:** green highlight (same style as flood/spindle) while feedback pin is TRUE.
- **HAL / pulse error:** global error toast.

## Edge cases

- **No feedback wired:** button works; never highlights (key absent or `0`).
- **Feedback pin missing / unreadable:** key omitted in `hal_softkeys` → UI treats as inactive.
- **Machine OFF / ESTOP:** pulse still sent; highlight follows feedback only.

## Errors

| `error.code` | Meaning |
|--------------|---------|
| `invalid_params` | `slot` not 14, 15, or 16 |
| `hal_softkey_pin_not_configured` | No trigger pin configured for the slot |
| `halcmd_unavailable` | `halcmd` not in PATH |
| `empty_hal_pin` | Internal trigger pin name empty |
| `hal_set_failed` | `halcmd setp` subprocess error (timeout, OSError, …) |
| `hal_set_nonzero` | `halcmd setp` failed (oneshot not loaded / loaded only in postgui, wrong pin, …) |

Override pins (advanced):

```bash
export LCNCGUI_HAL_SOFTKEY_14_PIN='mycomp.softkey-14-trigger-in'
export LCNCGUI_HAL_SOFTKEY_14_FB_PIN='mycomp.lube-active'
```

## HAL wiring example

```hal
source /opt/lcncgui/resources/linuxcnc-config/lcncgui-softkeys.hal

net lube-pulse  lcncgui-sk-14.out => mycomp.lube-trigger
net lube-active mycomp.lube-on     => lcncgui-sk-14-fb.in
```

## Related Features

- 09_VIRTUAL_SIDEBAR_HOTKEYS
- 10_VIRTUAL_SIDEBAR_COOLANT (similar green highlight via status stream)
- 12_HAL_TOOLS_SETTINGS
- [`15_PANEL_HAL_INPUTS.md`](15_PANEL_HAL_INPUTS.md) — use `lcncgui-panel-and-softkeys.hal` when combining with panel pins
