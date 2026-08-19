# 03_MACHINE_ESTOP

## Description
Machine emergency stop (E-Stop) can be toggled on and off. One invocation sets the task state to E-stop (`STATE_ESTOP`), another sets it back (`STATE_ESTOP_RESET`). Behavior is independent of the concrete UI element: every entry point publishes the same frontend event `ui.estop.toggle`; a central hook translates that into the backend command `machine.set_task_state` and sends it over WebSocket.

## Where is E-stop toggled?
- **Virtual sidebar, softkey 4 (E-stop / emergency stop)**  
  When the virtual left sidebar is visible (`showVirtualSidebar`), a click on the fourth softkey fires `ui.estop.toggle` with `source: 'virtualSidebar'`. The visible label depends on locale (e.g. English `components.json` → `virtualSidebar.estop`, German → same key with translated text).
- **Keyboard shortcut (Settings → virtual sidebar hotkeys)**  
  The same event with `source: 'hotkey'` when the configured shortcut for softkey 4 is pressed (works globally, including with dialogs open). See [`09_VIRTUAL_SIDEBAR_HOTKEYS.md`](09_VIRTUAL_SIDEBAR_HOTKEYS.md).
- **Further entry points (planned/optional)**  
  Other buttons or controls (e.g. in HeaderBar, other screens, or hardware integration) can use the same behavior by calling `eventBus.publish('ui.estop.toggle', { source: '…' })`. Toggle logic and command sending stay centralized in `useMachineEventBridge`.

## UI Interaction
- The user uses one of the entry points (currently: softkey 4 — E-stop / emergency stop in the virtual sidebar).
- One click engages E-stop if it is not yet active; another click releases it.
- Current E-stop state is shown in the HeaderBar (e.g. “E-stop active”). Additionally, softkey 4 in the virtual sidebar has its own active state: when E-stop is active (task state `STATE_ESTOP` or `machine.error === true`), the button is highlighted red.

## Preconditions
- WebSocket connection to the backend is established (`connectionStatus === "connected"`) so the command can be sent and status updated.
- The central hook decides from the **status snapshot** in the store: `linuxCncStatus.machine.task_state` **and** the backend field **`linuxCncStatus.machine.error`** (derived from LinuxCNC `stat.estop`, see `docs/backend-frontend-messages.md` → `payload.machine.error`). If **software** E-stop is active (`task_state` = `STATE_ESTOP`) **or** **hardware** E-stop input is set (`error === true`), the machine counts as “in E-stop” and the next click sends **`STATE_ESTOP_RESET`**. Otherwise the hook sends **`STATE_ESTOP`**. Successful release requires LinuxCNC to accept the command (e.g. release hardware E-stop first); otherwise the backend returns `estop_reset_rejected` (see below).

## Event order
- User uses an E-stop entry point (e.g. click softkey 4).
- The component publishes `eventBus.publish('ui.estop.toggle', { source: 'virtualSidebar' })` (or another `source` for other entry points).
- Hook `useMachineEventBridge` is subscribed to `ui.estop.toggle`:
  - Reads `linuxCncStatus.machine.task_state` and `linuxCncStatus.machine.error` from the store.
  - If `task_state === STATE_ESTOP` **or** `error === true` (hardware E-stop per snapshot) → sends `sendCommand('machine', 'set_task_state', { status: … })` with **`STATE_ESTOP_RESET`** (numeric `2` or equivalent string).
  - Else (e.g. `STATE_ON`, `STATE_OFF`, `STATE_ESTOP_RESET` and no hardware E-stop) → sends **`STATE_ESTOP`**.
- Backend receives the command and sets task state via the gateway (`set_task_state`); updated state appears in the `linuxcnc_status` stream.
- Frontend updates the store via `useBackendWebSocket` and status mapping; HeaderBar and other dependents (e.g. jogging) react to the new `task_state`.

## User feedback
- HeaderBar shows whether E-stop is active (e.g. “E-stop active”), including when `task_state` is E-stop **or** `machine.error` is set (hardware E-stop).
- After toggle, status updates from the backend; other functions (e.g. jog buttons) enable or disable accordingly.
- With no WebSocket connection, no command is sent; there is currently no explicit error at the entry point.

## Edge cases
- **WebSocket not connected**: command is not sent; click has no effect.
- **Fast double clicks**: two events in a row may send two commands; the second depends on already updated state. Toggle behavior stays consistent (engage → reset → engage …).

## Errors
- Invalid parameters: response as usual **`command_result`** with `ok: false` (e.g. `invalid_params`).
- **E-stop reset not accepted:** `command_result` with `ok: false` and `error.code` = **`estop_reset_rejected`**, when after the command the snapshot still reports `task_state` = `STATE_ESTOP` despite a short verification window with several re-polls (currently up to ~250 ms) (see `docs/commands-events.md` → `machine.set_task_state`). No successful `machine_event` for this action in that case.

## Related Features
- 01_JOG_HOME_SCREEN (jogging not possible with active E-stop)
- 02_COORDINATES_DISPLAY (display; indirectly depends on task state)
- Virtual sidebar machine ON/OFF (softkey 1) is separate; with active ESTOP, E-stop must be released before the machine can be turned on again.
