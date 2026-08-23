# 15_PANEL_HAL_INPUTS

## Description

External physical panels can trigger **all virtual sidebar actions** via **HAL input pins**. A rising edge on a debounced trigger pin executes the same action as clicking the matching sidebar button or pressing its keyboard shortcut. Optional **status output pins** drive panel LEDs (machine on, E-stop, paused, flood).

Reference HAL snippets:

- Panel only: [`resources/linuxcnc-config/lcncgui-panel.hal`](../../resources/linuxcnc-config/lcncgui-panel.hal)
- Panel + softkeys: [`resources/linuxcnc-config/lcncgui-panel-and-softkeys.hal`](../../resources/linuxcnc-config/lcncgui-panel-and-softkeys.hal) (single `loadrt dbounce`)

Without loading a panel HAL file, plasmaweb behaves as before (GUI + hotkeys only). Panel HAL polling is **disabled by default**; enable after sourcing the HAL file (see [Preconditions](#preconditions)).

## HAL pins (user-facing)

### Trigger inputs

Wire physical buttons **to** the debounced `*.in` pins (plasmaweb polls the matching `*.out`):

| HAL trigger pin (`.in`) | Sidebar action |
|-------------------------|----------------|
| `lcncgui-panel-machine-toggle.in` | Machine ON/OFF (button 1) |
| `lcncgui-panel-homing.in` | Open homing dialog (button 2) |
| `lcncgui-panel-cycle-start.in` | Cycle start (button 3) |
| `lcncgui-panel-estop.in` | E-Stop toggle (button 4) |
| `lcncgui-panel-axis-x.in` | Open X coordinate dialog (button 5) |
| `lcncgui-panel-axis-y.in` | Open Y coordinate dialog (button 6) |
| `lcncgui-panel-axis-z.in` | Open Z coordinate dialog (button 7) |
| `lcncgui-panel-flood.in` | Flood coolant toggle (button 9) |
| `lcncgui-panel-spindle-reverse.in` | Spindle left (button 10) |
| `lcncgui-panel-spindle-stop.in` | Spindle stop (button 11) |
| `lcncgui-panel-spindle-forward.in` | Spindle right (button 12) |
| `lcncgui-panel-program-pause.in` | Program pause/resume (button 14) |
| `lcncgui-panel-program-stop.in` | Program stop (button 15) |
| `lcncgui-panel-softkey-14.in` | HAL softkey pulse 14 (button 8) |
| `lcncgui-panel-softkey-15.in` | HAL softkey pulse 15 (button 13) |
| `lcncgui-panel-softkey-16.in` | HAL softkey pulse 16 (button 16) |

**Behaviour:** rising edge (FALSE → TRUE on debounced output) = one button press. Holding the button does not repeat.

### Status outputs (optional LEDs)

plasmaweb updates these `constant.value` parameters (~1 s); wire `*.out` to panel LEDs:

| HAL status pin (`.out`) | Meaning while TRUE |
|-------------------------|-------------------|
| `lcncgui-panel-status-machine-on.out` | Machine ON |
| `lcncgui-panel-status-estop.out` | E-Stop active |
| `lcncgui-panel-status-paused.out` | Program interpreter paused |
| `lcncgui-panel-status-flood.out` | Flood coolant on |

## UI Interaction

- **Physical panel button** → HAL `*.in` → plasmaweb backend poller → action (same as sidebar).
- **GUI connected (normal case):** all panel triggers broadcast `panel.sidebar.trigger`; frontend runs `dispatchVirtualSidebarButton(id, 'hal')` — identical to sidebar/hotkey (including cycle start with `pendingAutoRunStartLine`).
- **No GUI client:** machine/program actions run in the backend only; dialog buttons (2, 5–7) are ignored.
- **Homing / coordinate dialogs (buttons 2, 5–7):** require GUI WebSocket (via `panel.sidebar.trigger` as above).
- **Virtual sidebar / hotkeys:** unchanged; can be hidden (`showVirtualSidebar: false`).

## Preconditions

- LinuxCNC running with `lcncgui-panel.hal` sourced from a **HALFILE** (panel only), **or** `lcncgui-panel-and-softkeys.hal` when you also need softkey pulse/feedback pins. Do **not** load these via `POSTGUI_HALFILE`.
- Do **not** source `lcncgui-panel.hal` and `lcncgui-softkeys.hal` together — both call `loadrt dbounce`, and LinuxCNC allows only one `loadrt` per component. Use the combined snippet instead.
- Panel polling enabled: `export PLASMAWEB_PANEL_HAL_ENABLED=1` (default is **off**, like tool-change HAL).
- `halcmd` available in the LinuxCNC session.
- For **machine/program actions:** LinuxCNC gateway reachable (works without GUI).
- For **dialog actions (2, 5–7):** GUI WebSocket connected.
- For **HAL softkeys 14–16 via panel pins:** load [`lcncgui-panel-and-softkeys.hal`](../../resources/linuxcnc-config/lcncgui-panel-and-softkeys.hal) from a HALFILE (not the two separate files).

## Event order

### Machine / program action (GUI connected)

1. Rising edge on debounced trigger pin.
2. Backend `PanelHalPublisher` → `panel.sidebar.trigger` with `{ buttonId }`.
3. Frontend `dispatchVirtualSidebarButton` → event bus → bridge hooks → WebSocket command.
4. Status snapshot / optional status HAL outputs updated.

### Machine / program action (no GUI — headless fallback)

1. Rising edge on debounced trigger pin.
2. Backend `PanelHalPublisher` → `dispatch_machine_sidebar_button` (direct gateway).
3. Cycle start uses `startLine: 0` (no program editor state). Errors are logged server-side.

### UI dialog action (e.g. Homing)

1. Rising edge on `lcncgui-panel-homing.in`.
2. Backend broadcasts `machine_event` → `panel.sidebar.trigger` with `{ buttonId: 2 }`.
3. Frontend `useBackendWebSocket` → `dispatchVirtualSidebarButton(2, 'hal')`.
4. Event bus → `ui.homing.openDialog` → `HomingDialog` opens.

## User feedback

- **Machine/program:** same as sidebar (status stream, header, button highlights).
- **Dialogs:** same modals as sidebar/hotkey.
- **Status LEDs:** follow HAL status output pins when wired.
- **HAL read errors:** ignored for that pin until readable again (no toast).

## Edge cases

- **HAL file not loaded:** pins unreadable → no triggers; GUI unchanged.
- **Dialog action without GUI connected:** trigger ignored (no WebSocket client).
- **Button held:** debounce + edge detection → single action per press cycle.
- **Reconnect after disconnect:** UI trigger edge reset (same pattern as tool-change HAL).
- **Machine OFF:** flood toggle ignored (same as sidebar).
- **E-Stop active:** machine toggle no-op (same as sidebar).

## Errors

Panel HAL triggers do not return `command_result` to the user. Failed LinuxCNC commands behave like direct gateway calls (logged server-side). HAL softkey pulses may fail if softkey oneshot pins are not loaded (`lcncgui-softkeys.hal` or `lcncgui-panel-and-softkeys.hal`) — see [`13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md`](13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md).

Disable panel polling (default):

```bash
export PLASMAWEB_PANEL_HAL_ENABLED=0
```

Enable after loading `lcncgui-panel.hal`:

```bash
export PLASMAWEB_PANEL_HAL_ENABLED=1
```

Override a trigger pin (advanced):

```bash
export PLASMAWEB_PANEL_HAL_ESTOP_PIN='my-panel.estop-out'
```

## HAL wiring example

Panel only:

```hal
source /opt/plasmaweb/resources/linuxcnc-config/lcncgui-panel.hal
```

Panel **and** softkeys 14–16 (required for panel softkey trigger pins that pulse `lcncgui-sk-*.out`):

```hal
source /opt/plasmaweb/resources/linuxcnc-config/lcncgui-panel-and-softkeys.hal
```

Do **not** source `lcncgui-panel.hal` and `lcncgui-softkeys.hal` in the same config.

```hal
net estop-key   parport.0.pin-12-in => lcncgui-panel-estop.in
net start-key   parport.0.pin-11-in => lcncgui-panel-cycle-start.in
net homing-key  parport.0.pin-10-in => lcncgui-panel-homing.in

net led-on      lcncgui-panel-status-machine-on.out => parport.0.pin-01-out
net led-estop   lcncgui-panel-status-estop.out      => parport.0.pin-02-out
```

## Related Features

- [`09_VIRTUAL_SIDEBAR_HOTKEYS.md`](09_VIRTUAL_SIDEBAR_HOTKEYS.md) — keyboard alternative without HAL
- [`13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md`](13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md) — custom HAL softkeys 14–16 (pulse + feedback)
- [`03_MACHINE_ESTOP.md`](03_MACHINE_ESTOP.md), [`04_MACHINE_ON_OFF.md`](04_MACHINE_ON_OFF.md)
