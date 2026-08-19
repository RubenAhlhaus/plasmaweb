# Frontend → Backend: commands (WebSocket)

JSON over the same WebSocket as the status stream. **Backend responses** (`linuxcnc_status`, `command_result`, `machine_event`) are documented in `docs/backend-frontend-messages.md`.

## Message types (short)

| `type`              | Direction             | Content |
|---------------------|----------------------|--------|
| `command`           | Frontend → Backend   | Command in the envelope below |
| `command_result`    | Backend → Frontend   | Per-command response (`ok`, optional `error`) |
| `linuxcnc_status`   | Backend → Frontend   | Periodic status snapshot |
| `machine_event`     | Backend → Frontend   | Single event (e.g. after `machine.power`) |

Details on inbound messages: `docs/backend-frontend-messages.md`.

## Command envelope

```json
{
  "type": "command",
  "protocolVersion": 1,
  "commandId": "unique-id",
  "category": "machine",
  "action": "set_task_state",
  "params": { "status": 4 }
}
```

- **`type`**: always `command`.
- **`protocolVersion`**: optional; backend default is `1` (see `CommandEnvelope` in `backend/contracts/messages.py`).
- **`commandId`**: required for a valid envelope; the frontend sets it automatically (`useSendCommand`).
- **`category`**: e.g. `machine`, `motion`, `program`, `tool`, `hal`, `app` (`CommandCategory` in `src/api/backendCommands.ts`).
- **`action`**: action within the category.
- **`params`**: object, depends on `category` and `action`.

Sending in code: `src/api/backendCommands.ts` (`useSendCommand` / `createCommandEnvelope`).

## Commands and parameters

One row per command; allowed values are listed with the parameters. **`(planned)`** = no backend handler in `backend/main.py` yet / gateway wiring still open.

Comparison with **gmoccapy** ([`gmoccapy.py`](https://github.com/LinuxCNC/linuxcnc/blob/master/src/emc/usr_intf/gmoccapy/gmoccapy.py)): only **LinuxCNC-/NML-relevant** items are listed; pure GTK/Glade concerns (themes, embedded tabs, calculator dialog, on-screen keyboard, icon themes, local `.prefs`) are **not** listed as commands. Those calls go through the Python API [`linuxcnc.command`](https://linuxcnc.org/docs/html/config/python-interface.html).

### `app`

#### `app.exit`

Terminates the **backend process** (FastAPI/Uvicorn) after a successful `command_result` (`ok: true`). The frontend typically sends this command before closing the browser tab; the WebSocket handler in `backend/api/ws.py` then triggers a controlled backend shutdown (`uvicorn.Server.should_exit` or fallback `SIGINT`).

Without `shutdown`, the handler does not use the LinuxCNC gateway. When `shutdown` is `true`, the handler checks that system poweroff is available (`bin/lcncgui-shutdown --dry-run`); if not, returns `error.code` = **`shutdown_unavailable`**. On success, the handler aborts motion (`machine.abort`), switches the machine off (`machine.power` / `STATE_OFF`), writes a shutdown marker, and returns `ok: true`. The frontend closes the browser; `bin/lcncgui` exits so LinuxCNC shuts down; a background job in `bin/lcncgui` then runs `lcncgui-shutdown` (system poweroff). The WebSocket handler only stops the backend process after the ACK.

| Parameter | Type | Values |
|-----------|-----|--------|
| `shutdown` | boolean (optional) | `false` (default): close UI/backend only. `true`: also request system poweroff (requires `sudo ./install.sh --setup-shutdown` on the controller). |

### `hal`

#### `hal.softkey_pulse`

Pulse a **virtual sidebar HAL softkey** (labels **14**, **15**, **16**). The backend triggers an internal oneshot; the user-visible **pulse output** is `lcncgui-sk-14.out` (and `-15`, `-16`). **Active feedback** for the green button highlight: wire your signal to `lcncgui-sk-14-fb.in` (lcncgui polls `…-fb.out` in `linuxcnc_status.io.hal_softkeys`). See [`resources/linuxcnc-config/lcncgui-softkeys.hal`](../resources/linuxcnc-config/lcncgui-softkeys.hal) and [`docs/features/13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md`](features/13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md).

**Backend:** `handle_hal_softkey_pulse` in [`backend/handlers/hal.py`](../backend/handlers/hal.py), gateway `hal_pulse_rising_edge`. **No** `machine_event` is sent.

| Parameter | Type | Values |
|-----------|-----|--------|
| `slot` | number | `14` \| `15` \| `16` |

**Error codes** (`command_result.error.code`): `invalid_params`, `hal_softkey_pin_not_configured`, `halcmd_unavailable`, `empty_hal_pin`, `hal_set_failed`, `hal_set_nonzero`.

#### `hal.set_jog_wheel_scale`

Set HAL **`axis.x/y/z.jog-scale`** (or pins from env `LCNCGUI_JOG_WHEEL_SCALE_PINS`) to the selected jog increment so an MPG / jogwheel moves by the same step as `IncrementSelector`. The frontend calls this whenever `selectedJogIncrement` changes while connected (`useJogWheelScaleSync`). See [`docs/features/01_JOG_HOME_SCREEN.md`](features/01_JOG_HOME_SCREEN.md).

**Backend:** `handle_hal_set_jog_wheel_scale` in [`backend/handlers/hal.py`](../backend/handlers/hal.py), gateway `set_jog_wheel_scale`. **No** `machine_event` is sent.

| Parameter | Type | Values |
|-----------|-----|--------|
| `scale` | number | distance per jogwheel count in machine units (`> 0`) |

**Error codes:** `invalid_params`, `jog_wheel_scale_pins_not_configured`. HAL write failures (`hal_set_nonzero`, `halcmd_unavailable`) are returned as **`ok: true` with `noop`** (optional MPG wiring). The UI also skips error toasts for this action.

Feature docs: [`01_JOG_HOME_SCREEN.md`](features/01_JOG_HOME_SCREEN.md), softkeys: [`13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md`](features/13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md).

### `machine`

#### `machine.power`

Toggles machine power via the backend gateway.

| Parameter | Type | Values |
|-----------|-----|--------|
| `on` | boolean | `true` / `false` |

#### `machine.set_task_state`

Sets task state (on/off, ESTOP, ESTOP reset). Implementation: `handle_machine_set_task_state` in `backend/handlers/machine.py`; gateway `set_task_state` in `backend/adapters/linuxcnc_gateway.py`.

| Parameter | Type | Values |
|-----------|-----|--------|
| `status` | number or string | As frontend enum `TaskState` in `src/store/types.ts`: `1` = ESTOP, `2` = ESTOP-RESET, `3` = OFF, `4` = ON; equivalent strings (`STATE_ESTOP`, …) are also accepted by the backend. |

**Error case:** After the command the handler polls status and, for **`ESTOP_RESET` (2)**, verifies briefly with several re-polls (currently up to ~250 ms) because LinuxCNC may report the state change late. If the snapshot still shows **`task_state` = 1 (`STATE_ESTOP`)**, the backend returns **`command_result`** with `ok: false` and `error.code` = **`estop_reset_rejected`** (human-readable message, e.g. check hardware E-stop). In that case there is **no** successful `machine_event` for this action. Details: `docs/backend-frontend-messages.md` → `command_result` / `error.code`.

#### `machine.set_task_mode` (planned)

Switches LinuxCNC task mode (gmoccapy: Manual / MDI / Auto).

| Parameter | Type | Values |
|-----------|-----|--------|
| `mode` | string | `manual` \| `mdi` \| `auto` (mapped to `linuxcnc.MODE_MANUAL` / `MODE_MDI` / `MODE_AUTO`). |

#### `machine.abort` (implemented)

Aborts running motion / interpreter. Matches the Python API [`linuxcnc.command.abort()`](https://linuxcnc.org/docs/html/config/python-interface.html) (NML `EMC_TASK_ABORT`); per documentation this method may be sent almost always.

**Backend / gateway:** `handle_machine_abort` in [`backend/handlers/machine.py`](backend/handlers/machine.py), gateway `LinuxCncGateway.abort_program` (thread pool like `program.open` so `wait_complete` does not block the asyncio loop). **No** `machine_event` is sent.

| Parameter | Type | Values |
|-----------|-----|--------|
| — | — | none or empty object `{}` (extra keys are rejected) |

#### `machine.tool_change_ack`

Acknowledges a **manual tool change** via HAL, analogous to gmoccapy (`toolchange-changed`). The backend runs the shell line configured in **`LCNCGUI_TOOLCHANGE_ACK_CMD`** (typically `halcmd setp …` or a short script). If the variable is unset, the command returns `ok: false` with code `tool_change_ack_not_configured`.

**Security:** The line is executed with shell interpretation — use only trusted, fixed configuration (see [`docs/features/05_TOOL_TABLE.md`](features/05_TOOL_TABLE.md)).

**Backend:** `handle_machine_tool_change_ack` in [`backend/handlers/machine.py`](backend/handlers/machine.py), gateway `LinuxCncGateway.run_shell_command`.

| Parameter | Type | Values |
|-----------|-----|--------|
| — | — | none or `{}` |

#### `machine.tool_change_abort`

Like `machine.abort`, aborts the task and optionally runs **`LCNCGUI_TOOLCHANGE_ABORT_EXTRA_CMD`** (HAL cleanup). Order: first `linuxcnc.command.abort()` + `wait_complete`, then the shell line (if set). Same security note as **`LCNCGUI_TOOLCHANGE_ACK_CMD`** (trusted shell lines only).

**Backend:** `handle_machine_tool_change_abort` in [`backend/handlers/machine.py`](backend/handlers/machine.py), gateway `LinuxCncGateway.tool_change_abort_with_optional_shell`.

| Parameter | Type | Values |
|-----------|-----|--------|
| — | — | none or `{}` |

#### `machine.flood`

Flood coolant on/off (`command.flood`). Implementation: `handle_machine_flood` in `backend/handlers/machine.py` (registered in `backend/main.py`), gateway `set_flood`. For an idempotent call (target equals actual) `ok: true` may return without `machine_event` — see `docs/backend-frontend-messages.md`.

| Parameter | Type | Values |
|-----------|-----|--------|
| `on` | boolean | `true` = `FLOOD_ON`, `false` = `FLOOD_OFF` |

#### `machine.mist`

Mist coolant on/off (`command.mist`). Implementation: `handle_machine_mist` in `backend/handlers/machine.py` (registered in `backend/main.py`), gateway `set_mist`. Idempotency / missing event same as `machine.flood` (see `docs/backend-frontend-messages.md`).

| Parameter | Type | Values |
|-----------|-----|--------|
| `on` | boolean | `true` = `MIST_ON`, `false` = `MIST_OFF` |

#### `machine.spindle`

Spindle direction/speed (`command.spindle`); gmoccapy uses this for forward/reverse/stop. Implementation: `handle_machine_spindle` in `backend/handlers/machine.py` (registered in `backend/main.py`), gateway `set_spindle`.

| Parameter | Type | Values |
|-----------|-----|--------|
| `direction` | string | `forward` \| `reverse` \| `stop` (mapped to LinuxCNC constants in the gateway) |
| `speed` | number | optional, programmed RPM (LinuxCNC applies spindle override on top) |
| `spindle` | number | optional, spindle index (default `0`) |

**Note on `speed`:** If `speed` is omitted or not positive, the gateway uses the **programmed S speed** from the interpreter (`stat.settings[2]`) when present; otherwise an internal default (see `LinuxCncGateway.set_spindle`). That value is passed to `command.spindle` **as-is**; LinuxCNC multiplies by the current spindle override (`speed-out = commanded × override`). The gateway must **not** pre-divide by override (that inverted the factor). The lcncgui **virtual sidebar** sends forward/reverse **without** `speed` so that e.g. after MDI `S…` that speed is preserved.

#### `machine.feed_override`

Feed override (`linuxcnc.command.feedrate`); wiring: `handle_machine_feed_override` in `backend/handlers/machine.py`, gateway `set_feed_override` in `backend/adapters/linuxcnc_gateway.py`. Semantics as in LinuxCNC docs: **1.0 = 100 %**. The gateway currently clamps the factor roughly to **0.01–2.0** (1 %–200 %), idempotent when already equal.

| Parameter | Type | Values |
|-----------|-----|--------|
| `factor` | number | e.g. `1.0` = 100 %, `1.5` = 150 % |

#### `machine.rapid_override`

Rapid override (`linuxcnc.command.rapidrate`); wiring: `handle_machine_rapid_override` in `backend/handlers/machine.py`, gateway `set_rapid_override` in `backend/adapters/linuxcnc_gateway.py`. Semantics as in LinuxCNC docs: **1.0 = 100 %**. The gateway currently clamps the factor roughly to **0.0–1.0** (0 %–100 %), idempotent when already equal.

| Parameter | Type | Values |
|-----------|-----|--------|
| `factor` | number | e.g. `1.0` = 100 %, `0.5` = 50 % |

#### `machine.spindle_override`

Spindle speed override (`linuxcnc.command.spindleoverride`); wiring: `handle_machine_spindle_override` in `backend/handlers/machine.py`, gateway `set_spindle_override` in `backend/adapters/linuxcnc_gateway.py`. **1.0 = 100 %**; clamp like `machine.feed_override`. Spindle **0** uses the one-argument `spindleoverride(f)` form; further indices use `spindleoverride(f, n)`.

| Parameter | Type | Values |
|-----------|-----|--------|
| `factor` | number | e.g. `1.0` = 100 % |
| `spindle` | number | optional, default `0` — spindle index |

#### `machine.get_ini_config`

Loads relevant INI runtime values for the frontend once (e.g. jog increments, units, **TRAJ COORDINATES**, **DISPLAY LATHE**, **user macros** from `[MACROS]` + `SUBROUTINE_PATH`). The handler reads the active LinuxCNC INI, caches the result in the backend process, and sends a `machine_event` (`machine.ini_config.loaded`). Payload details: [`docs/backend-frontend-messages.md`](backend-frontend-messages.md) → `machine.ini_config.loaded`.

| Parameter | Type | Values |
|-----------|-----|--------|
| — | — | none (`{}`) |

#### `machine.override_limits` (planned)

Override limits (`command.override_limits`) — gmoccapy when limits are active.

| Parameter | Type | Values |
|-----------|-----|--------|
| — | — | none |

#### `machine.set_block_delete` (planned)

Ignore `/` lines (`command.set_block_delete`).

| Parameter | Type | Values |
|-----------|-----|--------|
| `enabled` | boolean | |

#### `machine.set_optional_stop` (planned)

Optional stop on M1 (`command.set_optional_stop`).

| Parameter | Type | Values |
|-----------|-----|--------|
| `enabled` | boolean | |

#### `machine.teleop_enable` (planned)

Joint vs. world/teleop mode (`command.teleop_enable`) — relevant for non-trivial kinematics (gmoccapy: “Joint mode” / world).

| Parameter | Type | Values |
|-----------|-----|--------|
| `enable` | boolean | `true` = teleop/world, `false` = joint (convention to align with backend) |

### `motion`

#### `motion.home`

Starts homing for one joint or all (`command.home`). Wiring: `handle_motion_home` in [`backend/handlers/motion.py`](../backend/handlers/motion.py), gateway `home_motion` in [`backend/adapters/linuxcnc_gateway.py`](../backend/adapters/linuxcnc_gateway.py).

Preconditions like **gmoccapy** (`on_btn_home_clicked` / `on_btn_home_all_clicked`): machine ON, not ESTOP, `stat.enabled`, `MODE_MANUAL`, interpreter idle; before the command switch to joint trajectory mode (`teleop_enable(0)`); for `home` additionally: no joint may already be homing (`joint[*].homing`).

Parallel requests: If a `motion.home` or `motion.unhome` (async) is already running, further home/unhome commands are rejected immediately with `error.code = homing_job_active`.

**Async protocol:** The first `command_result` has `ok: true` and `asyncPending: true` (command accepted). Execution runs in the background (event loop not blocked). The **final result** arrives as **`command_completion`** with the same `commandId` (broadcast to all clients); see `docs/backend-frontend-messages.md`. If homing fails, `command_completion` with `ok: false` includes e.g. `linuxcnc_command_failed` or `command_timeout` (text from `wait_complete` / error channel).

**Synchronous rejection:** If pre-checks fail (machine not ON, wrong mode, …), the backend returns **immediately** `command_result` with `ok: false` **without** `asyncPending` (no `command_completion`).

| Parameter | Type | Values |
|-----------|-----|--------|
| `joint` | number | `-1` = all joints; otherwise joint index `≥ 0` (in the default UI: `0` / `1` / `2` for X / Y / Z). |

#### `motion.unhome`

Clears homed state (`command.unhome`). Wiring: `handle_motion_unhome` in [`backend/handlers/motion.py`](../backend/handlers/motion.py), gateway `unhome_motion` in [`backend/adapters/linuxcnc_gateway.py`](../backend/adapters/linuxcnc_gateway.py).

Preconditions like **gmoccapy** (`_on_btn_unhome_clicked`): same base checks as `motion.home` (machine ON, enabled, manual, interpreter idle, joint mode before command); additionally: no homing in progress (`homing_in_progress`).

Parallel requests: If a `motion.home` or `motion.unhome` (async) is already running, further home/unhome commands are rejected immediately with `error.code = homing_job_active`.

Same as `motion.home`: async (`asyncPending` + `command_completion`), see there.

| Parameter | Type | Values |
|-----------|-----|--------|
| `joint` | number | `-1` or joint index |

#### `motion.jog`

Jogs an axis or joint continuously or by one step (`linuxcnc.command.jog`). Wiring: `handle_motion_jog` in [`backend/handlers/motion.py`](../backend/handlers/motion.py), gateway `jog_motion` in [`backend/adapters/linuxcnc_gateway.py`](../backend/adapters/linuxcnc_gateway.py). Preconditions like gmoccapy: machine ON, not ESTOP, `stat.enabled`, `MODE_MANUAL`; `jointMode` must match current trajectory mode (joint jog only when `motion_mode` is Free/Joint, axis jog only in teleop/world); for non-trivial kinematics axis jog in joint mode is rejected with `jog_kinematics_conflict`.

| Parameter | Type | Values |
|-----------|-----|--------|
| `jointMode` | boolean | `true` = joint jog (motors individually), `false` = axis jog in Cartesian space. |
| `index` | number | With `jointMode: true`: joint index. With `false`: axis index `0`–`8` for X Y Z A B C U V W (UI uses `0`/`1`/`2` for X/Y/Z). |
| `velocity` | number | Sign sets direction. **Backend convention:** magnitude in **machine units per minute** (linear); internally converted for the Python API (`/ 60`). |
| `mode` | string | Only `"continuous"` (hold jog) or `"increment"` (step). |
| `distance` | number | For `mode: "increment"` **required**, step size in machine units (`> 0`). Omit for `"continuous"`. |

#### `motion.jog_stop`

Stops a **running continuous** jog for an axis or joint (`linuxcnc.command.jog` with `JOG_STOP`). Same axis/joint mapping as `motion.jog`; typically sent after pointer down/up. Wiring: `handle_motion_jog_stop` in [`backend/handlers/motion.py`](../backend/handlers/motion.py), gateway `jog_stop`.

| Parameter | Type | Values |
|-----------|-----|--------|
| `jointMode` | boolean | Same as the corresponding `motion.jog` start. |
| `index` | number | Same as the corresponding start (`0`–`8`). |

#### `motion.max_velocity` (planned)

Set maximum speed (`command.maxvel`).

| Parameter | Type | Values |
|-----------|-----|--------|
| `value` | number | machine units / s per LinuxCNC |

#### `motion.set_coordinate_system_offset` (implemented)

Wiring: `handle_motion_set_coordinate_system_offset` in [`backend/handlers/motion.py`](../backend/handlers/motion.py), `LinuxCncGateway.set_coordinate_system_offset` in [`backend/adapters/linuxcnc_gateway.py`](../backend/adapters/linuxcnc_gateway.py).

Sets work coordinate offsets via MDI `G10 L2 P<n>` (`P1`–`P9` ↔ `G54`–`G59.3`). Preconditions and return-to-manual behaviour match `program.mdi` / `set_active_coordinate_system`.

When editing any G54–G59.3 system, the dialog row reflects `g5x_offset + g92_offset` per axis; the backend **always** subtracts `g92` before building `G10 L2` so the entered value stays the on-screen total. If `stat.g92_offset` is missing or shorter than the axis index, no subtraction is applied for that axis (see gateway code). The in-memory cache stores the **pure G5x** values that were written.

| Parameter | Type | Values |
|-----------|-----|--------|
| `systemId` | string | `G54` … `G59.3` only — not `0` / machine (those cells are disabled in the UI). |
| axis fields | number | At least one of `x`, `y`, `z`, `a`, `b`, `c`, `u`, `v`, `w` with a numeric value, e.g. `{ "systemId": "G54", "x": 10.5 }`. Multiple axes in one command are allowed. |

#### `motion.set_active_coordinate_system` (implemented)

Selects the active coordinate system via MDI (`G54`…`G59.3`; for `systemId` `0`, `G53` is sent — see `backend.coordinate_systems.mdi_line_for_active_coordinate_system`). Aligned with gmoccapy (`_on_btn_set_selected_clicked`): if the desired system is already active (`stat.g5x_index`), no MDI is sent (no-op).

**Safety / preconditions (backend):** same as `program.mdi` (machine `ON`, `stat.enabled`, interpreter `INTERP_IDLE`, for `MODE_MANUAL` no active jog/motion during mode switch).

**Return to manual:** independently of this command, the background **`MdiManualRevertPoller`** (`backend/services/mdi_manual_revert.py`, interval `MDI_MANUAL_REVERT_POLL_INTERVAL_S` in `backend/config.py`) switches LinuxCNC from `MODE_MDI` or `MODE_AUTO` back to `MODE_MANUAL` once interpreter and motion are idle (after `wait_last_command_complete` before `set_task_mode`). Applies to every MDI session or after a finished G-code run in auto mode, not only after this command.

| Parameter | Type | Values |
|-----------|-----|--------|
| `systemId` | string | `0` (machine / sends G53) or `G54` … `G59.3` — canonical IDs in `backend/coordinate_system_ids.py`. Unlike `set_coordinate_system_offset`, **`0` is valid here**. |

#### `motion.set_axis_coordinate`

Sets the **target coordinate** of an axis in the active coordinate system. Implementation follows gmoccapy (`on_btn_set_value_clicked`) and sends the MDI line `G10 L20 P0 <AXIS><VALUE>` on the backend.

| Parameter | Type | Values |
|-----------|-----|--------|
| `axis` | string | `x` \| `y` \| `z` \| `a` \| `b` \| `c` \| `u` \| `v` \| `w` |
| `value` | number | Target position. |

#### `motion.clear_g92` (planned)

Clear G92 offsets (gmoccapy: `G92.1`).

| Parameter | Type | Values |
|-----------|-----|--------|
| — | — | none |

### `program`

#### `program.mdi`

Execute one MDI line (`command.mdi`); macros (`O<name> call`) run through it like in gmoccapy.

**Safety / preconditions (backend):**

- Machine must be `ON` (not `ESTOP`/`OFF`), and `stat.enabled` must be `true`.
- Interpreter must be `INTERP_IDLE`, otherwise rejected with `error.code = interpreter_busy`.
- If `program.mdi` is triggered in `MODE_MANUAL`, the backend rejects when jog/motion is active (heuristic: `stat.current_vel` or `stat.motion_type` not `MOTION_TYPE_NONE`) with `error.code = jog_active`.
- If `program.mdi` is triggered in `MODE_MANUAL` and no jog is active, the backend first switches to `MODE_MDI` and then sends the MDI line.
- If `program.mdi` is triggered in `MODE_MDI`, the MDI line is sent directly.

**Frontend (lcncgui):** Before sending, `useMdiPreconditions` (`src/hooks/useMdiPreconditions.ts`) also checks **task mode** from status: MDI is only offered in the UI when **`MODE_MANUAL`** or **`MODE_MDI`** is set — in **program/auto mode** (`MODE_AUTO`), **Apply** preset, spindle/feed **set**, and MDI **Send**/submit stay disabled. The Home **MDI console input** stays focusable (so focus is not dropped when the interpreter is briefly busy after a line); only sending is gated, with precondition tooltip / `aria-describedby` and an info toast if **Enter** is pressed while blocked. While **`task_mode`** is still **missing** in the snapshot but the machine is already **ON**, the same logic briefly locks MDI (**task mode unknown**) until status is complete.

**Automatic revert (MDI / AUTO → manual):**

- A background **poller** (`MdiManualRevertPoller` in `backend/services/mdi_manual_revert.py`) periodically (`MDI_MANUAL_REVERT_POLL_INTERVAL_S` in `backend/config.py`) checks whether LinuxCNC is in `MODE_MDI` **or** `MODE_AUTO`, `stat.enabled` is set, machine is `STATE_ON`, interpreter is `INTERP_IDLE`, and there is no jog/motion activity. If so, the backend drains the command channel (`wait_last_command_complete`) and calls `set_task_mode(MODE_MANUAL)`. After an MDI line you can return to manual for jogging; after a `program.auto` run finishes, the control also leaves program mode again. The next MDI line or next `run` switches back to MDI or AUTO as needed (gateway).
- If `wait_last_command_complete` after a program or MDI fault often reports `linuxcnc_command_failed` (equivalent to `RCS_ERROR` on the command channel), revert to `MODE_MANUAL` is **still** attempted so the UI does not stay stuck in program mode; other errors (e.g. `command_in_progress`) still abort the revert.
- If `wait_last_command_complete` or `set_task_mode` fails repeatedly, the backend logs a **throttled** `warning` (~every 30 s) to avoid log spam.

| Parameter | Type | Values |
|-----------|-----|--------|
| `text` | string | max length as LinuxCNC (254) |

#### `program.open` (implemented)

Load a G-code file in LinuxCNC (`command.program_open` + `wait_complete`), comparable to gmoccapy/HAL “load file”. **Only the path** is sent (no file content over WebSocket). The path must be valid on the **LinuxCNC/backend machine**. The web UI typically obtains such paths via **`program.list`** / **`program.read`** from the backend, not from the local PC.

**Backend / gateway:**

- Machine must be `ON`, `stat.enabled` must be `true`.
- Interpreter must be `INTERP_IDLE`, else `error.code = interpreter_busy`.
- File must exist and be readable, else `file_not_found`.
- If `[DISPLAY] PROGRAM_PREFIX` is set in the INI, the file must lie under that directory, else `outside_program_prefix`.
- Implementation: `handle_program_open` in `backend/handlers/program.py` (runs in a thread pool so `wait_complete` does not block the asyncio loop).

| Parameter | Type | Values |
|-----------|-----|--------|
| `path` | string | absolute path to the G-code file on the backend machine |

**Note:** After **`program.write`** to the same file, LinuxCNC may show new content only after another **`program.open`** depending on version — reload the file if needed.

#### `program.list` (implemented)

List a directory under `[DISPLAY] PROGRAM_PREFIX` (backend filesystem). Without `PROGRAM_PREFIX` set in the INI, the same rules as `program.open` apply (no prefix path restriction).

| Parameter | Type | Values |
|-----------|-----|--------|
| `path` | string | optional; empty/missing = first prefix directory or current working directory of the backend process |

**Success (`command_result`, `ok: true`):** field **`result`** with:

- `path` (string): canonical listed directory
- `parentPath` (string \| null): parent directory if it exists and also lies under the prefix (for “up” in the UI)
- `entries` (Array): `{ name, path, isDir, size }` — `size` only for files (bytes)

Implementation: `handle_program_list` in [`backend/handlers/program.py`](backend/handlers/program.py), path logic [`backend/program_file_paths.py`](backend/program_file_paths.py).

#### `program.read` (implemented)

Read a G-code file from the backend machine as UTF-8 text (for the editor). Maximum file size: `PROGRAM_FILE_READ_MAX_BYTES` in [`backend/config.py`](backend/config.py).

| Parameter | Type | Values |
|-----------|-----|--------|
| `path` | string | editor / logical path (under prefix when set) |
| `statusPath` | string (optional) | LinuxCNC `program.file` when it differs from `path`; backend prefers the logical path for the same real file (symlinks), else the status path |

**Success:** `result` with `path` (string) and `content` (string). Invalid UTF-8 sequences are replaced on read (`errors='replace'`).

Implementation: `handle_program_read` in `backend/handlers/program.py`, path resolution in [`backend/program_file_paths.py`](backend/program_file_paths.py) (`resolve_path_for_program_read`).

#### `program.write` (implemented)

Write program text atomically to the backend machine (temp file in the same folder, then `os.replace`). Maximum payload: `PROGRAM_FILE_WRITE_MAX_BYTES` in `backend/config.py` (UTF-8 length of content).

| Parameter | Type | Values |
|-----------|-----|--------|
| `path` | string | absolute target path; parent directory must exist |
| `content` | string | full file content |

**Success:** `result` with `path` (string) — canonical written path.

**Transport / size:** Besides `PROGRAM_FILE_WRITE_MAX_BYTES`, the **entire JSON message** (envelope including `params.content`) must be accepted by the WebSocket server and any **reverse proxy** (nginx `client_max_body_size`, Caddy, …) — otherwise sending fails before the backend validates. Large programs may need chunks or a separate upload endpoint (not implemented currently).

Implementation: `handle_program_write` in `backend/handlers/program.py`.

**Macro queue (frontend):** The Macros screen may, after `program.list` (default directory), trigger **`program.write`** → **`program.open`** → **`program.read`** to save a queue-generated main program, load it in LinuxCNC, and sync the editor with file content from the control PC — see [`docs/features/07_MACROS_SCREEN.md`](features/07_MACROS_SCREEN.md).

#### `program.auto` (implemented)

AUTO commands via [`linuxcnc.command.auto(int[, int])`](https://linuxcnc.org/docs/html/config/python-interface.html) — start (optional from line), pause, resume. Implementation: `handle_program_auto` in [`backend/handlers/program.py`](backend/handlers/program.py) (runs in thread pool so the asyncio loop is not blocked), gateway `LinuxCncGateway.program_auto`.

**`wait_complete` and `command_result`:**

- **`run`:** After `c.auto(AUTO_RUN, startLine)` there is **no** `wait_complete` in the gateway. Long waits would block the `command` lock and (with Python bindings) often `stat.poll()` too — frozen coordinate display and hung backend shutdown. **`command_result` with `ok: true`** therefore means: pre-checks passed and **`AUTO_RUN` was sent**, not that LinuxCNC acknowledged the full program run to `INTERP_IDLE`. Errors **after** sending appear as usual via **`linuxcnc_error`** (error channel) and the status stream (`linuxcnc_status`), not necessarily as `ok: false` for this single command.
- **`pause` / `resume`:** After `c.auto(AUTO_PAUSE)` or `c.auto(AUTO_RESUME)` there is likewise **no** `wait_complete`. Otherwise `wait_complete` can block so long on some LinuxCNC versions that the command channel stays locked — then e.g. `machine.abort` (while the lock is held) and clean gateway shutdown fail or appear “hung”. **`ok: true`** means: pre-checks passed and the respective `auto()` call was sent. Rejection or errors afterward: error channel and status as for `run`.
- **Mode switch before `run`** (from MANUAL/MDI to AUTO): unchanged `command.mode` + `wait_complete` (short timeout) as before.

**Preconditions (backend, gmoccapy-oriented):**

- Common: machine `STATE_ON`, `stat.enabled` true.
- **`run`:** Interpreter **`INTERP_IDLE`**; loaded program (`stat.file` not empty). Task mode **`MODE_AUTO`** (2), or **`MODE_MANUAL`** (1) / **`MODE_MDI`** (3): the gateway switches in that case to **`MODE_AUTO`** itself before `AUTO_RUN` (`command.mode` + `wait_complete`). For **MANUAL**, same as `program.mdi`: no switch with active jog/motion (`jog_active`). Unknown modes or missing file: e.g. `wrong_task_mode`, `interpreter_busy`, `no_program_loaded`.
- **`pause`:** `MODE_AUTO`; interpreter **`INTERP_READING`** or **`INTERP_WAITING`** (program running). Else `wrong_task_mode` or `not_running`.
- **`resume`:** `MODE_AUTO`; interpreter **`INTERP_PAUSED`**. Else `wrong_task_mode` or `not_paused`.

**Start line:** Parameter `startLine` (optional, default `0`) only allowed for `command: "run"`. `0` = start at file beginning; `> 0` = “run from line” (second argument to `auto(AUTO_RUN, startLine)`). Exact line number semantics match the LinuxCNC Python API / [`python-interface`](https://linuxcnc.org/docs/html/config/python-interface.html) (not guaranteed 1:1 with editor line — test with homing if needed). For `pause` / `resume`, `startLine` must not differ from `0` (else `invalid_params`).

**Mapping (Python reference):**

| `params.command` (WebSocket) | LinuxCNC |
|------------------------------|----------|
| `run` | `c.auto(linuxcnc.AUTO_RUN, startLine)` |
| `pause` | `c.auto(linuxcnc.AUTO_PAUSE)` |
| `resume` | `c.auto(linuxcnc.AUTO_RESUME)` |

| Parameter | Type | Values |
|-----------|-----|--------|
| `command` | string | `run` \| `pause` \| `resume` |
| `startLine` | number | optional, only for `run`: integer ≥ `0` (default `0`) |

**Note:** The GUI “Stop” key triggers **`machine.abort`**, not `program.auto` — see above.

**After program end:** The **`MdiManualRevertPoller`** switches LinuxCNC from `MODE_AUTO` back to `MODE_MANUAL` once the interpreter is `INTERP_IDLE` and there is no motion (as for MDI→manual), so jog and other manual functions work without a manual mode change.

**`AUTO_STEP`:** not exposed through this command currently (can be added later if needed).

#### `program.run_from_line` (removed)

Covered by **`program.auto`** with `command: "run"` and **`startLine` > 0** (see above). No separate WebSocket command.

#### `program.reset_interpreter` (planned)

Reset interpreter (`command.reset_interpreter`).

| Parameter | Type | Values |
|-----------|-----|--------|
| — | — | none |

#### `program.load_tool_table` (implemented)

Reload the tool table from the file configured in the INI (`command.load_tool_table` + `wait_complete`), analogous to gmoccapy/Tooledit “Reload”.

Preconditions (backend): machine `STATE_ON`, `stat.enabled`, interpreter `INTERP_IDLE` (as for `program.open`).

| Parameter | Type | Values |
|-----------|-----|--------|
| — | — | none |

Implementation: `handle_program_load_tool_table` in `backend/handlers/program.py` (thread pool), gateway `LinuxCncGateway.load_tool_table`.

UI, data flow, and lcncgui comment convention: [`docs/features/05_TOOL_TABLE.md`](features/05_TOOL_TABLE.md).

### `tool`

#### `tool.set_tool_offset` (planned)

Set tool geometry (`command.tool_offset`); for **touch-off at the current position** use **`tool.touch_off`** instead (gmoccapy sequence with `G10 L10`).

| Parameter | Type | Values |
|-----------|-----|--------|
| `tool` | number | tool number |
| `z`, `x`, … | number | optional, per API |

#### `tool.touch_off` (implemented)

Tool touch-off like gmoccapy [`on_btn_tool_touchoff_clicked`](https://github.com/LinuxCNC/linuxcnc/blob/master/src/emc/usr_intf/gmoccapy/gmoccapy.py): the backend runs **blocking** (one command lock, `wait_complete` between steps): `MODE_MDI` (if needed) → `G10 L10 P<tool_in_spindle> <axis><value>` → optional `G43` when length compensation is active → `MODE_MANUAL`.

| Parameter | Type | Values |
|-----------|-----|--------|
| `axis` | string | `x` … `w` (as for `motion.set_axis_coordinate`) |
| `value` | number | target on the axis per LinuxCNC semantics for `G10 L10` |

Preconditions (backend): as `program.mdi` (machine `ON`, `stat.enabled`, interpreter `INTERP_IDLE`, only `MODE_MANUAL` or `MODE_MDI`; when switching manual→MDI no active jog/motion). Additionally: `stat.tool_in_spindle` must be **> 0**. Not allowed with active **G41/G42** (`cutter_comp_active`).

Error codes include: `no_tool_in_spindle`, `cutter_comp_active`, `jog_active`, `interpreter_busy`, `wrong_task_mode`, `machine_not_on`, `machine_disabled`, `command_in_progress`, `linuxcnc_command_failed`, `command_timeout` — analogous to other MDI-based gateway operations (see also `docs/backend-frontend-messages.md` → `command_result` / `error.code`).

**Error after manual→MDI switch:** If the gateway switched from `MODE_MANUAL` to `MODE_MDI` for the sequence and then `G10 L10` or `G43` fails (or an exception occurs), it **best-effort** tries `MODE_MANUAL` again (internally `tool_touch_off_abort_manual`). If that fails, the background **`MdiManualRevertPoller`** (`backend/services/mdi_manual_revert.py`) takes over as for other MDI actions once interpreter and motion are idle again.

Implementation: `handle_tool_touch_off` in `backend/handlers/tool.py` (thread pool), gateway `LinuxCncGateway.tool_touch_off`. UI: `src/components/tools/ToolTouchOffDialog.tsx`, button in `ToolDetailsSidebar` (only when the selected tool is **in the spindle**).

#### `tool.update_tool_table_row` (implemented)

Update one row of the tool table on disk (INI `[EMCIO] TOOL_TABLE`) and reload the table in LinuxCNC **when conditions allow** (`command.load_tool_table` after atomic write) — like manual editing in Tooledit; **machine OFF** does **not** block writing, but an immediate reload may be skipped (see preconditions / `toolTableReloadDeferred`). The **frontend** sends changed values per set field; **missing** numeric parameters stay unchanged on the existing file line (merge). Only mill-style lines `T<num> P<num> … ; comment` are supported; when several lines share the same `T`, the **last** wins (as when reading comments).

Parameter names match fields in `linuxcnc_status` → `tools.tool_table` (see `LinuxCncToolTableRow` / `docs/backend-frontend-messages.md`). Field **`comment`**: optional short comment **after the first `;`** (for manual or older clients); the **Edit** dialog instead sends **`lcncgui_meta`** and **`lcncgui_presets`**: the backend writes the sidecar `<TOOL_TABLE>.lcncgui-tools.json` and sets a short comment on the `.tbl` line from `lcncgui_meta.name`. Details: [`docs/features/05_TOOL_TABLE.md`](features/05_TOOL_TABLE.md).

| Parameter | Type | Values |
|-----------|-----|--------|
| `toolno` | number | required — tool number whose line is updated |
| `new_toolno` | number | optional — when set and different from `toolno`: rename T number and sidecar entry (target must not already be taken in `.tbl` or sidecar) |
| `pocket` | number | optional |
| `diameter` | number | optional |
| `xoffset` … `woffset` | number | optional (axis offsets) |
| `frontangle`, `backangle` | number | optional (file: typically I / J per LinuxCNC convention) |
| `orientation` | number | optional (e.g. 1–4 lathe; file: typically Q) |
| `comment` | string | optional — suffix after `;` (without sidecar parameters) |
| `lcncgui_meta` | object | optional — library fields (`name`, `type`, `material`, …). **`material`:** canonical **English** strings in the file (`HSS`, `Carbide`, `Ceramic`, `Titanium coated`); web UI shows **localized** picker labels via i18n (`tools.json` → `material.*`, see [`docs/features/05_TOOL_TABLE.md`](features/05_TOOL_TABLE.md) → `meta.material`); backend does not validate. |
| `lcncgui_presets` | array | optional — preset objects (schema and discarded stubs: [`docs/features/05_TOOL_TABLE.md`](features/05_TOOL_TABLE.md) → sidecar schema) |

Preconditions (backend): **file write** — interpreter `INTERP_IDLE` (no write while a program runs), resolvable INI path and `TOOL_TABLE`; **machine OFF** is allowed. **After writing** the gateway calls `load_tool_table()` only when additionally machine **ON**, `stat.enabled`, and interpreter idle; otherwise `ok: true` with `result: { "toolTableReloadDeferred": true }` (file is still updated). Additional error codes include `tool_table_not_configured`, `tool_line_not_found`, `file_not_found`, `interpreter_busy`, `tool_already_exists` (rename: target T or sidecar entry already present).

Implementation: `handle_tool_update_tool_table_row` in `backend/handlers/tool.py`, gateway `LinuxCncGateway.update_tool_table_row`. Frontend reference: `src/api/toolTableCommands.ts`, dialog `src/components/tools/ToolEditDialog.tsx`.

#### `tool.delete_tool_table_row` (implemented)

Remove the **last** matching line `T<num> P<num> …` for the given tool number from the TOOL_TABLE file (same duplicate rule as `update_tool_table_row`) and clean the sidecar; **reload in LinuxCNC** as for `update_tool_table_row` (immediate only when machine ON, `stat.enabled`, and interpreter idle — else `toolTableReloadDeferred`).

| Parameter | Type | Values |
|-----------|-----|--------|
| `toolno` | number | required — tool number to remove |

Preconditions and error codes as `tool.update_tool_table_row` (including optional `toolTableReloadDeferred`); e.g. `tool_line_not_found` when no matching line exists.

Implementation: `handle_tool_delete_tool_table_row` in `backend/handlers/tool.py`, gateway `LinuxCncGateway.delete_tool_table_row`.

#### `tool.add_tool_table_row` (implemented)

Append a **new** line `T<num> P<num> …` at the end of the TOOL_TABLE file and reload in LinuxCNC **when conditions allow**, provided no such line for `toolno` exists yet (else same as `update_tool_table_row` for reload / `toolTableReloadDeferred`).

Parameters as for `tool.update_tool_table_row` (optional same offset/geometry/comment fields). For **add**, unknown fields (e.g. `new_toolno`) are ignored by the backend — renaming only makes sense via update. If **`pocket`** is missing → default `P` = `toolno`. Error code **`tool_already_exists`** if a line for this `toolno` already exists.

Implementation: `handle_tool_add_tool_table_row` in `backend/handlers/tool.py`, gateway `LinuxCncGateway.add_tool_table_row`. Frontend reference: `ToolEditDialog` (“New tool” mode).

## Errors / ACK

Every `command` is followed by a **`command_result`** with `ok: true` or `ok: false` and on failure `error: { code, message }` (e.g. `invalid_json`, `invalid_command_envelope`, `unknown_command`, `invalid_params`). Specific handler errors (e.g. `estop_reset_rejected` for `machine.set_task_state`) are documented in `docs/backend-frontend-messages.md` under `command_result` → `error.code`. Full field list: `docs/backend-frontend-messages.md` → `command_result` section.

## Status after commands

Every command gets a `command_result`; machine state changes also appear in the `linuxcnc_status` stream, and some handlers send `machine_event` (see `docs/backend-frontend-messages.md`).

## Not exposed as WebSocket commands (gmoccapy, intentionally omitted)

- **HAL panel pins** (`h-button`, `v-button`, analog jog): gmoccapy-specific; lcncgui exposes **three configurable HAL softkeys** (labels **14–16**) via `hal.softkey_pulse` and MPG scale via `hal.set_jog_wheel_scale` — see [`13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md`](features/13_VIRTUAL_SIDEBAR_HAL_SOFTKEYS.md) / [`01_JOG_HOME_SCREEN.md`](features/01_JOG_HOME_SCREEN.md).
- **Manual tool-change dialog** via HAL (`iocontrol` etc.): only active with **`LCNCGUI_TOOLCHANGE_HAL_ENABLED`**, otherwise the backend does not send `machine.tool_change.requested`. UI: `machine.tool_change_ack` / `machine.tool_change_abort`. Setup: [`docs/features/05_TOOL_TABLE.md`](features/05_TOOL_TABLE.md) → section “Manual tool change (HAL) …”.
- **Embedded processes / user tabs** (`Gtk.Socket`, external panels): not part of the web frontend.
- **Error channel / operator text**: covered via status stream or existing events, no separate `command`.
