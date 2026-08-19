# 04_MACHINE_ON_OFF

## Description

Machine on/off (task state ON/OFF) can be toggled. One click turns the machine on (`STATE_ON`), another turns it off (`STATE_OFF`). Behavior is independent of the concrete UI element: every entry point publishes the same frontend event `ui.machine.toggle`; a central hook (`useMachineEventBridge`) translates that into the backend command `machine.set_task_state` and sends it over WebSocket. The backend uses the LinuxCNC or mock library to set task state.

## Where is machine ON/OFF toggled?

- **Virtual sidebar, softkey 1 (machine power on/off)**  
  When the virtual left sidebar is visible (`showVirtualSidebar`), a click on the first softkey fires `ui.machine.toggle` with `source: 'virtualSidebar'`. The two-line label is translated via `components.json` → `virtualSidebar.machineLine1` / `machineLine2` (locale-dependent).
- **Keyboard shortcut (Settings → virtual sidebar hotkeys)**  
  The same event with `source: 'hotkey'` when the configured shortcut for softkey 1 is pressed (works globally, including with dialogs open). See [`09_VIRTUAL_SIDEBAR_HOTKEYS.md`](09_VIRTUAL_SIDEBAR_HOTKEYS.md).
- **Further entry points (planned/optional)**  
  Other buttons (e.g. in HeaderBar) can use the same behavior with `eventBus.publish('ui.machine.toggle', { source: 'header' })`. Toggle logic and command sending stay centralized in `useMachineEventBridge`.

## UI Interaction

- The user uses one of the entry points (currently: virtual sidebar softkey 1 — machine on/off).
- One click turns the machine on if it is off or in `ESTOP_RESET`; another click turns it off.
- Current on/off state is shown in the HeaderBar and affects other functions (e.g. jog buttons). Additionally, softkey 1 in the virtual sidebar has its own active state: for `STATE_ON` the button is highlighted green.

## Preconditions

- WebSocket connection to the backend is established (`connectionStatus === "connected"`) so the command can be sent and status updated.
- **Turning on**: The machine must not be in `STATE_ESTOP`. With active E-stop, a click on machine ON/OFF has no effect; the user must release E-stop first (virtual sidebar softkey 4; label from `virtualSidebar.estop`).
- **Turning off**: No further preconditions; from any runnable state (e.g. `STATE_ON`) the machine can be turned off.

## Event order

- User uses a machine ON/OFF entry point (e.g. click softkey 1).
- The component publishes `eventBus.publish('ui.machine.toggle', { source: 'virtualSidebar' })` (or another `source` for other entry points).
- Hook `useMachineEventBridge` is subscribed to `ui.machine.toggle`:
  - Reads `linuxCncStatus.machine.task_state` from the store (frontend enum `TaskState` with numeric values as in `src/store/types.ts`).
  - For `STATE_ON` → sends `sendCommand('machine', 'set_task_state', { status: TaskState.STATE_OFF })` (JSON: numeric task state, e.g. `3`).
  - For `STATE_OFF` or `STATE_ESTOP_RESET` → sends `sendCommand('machine', 'set_task_state', { status: TaskState.STATE_ON })` (e.g. `4`). The backend also accepts the same values as equivalent strings (`STATE_OFF`, …), see `docs/commands-events.md`.
  - For `STATE_ESTOP` → sends no command (machine cannot be turned on from E-stop).
- Backend receives the command and sets task state via the gateway (`set_task_state`); updated state appears in the `linuxcnc_status` stream.
- Frontend updates the store via `useBackendWebSocket` and status mapping; HeaderBar, jog buttons, and other dependents react to the new `task_state`.

## User feedback

- HeaderBar and dependent controls (e.g. jog buttons) show whether the machine is on or off and whether it is operable. When the machine is on (`STATE_ON`), the HeaderBar shows the current **operating mode** (MDI, Manual, or Program) on the right instead of a plain “on” label; E-stop, machine off, **unhomed axes** (when connected), and connection status labels stay as before. While a program is actively interpreted in auto (`isProgramFileExecuting`), an additional badge appears next to the mode label: **“Program running…”** while reading/waiting, or **“Program paused…”** when `isProgramInterpreterPaused` is true.
- After toggle, status updates from the backend.
- With no WebSocket connection, no command is sent; there is currently no explicit error at the entry point.
- With active E-stop (`STATE_ESTOP`), a click on machine ON/OFF has no visible effect; the user must release E-stop first.

## Edge cases

- **WebSocket not connected**: command is not sent; click has no effect.
- **Fast double clicks**: two events may send two commands; the second depends on already updated state. Toggle behavior stays consistent (ON → OFF → ON …).
- **E-stop active**: click on machine ON/OFF does nothing; the bridge deliberately sends no command to mirror reference UI (`example.py`): turn on only after ESTOP release.

## Errors

- Backend rejects `set_task_state` (e.g. invalid parameter, internal error): response as **`command_result`** with `ok: false` and `error.code` / `error.message`. The frontend shows a **global error toast** (`useBackendWebSocket`).
- Turn-on fails on the backend side (e.g. limit switch): the status stream reflects actual state; the frontend shows continued off or failed state via normal status display.

## Related Features

- 01_JOG_HOME_SCREEN (jogging only with machine ON and no E-stop)
- 02_COORDINATES_DISPLAY (display; indirectly depends on task state)
- 03_MACHINE_ESTOP (E-stop may need to be released before machine ON/OFF can turn the machine on)
- 10_VIRTUAL_SIDEBAR_COOLANT (flood coolant softkey requires machine ON)
