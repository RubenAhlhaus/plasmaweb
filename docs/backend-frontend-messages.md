# Backend → Frontend messages (WebSocket, message contract v1)

This document describes **only** messages that the backend **sends to the frontend** (WebSocket).

Sources for fields:
- Message contract: `backend/contracts/messages.py`
- Status snapshot: `backend/adapters/linuxcnc_gateway.py` (mapped from `linuxcnc.stat()`)
- Event/periodic stream: `backend/api/ws.py` + `backend/services/status_publisher.py`
- Additionally (no separate WebSocket event): **`MdiManualRevertPoller`** (`backend/services/mdi_manual_revert.py`) polls LinuxCNC with `MDI_MANUAL_REVERT_POLL_INTERVAL_S` (`backend/config.py`) and can affect `task_mode` in the snapshot (MDI or AUTO → manual when interpreter/motion are idle).
- Status and enum types (frontend): `src/store/types.ts`

Reference for `linuxcnc` field meanings: [LinuxCNC Python module](https://linuxcnc.org/docs/html/config/python-interface.html)

---

## Transport / basic structure

All messages are JSON objects with a `type` field. `protocolVersion` is currently always `1`.

Endpoint (backend side):
- `ws://.../ws` (path and port see `WEBSOCKET_PATH` / `PORT` in `backend/config.py`)

**Frontend:** The concrete WebSocket URL the GUI connects to does not come from source code but from `plasmaweb-config.json` (loaded from the same origin as the web app). Short flow and fields: [`docs/frontend-web-start.md`](frontend-web-start.md).

**Note (outgoing, frontend → backend):** `useSendCommand()` (`src/api/backendCommands.ts`) returns a **stably referenced** send function (`useCallback` with a fixed dependency list): on each actual send the WebSocket instance is read via `useAppStore.getState().backendWebSocket` so listeners and effects do not work with a stale socket reference. Effects that depend only on `sendCommand` (e.g. file browser with `program.list`) therefore do not re-fire on every render. Very large `command` payloads (especially `program.write` with long `content`) can also hit **proxy/WebSocket frame limits**; see [`docs/commands-events.md`](commands-events.md) → `program.write` → transport.

---

## Message type: `linuxcnc_status`

Direction: backend → frontend  
Usage: Initial on connect and then periodically as the status stream. Interval: `STATUS_POLL_INTERVAL_S` in `backend/config.py` (intentionally fairly short so interpreter modals such as `gcodes`/`mcodes` appear promptly without blocking MDI via `wait_complete`). Independently, the backend runs the **MDI/AUTO→manual poller** (`MdiManualRevertPoller`) with `MDI_MANUAL_REVERT_POLL_INTERVAL_S` (see source list above); it sends no separate message but changes the mode reported by LinuxCNC and thus appears in the next `linuxcnc_status` snapshot.

Example:
```json
{
  "type": "linuxcnc_status",
  "protocolVersion": 1,
  "event": "status.snapshot",
  "payload": { /* status snapshot */ }
}
```

### Fields (envelope)
- `type`: literal `linuxcnc_status`
- `protocolVersion`: literal `1`
- `event`: currently literal `status.snapshot`
- `payload`: object with status data (mapped by the backend from LinuxCNC)

### `payload` (status snapshot)
This backend **currently** provides the following top-level fields in the snapshot:
`machine`, `motion`, `io`, `program`, `overrides`, `spindle`, `joints`, `axes`, `tools`, and optionally `coordinate_systems`.

#### `payload.machine`
- `task_mode` (number | null): machine task mode
  - Values (frontend enum `TaskMode`):
    - `1` = `MODE_MANUAL`
    - `2` = `MODE_AUTO`
    - `3` = `MODE_MDI`
- `task_state` (number | null): task execution/safety state
  - Values (frontend enum `TaskState`):
    - `1` = `STATE_ESTOP`
    - `2` = `STATE_ESTOP_RESET`
    - `3` = `STATE_OFF`
    - `4` = `STATE_ON`
- `error` (boolean): `true` when emergency stop/ESTOP is active (derived from LinuxCNC `stat.estop`)
- `powerOn` (boolean): simplified power flag (true ⇔ task state = `STATE_ON`)
- `speed` (number): current feed/speed parameter (backend uses `linuxcnc.stat.feedrate`, default `1.0`)
- `axis_mask` (number | null): LinuxCNC `stat.axis_mask` (axis bitmask per `[TRAJ] COORDINATES`; X=1, Y=2, Z=4, …). Always set in the snapshot (`null` if not determinable) so the store does not keep a stale value.
- `traj_coordinates_hint` (string | null): raw `[TRAJ] COORDINATES` string from the active INI (line scan), only filled when `axis_mask` is `null`; otherwise explicitly `null` (reset hint).

#### `payload.motion`
- `actual_position` (number[] length=3): machine position (x,y,z) in machine units (floats)
- `homed` (number[] length=3): homing status per axis (0/1) for (x,y,z)
- `g5x_index` (number): active G5x index (LinuxCNC convention; 0 means “no active G5x”)
- `g5x_offset` (number[] length=9): G5x offsets (raw values; order i=0..8 is `x,y,z,a,b,c,u,v,w`)
- `g92_offset` (number[] length=9): G92 offsets (raw values; order i=0..8 is `x,y,z,a,b,c,u,v,w`)
- `tool_offset` (number[] length=9): axis offsets of the currently effective tool as `linuxcnc.stat.tool_offset` (same axis order); required for DRO calculation with **G43** / after tool touch-off (`G10 L10`). Missing on older clients: frontend may treat missing field as zeros.

#### `payload.io`
- `din` (number[]): digital inputs (typically 0/1 per input)
- `dout` (number[]): digital outputs (typically 0/1 per output)
- `flood` (number): coolant flood per LinuxCNC `stat.flood` (0 = off, non-zero = on; backend serializes as integer)
- `mist` (number): mist coolant per LinuxCNC `stat.mist` (0 = off, non-zero = on; backend serializes as integer)
- `hal_softkeys` (object, optional): active-state feedback for virtual sidebar HAL softkeys **14**, **15**, **16**. Keys are string literals `"14"`, `"15"`, `"16"`; values are `0` (confirmed inactive) or `1` (active / green highlight). A **missing** key means the feedback pin was not read successfully (treat as inactive in the UI). Populated when `resources/linuxcnc-config/lcncgui-softkeys.hal` is loaded and feedback is wired (`lcncgui-sk-14-fb.in`, etc.). See [`docs/features/13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md`](features/13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md).

#### `payload.program`
- `file` (string | null): path of last loaded program (`linuxcnc.stat().file`), empty/`null` if none loaded
- `gcodes` (number[]): interpreter “active G” array like `linuxcnc.stat().task.activeGCodes` / Python `stat.gcodes`: **index 0** in LinuxCNC is the **sequence number** (`Interp::write_g_codes` in `src/emc/rs274ngc/interp_write.cc` in the [linuxcnc](https://github.com/LinuxCNC/linuxcnc) tree), **not** a G-code; from index 1 onward modals use the convention nominal G number × 10 (e.g. `10` ⇒ G1).
- `mcodes` (number[]): correspondingly **index 0** = sequence number (`write_m_codes`); from index 1 M-related raw values (see LinuxCNC docs / Python interface).
- `settings` (number[]): interpreter settings like `linuxcnc.stat().settings` (tuple of floats; including `settings[0]` sequence number, `settings[1]` feed, `settings[2]` spindle commanded speed **S** — see [LinuxCNC Python module](https://linuxcnc.org/docs/html/config/python-interface.html))
- `current_line` (number | null): line number in loaded program like `linuxcnc.stat().current_line`, JSON-safe int or `null` if not available (gateway: `_optional_stat_int`).
- `motion_line` (number | null): motion-related line number like `linuxcnc.stat().motion_line`; `null` if not available.
- `read_line` (number | null): like `linuxcnc.stat().read_line`; `null` if not available.
- `interp_state` (number): interpreter state like `linuxcnc.stat().interp_state` (e.g. `INTERP_IDLE` = 1 in the Python module). In offline/fallback snapshot without LinuxCNC: `1` (IDLE). Used among other things by `useLiveProgramLineHighlight` for live line highlighting in the program editor (see `docs/features/06_PROGRAM_SCREEN.md`).
- **Frontend display** (payload unchanged): rendering e.g. in the “Active codes” widget follows `src/utils/formatProgramCodes.ts` — as in `backend/adapters/linuxcnc_gateway.py` (`_stat_gcode_labels`) **index 0 of `gcodes`/`mcodes` is skipped**; formatted G strings are deduplicated, **negative** G raw values (e.g. `-1`) are hidden, M codes only as positive **integers**. Clicking a code opens `ProgramCodesDisplay` with data from `src/data/linuxCncGcodeMcodeReference.json`: the dialog shows **short text** (`summary`, fallback `description`), **syntax** (`syntax`), and optionally **Related codes** (`related`); the JSON fields `summary`/`syntax`/`description`/`related` remain the data basis, but **`description` is not shown as a separate long block** under the short text. See `docs/features/01_JOG_HOME_SCREEN.md` → Active G and M codes.

#### `payload.overrides`
- `feedrate` (number): feedrate override (scaling; `1.0` => 100%, values >1 faster, <1 slower)
- `rapidrate` (number): rapid override (scaling; default `1.0`)

#### `payload.spindle`
- `spindle` (array): list of spindle status objects
  - Type (frontend expectation): `LinuxCncSpindleStatus` (see `src/store/types.ts`)
  - Expected keys per entry (values/interpretation analogous to `linuxcnc.stat().spindle[n]`):
    - `brake` (number): spindle brake flag (typically 0/1)
    - `direction` (number): rotation direction (LinuxCNC: forward=1, reverse=-1)
    - `enabled` (number): spindle enabled flag (non-zero => active)
    - `increasing` (number): whether speed is increasing (LinuxCNC-specific)
    - `orient_fault` (number): orientation fault status (non-zero => fault)
    - `orient_state` (number): spindle orientation state
    - `override` (number): override scale for spindle (factor)
    - `override_enabled` (boolean): `true` when spindle override is active
    - `speed` (number): current spindle speed in RPM (sign: >0 cw, <0 ccw)

#### `payload.joints`
- `joints` (array): list of joint status objects
  - Type (frontend expectation): `LinuxCncJointStatus` (see `src/store/types.ts`)
  - Expected keys per entry (frontend subset; values/interpretation analogous to `linuxcnc.stat().joint[n]`):
    - `backlash` (number): backlash in machine units
    - `enabled` (number): non-zero => joint is enabled
    - `fault` (number): non-zero => amp/fault active
    - `ferror_current` (number): current following error
    - `ferror_highmark` (number): maximum following error (high-water mark)
    - `homed` (number): non-zero => joint has been homed
    - `homing` (number): non-zero => homing in progress
    - `inpos` (number): non-zero => joint is “in position”
    - `input` (number): current input position
    - `jointType` (number): linear/angular (LinuxCNC: LINEAR=1, ANGULAR=2)
    - `max_ferror` (number): maximum allowed following error
    - `max_hard_limit` (number): non-zero => max hard limit exceeded
    - `max_position_limit` (number): soft max position limit
    - `max_soft_limit` (number): non-zero => `max_position_limit` exceeded
    - `min_ferror` (number): minimum allowed following error
    - `min_hard_limit` (number): non-zero => min hard limit exceeded
    - `min_position_limit` (number): soft min position limit
    - `min_soft_limit` (number): non-zero => `min_position_limit` exceeded
    - `output` (number): commanded output position
    - `override_limits` (number): non-zero => limits are overridden
    - `units` (number): joint units per mm (or per degree for angular joints)
    - `velocity` (number): current joint velocity

#### `payload.axes`
- `axes` (array): list of axis status objects
  - Type (frontend expectation): `LinuxCncAxisStatus` (see `src/store/types.ts`)
  - Expected keys per entry (frontend subset; analogous to `linuxcnc.stat().axis[n]`):
    - `max_position_limit` (number): soft max position limit
    - `min_position_limit` (number): soft min position limit
    - `velocity` (number): current axis velocity

#### `payload.tools`
- `tools` (object): tool information
  - `tool_in_spindle` (number): tool number in spindle (`0` => no tool loaded)
  - `tool_table` (array): rows from `linuxcnc.stat.tool_table`, each JSON-safe object with e.g. `toolno`, `pocket`, `diameter`, axis offsets (`xoffset` … `woffset`), `comment`, optionally `frontangle` / `backangle` / `orientation` (lathe). Raw rows may be mapping, object attributes, or (per docs) 14-tuples — the latter is decoded positionally (without comment). If `pocket` is missing (common), the gateway first supplements from `stat.toolinfo(toolno)` (`pocketno` in dict, sequence index 2 like gmoccapy tooledit, or object attributes). If still no pocket, the gateway reads the file referenced by `[EMCIO] TOOL_TABLE` in the INI and parses lines in the usual `T… P…` format (tool number → pocket). If `comment` is missing or empty (common with tuple API), text after the first `;` on the same file line is added (including lcncgui `|LCNCGUI|` JSON). **Additionally** the gateway loads the sidecar file `<TOOL_TABLE>.lcncgui-tools.json` (if present) and attaches per known `toolno` optional **`lcncgui_meta`** (object) and **`lcncgui_presets`** (array) to the row — see [`docs/features/05_TOOL_TABLE.md`](features/05_TOOL_TABLE.md). Empty array if no entries or without LinuxCNC.
  - `pocket_prepped` (number | null): prepped magazine (LinuxCNC `pocket_prepped`), when present.
  - `tool_from_pocket` (number | null): LinuxCNC `tool_from_pocket`, when present.

#### Optional: `payload.coordinate_systems`
This field is **optional** and is only set when `backend/coordinate_systems.py` is available and `list_coordinate_systems(stat)` succeeds.

Before listing, the gateway hydrates inactive **pure G5x** offsets from the INI’s `[RS274NGC] PARAMETER_FILE` (VAR file) until that read succeeds (then once per process). Listed G54–G59.3 rows use **`g5x + g92`** (active from live `stat`; inactive from hydrated/edited G5x plus live `g92_offset`).

Type (frontend expectation / see `src/api/coordinateSystems.ts`):
- Array of coordinate system entries:
  - `id` (string): e.g. `0`, `G54`..`G59.3`
    - `0` => machine coordinates (G53)
    - `G54`.. => work coordinate systems
  - `label` (string, optional): display name
  - `is_active` (boolean, optional)
  - `offsets` (object, optional): subset of axis offsets
    - Keys: `x`,`y`,`z`,`a`,`b`,`c`,`u`,`v`,`w`
    - Values: number

---

## Message type: `machine_event`

Direction: backend → frontend  
Usage: Sent for individual machine changes triggered by backend handlers.

Example:
```json
{
  "type": "machine_event",
  "protocolVersion": 1,
  "event": "machine.power.changed",
  "payload": {
    "on": true,
    "state": "on"
  }
}
```

### Fields (envelope)
- `type`: literal `machine_event`
- `protocolVersion`: literal `1`
- `event`: string (current event catalog see below)
- `payload`: event-specific payload

### Current event values

#### `event`: `machine.power.changed`
Payload:
- `on` (boolean): power flag after the change
- `state` (string): `"on"` | `"off"`

#### `event`: `machine.task_state.changed`
Payload:
- `on` (boolean): power flag after the change (derived from task state, `true` only for `STATE_ON`)
- `state` (string): `"on"` | `"off"` (simplified on/off display; does not alone equal full task state)
- `task_state` (number, optional): actual `task_state` from the status snapshot **after** the command (values like frontend enum `TaskState`: `1`…`4`), when the snapshot provides a value. Not sent when no numeric value could be determined.

#### `event`: `motion.coordinates.changed`
Payload:
- `coordinates` (object): subset of computed display coordinates (typically `x`, `y`, `z`) for the frontend coordinate display.
  - Values match `LinuxCncGateway.get_display_coordinates()`: **display = `actual_position` − G5x − G92 − `tool_offset`** (per axis, like LinuxCNC DRO / gmoccapy). The frontend must **not** apply offsets again to these values.

#### `event`: `machine.flood.changed`
Payload:
- `on` (boolean): flood coolant after the change (on/off)

#### `event`: `machine.mist.changed`
Payload:
- `on` (boolean): mist coolant after the change (on/off)

#### `event`: `machine.spindle.changed`
Payload:
- `direction` (string): `"forward"` | `"reverse"` | `"stop"`
- `spindle` (number): spindle index (≥ 0)
- `speed` (number, optional): commanded RPM, only set when passed in the command

#### `event`: `machine.tool_change.requested`
Only sent when the backend has **HAL tool-change polling** enabled via environment variable (see [`docs/features/05_TOOL_TABLE.md`](features/05_TOOL_TABLE.md); default: off).

Payload (backend polls HAL via `halcmd`, rising edge of `iocontrol.0.tool-change` or similar, configurable):
- `tool_number` (number): requested tool number (typically from `iocontrol.0.tool-prep-number`)
- `description` (string): first **`meta.name`** from the lcncgui sidecar (`*.lcncgui-tools.json`) for this tool number, else comment from `stat.tool_table` for the number, else comment suffix from on-disk **`[EMCIO] TOOL_TABLE`** (after `;`), else empty string (same as `LinuxCncGateway.get_tool_description_for_number`)

**Dialog / multiple events:** If the UI already shows the tool-change dialog and another `machine.tool_change.requested` arrives, the **pending state is replaced by the new payload** (no queue).

**Disconnect:** On transition to `disconnected` / error, the UI should **discard** the pending tool change (no OK/abort without an active WebSocket).

The frontend should show a confirmation dialog and on OK send **`machine.tool_change_ack`**, on cancel **`machine.tool_change_abort`** (see [`docs/commands-events.md`](commands-events.md) and [`docs/features/05_TOOL_TABLE.md`](features/05_TOOL_TABLE.md)).

#### `event`: `panel.sidebar.trigger`
Sent when an external panel HAL input fires while a **GUI WebSocket client is connected**. All sidebar buttons (1–16) use this path so actions share the same frontend logic as sidebar clicks and hotkeys.

When **no** GUI client is connected, machine/program buttons are handled directly in the backend instead (no event). UI dialog buttons (2, 5–7) are ignored without a GUI.

Payload:
- `buttonId` (number): virtual sidebar button id (`2` = homing dialog, `5`/`6`/`7` = X/Y/Z coordinate dialog, `3` = cycle start with `pendingAutoRunStartLine`, etc.)

The frontend maps this to `dispatchVirtualSidebarButton(buttonId, 'hal')` (same event-bus path as sidebar click / hotkey).

See [`docs/features/15_PANEL_HAL_INPUTS.md`](features/15_PANEL_HAL_INPUTS.md).

#### `event`: `machine.ini_config.loaded`
Payload:
- `jog_increments_spec` (string): INI-based increment spec for jog buttons (`[DISPLAY] INCREMENTS`), with backend default as fallback.
- `linear_units` (string | null): from `[TRAJ] LINEAR_UNITS`, if available.
- `angular_units` (string | null): from `[TRAJ] ANGULAR_UNITS`, if available.
- `program_units` (number | null): derived program units (`1` inch, `2` mm), if determinable.
- `traj_coordinates` (string | null): raw string from `[TRAJ] COORDINATES` (e.g. `X Y Z`); backend supplements via INI line scan if `linuxcnc.ini().find` returns nothing.
- `display_lathe` (boolean): from `[DISPLAY] LATHE` (truthy as usual: `1`, `TRUE`, …); drives lathe-specific tool fields in the UI.
- `source` (string): `ini` or `default`.
- `ini_path` (string | null): resolved INI file path (when found).
- `loaded_at` (string): UTC ISO timestamp of the response.
- `user_macros` (array): user macros for the Macros screen — each `{ name, fileName, path }` from INI **`[MACROS] MACRO=…`** names that resolve to a `.ngc` under `[RS274NGC] SUBROUTINE_PATH` (see [`backend/user_macros_ini.py`](../backend/user_macros_ini.py) and [`docs/features/07_MACROS_SCREEN.md`](features/07_MACROS_SCREEN.md)). Empty array when no INI, no `[MACROS]` section, or no matching files.

**Note flood/mist (idempotent / noop):** When the requested setting already matches the actual state (flood/mist), the backend may return `ok: true` **without** sending a `machine_event` (no redundant event). That matches an internal no-op in the LinuxCNC gateway.

---

## Message type: `command_result` (ACK)

Direction: backend → (frontend/initiator of command)  
Usage: Response to **every** received frontend command. Success is reported as `ok: true`, details on failure via `error`.

Examples:
```json
{
  "type": "command_result",
  "protocolVersion": 1,
  "commandId": "cmd-1",
  "ok": true
}
```

Error:
```json
{
  "type": "command_result",
  "protocolVersion": 1,
  "commandId": "cmd-1",
  "ok": false,
  "error": {
    "code": "invalid_params",
    "message": "Expected params: {\"on\": true|false}."
  }
}
```

### Fields (envelope)
- `type`: literal `command_result`
- `protocolVersion`: literal `1`
- `commandId` (string): correlation ID (same `commandId` as in the command, for matching in logs/DevTools)
- `ok` (boolean): `true` on success, `false` on failure
- `error` (optional | null): present only for `ok: false` (or `null` depending on serialization)
- `result` (optional, object): for `ok: true`, extra payload of some commands (e.g. **`program.list`** / **`program.read`** / **`program.write`** — see [`docs/commands-events.md`](commands-events.md)); otherwise omitted (`exclude_none`). **Writing the tool table** (`tool.update_tool_table_row`, `tool.add_tool_table_row`, `tool.delete_tool_table_row`): if the file was written but LinuxCNC could not yet run `load_tool_table` (e.g. machine **OFF**), `result` may contain **`{ "toolTableReloadDeferred": true }`** — the UI should briefly inform the user (toast), analogous to the web implementation.
- `asyncPending` (optional, boolean): only for some commands (currently: `motion.home`, `motion.unhome`). When `true`, the command is **only accepted**; the **final result** follows as a separate WebSocket JSON of type `command_completion` with the same `commandId` (see below). When there is no pending async phase, the field is omitted (`exclude_none` on send).

### `error` fields
- `error.code` (string): error category
  - `invalid_json`: incoming WebSocket message was not valid JSON
  - `invalid_command_envelope`: invalid command envelope (missing/disallowed fields, type violation)
  - `invalid_params`: bad or disallowed parameters — first **handler** validation (e.g. `machine.power`, spindle index, direction, `program.auto` / allowed `command`- and `startLine`- combinations). The same code may also come directly from the **LinuxCNC gateway** when inputs are checked there (e.g. invalid internal subcommand in `program_auto`; for WebSocket clients the handler usually catches invalid `command` strings earlier).
  - `unknown_command`: unknown combination of `category` and `action`
  - `handler_failed`: handler threw an exception or internal inconsistency (fallback)
  - Additional codes from the LinuxCNC gateway for machine/I/O commands (non-exhaustive):
    - `linuxcnc_unavailable`: LinuxCNC Python module or command channel not available
    - `machine_not_on`: machine is not in task state ON
    - `estop_active`: emergency stop / ESTOP active
    - `interpreter_busy`: interpreter busy (e.g. MDI/`program.open` rejected; for `program.auto` with `command: "run"` when not `INTERP_IDLE`)
    - `wrong_task_mode`: wrong LinuxCNC task mode (e.g. `program.auto` expects `MODE_AUTO`)
    - `no_program_loaded`: `program.auto` / `run` — no G-code loaded (`stat.file` empty)
    - `not_running`: `program.auto` / `pause` — interpreter not in `INTERP_READING` / `INTERP_WAITING`
    - `not_paused`: `program.auto` / `resume` — interpreter not `INTERP_PAUSED`
    - `invalid_start_line`: gateway — `start_line < 0` for `program.auto` / `run`
    - `machine_disabled`: `stat.enabled` is false (e.g. for `program.open` / MDI)
    - `file_not_found`: file missing or not readable — including `program.open` (G-code path) and **`program.read`**; for `tool.update_tool_table_row` / `tool.delete_tool_table_row` / `tool.add_tool_table_row` the configured `[EMCIO] TOOL_TABLE` file
    - `outside_program_prefix`: `program.open` / **`program.list`** / **`program.read`** / **`program.write`** — path not under `[DISPLAY] PROGRAM_PREFIX` (when prefix is set)
    - `not_a_directory`: **`program.list`** — requested directory does not exist (often the default `PROGRAM_PREFIX` folder). **`error.path`** carries the logical path; user-facing text is localized in the frontend (`components:programPathErrors.not_a_directory`).
    - `list_failed`: **`program.list`** — directory could not be read (e.g. permissions)
    - `read_failed`: **`program.read`** — read failed (e.g. after `open`)
    - `write_failed`: **`program.write`** — write/replace failed
    - `parent_not_found`: **`program.write`** — parent directory missing or not a directory
    - `is_directory`: **`program.write`** — target path is a directory
    - `payload_too_large`: **`program.read`** / **`program.write`** — file or UTF-8 content over configured limit
    - `tool_table_not_configured`: `tool.update_tool_table_row` / `tool.delete_tool_table_row` / `tool.add_tool_table_row` — LinuxCNC INI not resolvable or no readable `[EMCIO] TOOL_TABLE` path
    - `tool_line_not_found`: `tool.update_tool_table_row` / `tool.delete_tool_table_row` — no line in usual `T… P…` format for the tool number, or line not processable
    - `tool_already_exists`: **`tool.add_tool_table_row`** — a line for this `toolno` already exists in the TOOL_TABLE file. **`tool.update_tool_table_row`** — rename (`new_toolno`): target `T` already taken in `.tbl`, **or** in the plasmaweb sidecar a **non-empty** entry already exists under the target number (meta/presets)
    - `no_tool_in_spindle`: `tool.touch_off` — no tool in spindle (`stat.tool_in_spindle` ≤ 0)
    - `cutter_comp_active`: `tool.touch_off` — radius compensation G41/G42 active (touch-off rejected)
    - `command_in_progress`: command channel busy (`wait_complete` still running)
    - `command_timeout`: `wait_complete` timeout (including after `program_open`, after `program.auto` for **`pause`/`resume`** (not for **`run`** — no final `wait_complete` there), and after `machine.abort`)
    - `linuxcnc_command_failed` / `linuxcnc_unexpected_status`: LinuxCNC reports failure or unexpected return code after `wait_complete` (including for `program.auto` only for **`pause`/`resume`** and for the optional mode switch before **`run`**; not for **`run`** itself via this gateway wait phase)
  - Handler `app.exit`:
    - `shutdown_unavailable`: `shutdown: true` requested but system poweroff is not configured (`sudo ./install.sh --setup-shutdown` on the controller)
    - With `shutdown: true` and `ok: true`: the handler runs **before** the ACK (abort motion, machine off, shutdown marker). The frontend uses a longer WebSocket timeout (~40 s) than for a plain exit (~8 s). System poweroff runs only after `bin/plasmaweb` exits and LinuxCNC has shut down; failures are logged to `~/.local/share/plasmaweb/shutdown.log`.
  - Handler `machine.set_task_state` (after snapshot check with short verification window):
    - `estop_reset_rejected`: `ESTOP_RESET` (`status` 2) was requested, the handler polls status briefly several times (currently up to ~250 ms), and the snapshot still shows `task_state` = `STATE_ESTOP` (1) — typically when hardware E-stop / release applies or LinuxCNC did not accept the reset. Then `ok: false`, **no** `machine_event` of this kind.
- `error.message` (string): short English fallback for logs and non-i18n clients
- `error.path` (string, optional): filesystem path for **`program.list`** / **`program.read`** / **`program.write`** path validation errors — used by the frontend for localized messages (`programPathErrors.*` in `components.json`)

**UI note:** Failed **`command_result`** and **`command_completion`** responses (`ok: false`) are shown centrally in the web UI in **`useBackendWebSocket`** as an **error toast** (with `error.code` / `error.message` from the message). **`program.list`** / **`program.read`** / **`program.write`** / **`program.open`** failures skip the global toast; components show a local banner or toast using **`formatProgramPathError`** (`src/lib/formatProgramPathError.ts`) for known path error codes. Additionally the store keeps recent results in a ring (`commandResultHistory`, bounded length) and `lastWsCommandResult`, so multiple `command_result` messages arriving in quick succession remain assignable by `commandId`. Components correlate outbound commands with inbound results via **`usePendingWsCommandResult`** (and related hooks in `src/hooks/usePendingWsCommandResult.ts`); promise-based callers use **`waitForWsCommandResult`** (`src/lib/waitForWsCommandResult.ts`), which shares the same history lookup. Spontaneous LinuxCNC messages (`linuxcnc_error`) and optional legacy `type: "error"` frames are also shown as toasts.

---

## Message type: `command_completion` (async result)

Direction: backend → all connected WebSocket clients (**broadcast**, not only initiator)  
Usage: Completion of a command previously acknowledged with `asyncPending: true` (e.g. homing finished or failed).

The frontend correlates via **`commandId`** (and if needed `category` / `action`) with the original command.

Success example:
```json
{
  "type": "command_completion",
  "protocolVersion": 1,
  "commandId": "cmd-home-1",
  "category": "motion",
  "action": "home",
  "ok": true
}
```

Error example (LinuxCNC reports error after `wait_complete` / error-channel text):
```json
{
  "type": "command_completion",
  "protocolVersion": 1,
  "commandId": "cmd-home-1",
  "category": "motion",
  "action": "home",
  "ok": false,
  "error": {
    "code": "linuxcnc_command_failed",
    "message": "joint 0 on limit switch during home"
  }
}
```

### Fields
- `type`: literal `command_completion`
- `protocolVersion`: literal `1`
- `commandId` (string): same ID as the related `command`
- `category` (string): e.g. `motion`
- `action` (string): e.g. `home` | `unhome`
- `ok` (boolean): final result of the machine action
- `error` (optional): as for `command_result`, only for `ok: false`

**Note:** The same physical fault may also appear as `linuxcnc_error` (error channel) if the background poller sees the message first. The frontend may deduplicate text or use both channels.

---

## Message type: `linuxcnc_error` (spontaneous messages)

Direction: backend → all connected WebSocket clients (**broadcast**)  
Usage: NML/operator messages from `linuxcnc.error_channel` (e.g. axis faults, overcurrent hints, operator text), **without** an associated frontend command.

Example:
```json
{
  "type": "linuxcnc_error",
  "protocolVersion": 1,
  "kind": "nml_error",
  "message": "..."
}
```

### Fields
- `type`: literal `linuxcnc_error`
- `protocolVersion`: literal `1`
- `kind` (string): short type, e.g. `nml_error`, `operator_error`, `nml_text`, `operator_text`, `nml_display`, `operator_display`, or `kind_<int>` for unknown constants
- `message` (string): message text from LinuxCNC

Source: `ErrorChannelPublisher` in `backend/services/error_channel_publisher.py` (interval see `ERROR_CHANNEL_POLL_INTERVAL_S` in `backend/config.py`).

