# 10_VIRTUAL_SIDEBAR_COOLANT

## Description

Flood coolant (Flutkühlung, LinuxCNC `command.flood`, G-code M8/M9) can be toggled from the virtual left sidebar. Behavior matches gmoccapy’s flood coolant toggle button (`on_tbtn_flood_toggled`): one click turns flood on, another turns it off. The UI button reflects `stat.flood` from the `linuxcnc_status` stream.

The softkey label is **Flutkühlung** / **Flood coolant** (`components.json` → `virtualSidebar.coolant`). The frontend event is **`ui.flood.toggle`** (flood only; mist is out of scope for this feature).

Clicks and configured **hotkeys** both go through `useVirtualSidebarActions` → `ui.flood.toggle` (source `virtualSidebar` or `hotkey`).

## Where is flood coolant toggled?

- **Virtual sidebar, softkey 9 (flood coolant)**  
  When the virtual left sidebar is visible (`showVirtualSidebar`), a click on the ninth softkey fires `ui.flood.toggle` with `source: 'virtualSidebar'`. Automation hook: `data-e2e="virtual-sidebar-coolant"`.
- **Hotkey** (Settings → virtual sidebar hotkeys): same event with `source: 'hotkey'`.

## UI Interaction

- The user clicks softkey 9 while the machine is ON.
- One click turns flood coolant on if it is off; another click turns it off.
- The button is highlighted green when `io.flood !== 0` in the status snapshot.
- The button is disabled when the machine is not ON (`task_state !== STATE_ON`).

## Preconditions

- WebSocket connection to the backend is established.
- Machine task state is **`STATE_ON`** (same as gmoccapy / gateway `set_flood` — backend rejects with `machine_not_on` otherwise).
- E-stop must not be active for normal machine operation (see related features).

## Event order

- User clicks softkey 9 or presses the configured hotkey.
- `useVirtualSidebarActions` publishes `eventBus.publish('ui.flood.toggle', { source: … })`.
- `useMachineEventBridge` subscribes to `ui.flood.toggle`:
  - Reads `linuxCncStatus.machine.task_state`; if not `STATE_ON`, sends no command.
  - Reads `linuxCncStatus.io.flood`; sends `sendCommand('machine', 'flood', { on: !floodOn })`.
- Backend: `handle_machine_flood` → gateway `set_flood` → `linuxcnc.command.flood(FLOOD_ON|FLOOD_OFF)`.
- Updated flood state appears in `linuxcnc_status` (`io.flood`); the sidebar active state updates from the store.

## User feedback

- Active flood: softkey 9 highlighted green (`data-active="true"`).
- Inactive flood: default button styling (`data-active="false"`).
- Machine not ON: softkey 9 disabled.
- Backend error (e.g. `command_in_progress`, `linuxcnc_unavailable`): global error toast via `useBackendWebSocket`.
- Idempotent toggle (already in target state): backend may return `ok: true` without `machine.flood.changed` event; UI still follows the status stream.

## Edge cases

- **WebSocket not connected**: no command sent.
- **Program sets M8/M9**: status stream updates `io.flood`; sidebar highlight follows without a local optimistic state.
- **Hotkey while machine OFF**: bridge sends no command (same guard as click).

## Errors

- `machine_not_on`: machine must be turned on first (softkey 1).
- `command_in_progress`: another LinuxCNC command is running; retry after completion.
- `linuxcnc_unavailable`: backend has no LinuxCNC connection.

## Related Features

- 04_MACHINE_ON_OFF (machine must be ON; flood softkey disabled until then)
- 03_MACHINE_ESTOP (E-stop blocks normal operation)
- 05_TOOL_TABLE (tool preset coolant type is separate from manual flood toggle)
