# QtPlasmaC → Web Interface — Build Plan

## Context

`plan.md` sets the goal: a browser-based QtPlasmaC with full feature, look and
customisability parity, talking to a Python backend over WebSocket. The repo today holds
**nothing but two read-only references** — `reference/linuxcnc/` (1.2 GB) and
`reference/lcncgui/` (14 MB). No application code exists yet.

Exploration changed three assumptions in `plan.md`:

1. **The conversational G-code math is already Qt-free.** `plan.md` points at
   `reference/linuxcnc/src/emc/usr_intf/qtvcp/lib/qtplasmac/conversational.py` — wrong
   path *and* wrong layer. The real files are
   `reference/linuxcnc/lib/python/qtvcp/lib/qtplasmac/conv_*.py` (Qt widget wiring only)
   which delegate all geometry to **`reference/linuxcnc/lib/python/plasmac/*.py`** — 13
   modules, 3,724 lines, importing only `os`/`sys`/`math`/`gettext`/`numpy`. They need a
   shim object exposing exactly two methods (`conv_is_float`, `conv_is_int` — 120 + 5 call
   sites). **There is almost nothing to "extract".**
2. **HAL is bigger than `plasmac.*`.** `plasmac.comp` exposes 144 in-pins and 50 out-pins,
   but QtPlasmaC *also registers its own userspace HAL component named `qtplasmac`* with
   **91 pins** (`qtplasmac_handler.py:842+`), which existing `*_connections.hal` files and
   external control panels are wired to. A drop-in replacement must recreate that
   component, not just read `plasmac.*`.
3. **`lcncgui` reads HAL through `halcmd getp` subprocesses**
   (`backend/adapters/linuxcnc_gateway.py:1942`). At 50 ms × ~190 pins that is
   unusable. QtPlasmaC uses the native `hal` module (`hal.get_value` ×49,
   `hal.set_p` ×56) — we do the same.

Also confirmed: `lcncgui` has **no toolpath preview** (`MachineVisualization.tsx` renders a
"coming soon" placeholder). For plasma the preview is central, so it must be built.

**Intended outcome:** a drop-in web replacement for the QtPlasmaC screen — same HAL comp
name, same `_material.cfg`, same `.prefs`, same INI — so an existing machine switches by
changing one INI line and can switch back.

## Decisions (confirmed with user)

| Decision | Choice |
|---|---|
| Codebase shape | **Vendor `lcncgui` as the base** into repo root, add plasma layers on top |
| Compatibility | **Drop-in**: HAL comp stays `qtplasmac`, reuse existing `<machine>_material.cfg` / `<machine>.prefs` / INI |
| Milestone 1 | **Live plasma dashboard + run control** (HAL, timing, safety boundary proven first) |
| Test target | **`configs/sim/qtplasmac` on a Linux box/VM** (`sim-torch` supplies fake arc voltage) |
| Frontend stack | React + TS + Tailwind + zustand (inherited from `lcncgui`) |
| License | GPL-3.0-or-later. QtPlasmaC/LinuxCNC files are GPL-2-**or-later**, so relicensing up to GPL-3 is legal. Keep upstream copyright headers on any copied file. |

## Non-negotiable safety boundary

From `plan.md`'s "Real-Time Trap", made concrete:

- The web app is **a dashboard and a remote control only**. All reactive/timing logic stays
  in the realtime `plasmac` HAL component and the `.hal` wiring.
- The backend writes **setpoints and one-shot requests** (`plasmac.pierce-height`,
  `plasmac.torch-pulse-start`, …). It never implements a control loop, never reacts to
  `plasmac.arc-ok-out` by writing another pin.
- Pins that are realtime-owned (`plasmac.torch-on`, `.arc-ok-out`, `.z-offset-counts`,
  `.state-out`, `.thc-active`, all `*_counts`, all `_time`/`_length` statistics) are
  **read-only** in the backend. This list lives in code as an explicit allowlist/denylist,
  not as a convention.
- Loss of the WebSocket must never change machine state. Torch enable, THC enable etc. are
  latched in HAL, not in browser state.

## Architecture

```
plasma-web-interface/
├── bin/plasmacweb                    NEW  launcher (from bin/lcncgui) — LinuxCNC DISPLAY
├── backend/                          VENDORED from lcncgui, unchanged except where noted
│   ├── main.py                       EDIT register plasma handlers + publishers
│   ├── config.py                     EDIT plasma intervals, pin names, file paths
│   ├── adapters/
│   │   ├── linuxcnc_gateway.py       KEEP (jog/DRO/MDI/program/tool-table already work)
│   │   └── hal_component.py          NEW  native hal comp `qtplasmac` + plasmac.* I/O
│   ├── plasma/                       NEW  all plasma domain logic
│   │   ├── pins.py                   pin tables (91 qtplasmac + 194 plasmac), r/w policy
│   │   ├── hal_bridge.py             dedicated thread, 50 ms poll, diff → asyncio queue
│   │   ├── materials.py              <machine>_material.cfg ⇄ JSON
│   │   ├── prefs.py                  <machine>.prefs ⇄ JSON (params/enables/stats/colors)
│   │   ├── conversational.py         ConvShim → lib/python/plasmac/* shape modules
│   │   ├── toolpath.py               gcode.parse + headless canon → segment JSON
│   │   └── statistics.py             job counters, persistence to .prefs
│   ├── handlers/plasma_*.py          NEW  command-bus handlers
│   └── services/plasma_publisher.py  NEW  broadcast pin diffs
├── src/                              VENDORED from lcncgui
│   ├── screens/plasma/               NEW  Main / Parameters / Settings / Statistics /
│   │                                      Conversational / Material
│   ├── components/plasma/            NEW  ArcVoltage, ThcLeds, HeightOverride,
│   │                                      CutRecoveryPad, ToolpathCanvas, MaterialPicker
│   └── (store, hooks, ui, i18n)      REUSE
└── reference/                        UNCHANGED
```

### Vendoring rule

Copy `lcncgui`'s tree in as-is and **keep its internal names** (`backend/` package,
`lcncgui-*` env vars, `/ws` path). Renaming to `plasmacweb` everywhere is pure churn and
destroys diffability against upstream. Only the launcher script name and the
`[DISPLAY]` value are new. A rename pass is a deliberate, separate, optional commit later.

### HAL bridge — the core new mechanism

`backend/plasma/hal_bridge.py` runs in **one dedicated OS thread**, not asyncio (directly
addresses `plan.md`'s "Event Loop Conflict"):

1. On process start, **before** `hal.ready()`: create `hal.component('qtplasmac')` and all
   91 pins from `pins.py` with the exact names/types/directions QtPlasmaC uses.
2. `comp.ready()`, **then** load `[HAL] POSTGUI_HALFILE`s (lcncgui already does this —
   `docs/features/16_POSTGUI_HALFILE.md`). Order matters: `net … qtplasmac.*` lines fail if
   the comp is not ready.
3. Loop at 50 ms: read own comp pins directly (`comp['pin']`, µs-cheap) and `plasmac.*` via
   `hal.get_value('plasmac.x')`. Build a snapshot dict.
4. Diff against last snapshot; if changed, `loop.call_soon_threadsafe` a payload onto an
   asyncio queue; `services/plasma_publisher.py` broadcasts it. Full snapshot on every new
   WebSocket connect, diffs thereafter.
5. Writes arrive on a thread-safe queue and are applied in the same thread via
   `hal.set_p` / `comp['pin'] = v`, after the r/w policy check. Never write from the event
   loop.
6. Rising-edge detection for `ext_*` panel inputs mirrors
   `services/panel_hal_publisher.py`'s debounce pattern.

Off-machine (macOS/CI): `hal`/`linuxcnc` imports are guarded; a `FakeHalBridge` replays
recorded snapshot fixtures so the frontend and all pure modules are developable and
testable without LinuxCNC.

### WebSocket protocol

Reuse `backend/contracts/messages.py` verbatim — the envelope (`CommandEnvelope`,
`CommandResult`, `CommandCompletion`, `EventMessage`, `protocolVersion: 1`) already fits.
Add one category and a set of events; no protocol changes.

**Commands** — category `plasma`:
`get_snapshot`, `set_param`, `set_enable`, `material_select`, `material_save`,
`material_new`, `material_delete`, `material_reload`, `torch_enable`, `torch_pulse`,
`height_override`, `thc_enable`, `probe_test`, `consumable_change`, `cut_recovery`,
`single_cut`, `framing`, `laser_toggle`, `statistics_reset`, `conv_generate`, `conv_add`,
`conv_undo`, `conv_save`, `conv_settings`, `toolpath_parse`, `run_from_line`.

**Events** — `machine_event` with:
`plasma.pins.changed` (diff), `plasma.state.changed` (decoded `state-out`/`stop-type-out`),
`plasma.material.changed`, `plasma.material.change_requested` (autochange pin protocol),
`plasma.statistics.changed`, `plasma.error`.

Existing `motion.*`, `machine.*`, `program.*`, `tool.*` categories are untouched and keep
working.

## Milestones

### M0 — Vendor and boot (foundation)

- Copy `reference/lcncgui` → repo root (excluding `.git`, `reference`, `node_modules`).
  `git init`, initial commit "vendor lcncgui as base".
- Add `bin/plasmacweb` from `bin/lcncgui`; the sole functional change is the `LCNCGUI_ROOT`
  default and the name.
- On the Linux VM: `configs/sim/qtplasmac/qtplasmac_metric.ini` with
  `[DISPLAY] DISPLAY = plasmacweb`. Unmodified lcncgui UI must come up, jog, home, and run
  a program against the plasma sim config.
- **Exit criterion:** the vendored GUI drives the qtplasmac sim config with zero plasma
  code written. Any breakage here (4-joint XYYZ kins, 3 spindles, external offsets) is
  found before plasma work starts.
- **Done, ahead of the VM run:** the axis→joint mapping. lcncgui hard-coded X→0, Y→1, Z→2
  for homing, pre-home jogging and homed-state display, which is wrong on the sim's
  `trivkins coordinates=xyyz` (Z is joint 3, Y owns joints 1 and 2). Now derived from
  `[KINS]` via `src/lib/axisJointMap.ts`, with joint-mode jogging refused on a
  synchronised axis — the same rule QtPlasmaC applies. The backend's INI reader also
  follows `#INCLUDE`, which every QtPlasmaC config needs.

**M0 exit criterion: met** (VM run, LinuxCNC 2.9.4, `sim/qtplasmac` `qtplasmac_s_metric.ini`
with `DISPLAY = plasmacweb`; recipe and guest-access details in `docs/dev-vm.md`):

| Checked | Result |
|---|---|
| Vendored GUI boots as a LinuxCNC `[DISPLAY]` | RT stack, `plasmac` comp, `halui`, backend on `127.0.0.1:8765` and `firefox-esr -kiosk` all come up |
| POSTGUI ordering | Both POSTGUI halfiles (`custom_postgui.hal`, `sim_postgui.hal`) load before the backend and need **no** `qtplasmac.*` pins — `sim-torch` and the `qtplasmac_sim` panel run. The launcher's current order is fine until M1 creates the comp |
| INI reading | `#INCLUDE` followed; `traj_coordinates = XYYZ`, `kins_kinematics = trivkins coordinates=xyyz`, `joint_home_sequences = ["1","-2","-2","0"]` |
| Home all | 4 joints homed, Z (joint 3) parks at 95 mm |
| Home one joint | `motion.home {joint: 3}` homes **only** joint 3 — the case the old X→0/Y→1/Z→2 assumption got wrong |
| Axis jog | X +10 mm and Z −5 mm move the right axis; joint 3 follows Z |
| Joint jog | joint 3 (Z) moves in free mode; joint 1 (synchronised Y) is refused by LinuxCNC itself — *"Homing is REQUIRED to jog requested coordinate because joint (1) home_sequence is synchronized (-2)"* — which is exactly the rule the frontend now enforces up front |
| 3 spindles / external offsets | No breakage: `stat.spindle` carries all 3, `plasmac`'s `axis.[xyz].eoffset-*` nets load |

Two things the run surfaced, both fixed here:

- `get_status_snapshot` truncated `stat.homed` to three entries. It is indexed by **joint**,
  so on XYYZ the Z flag (index 3) was dropped; only the `joints[]` fallback in
  `src/utils/homing.ts` kept the display honest. Now sent per joint.
- `useBackendWebSocket` still mapped `homed[0..2]` to X/Y/Z when clearing the unhomed-jog
  hint, so homing the *second Y joint* cleared it for Z. Now goes through `isAxisHomed` and
  the `[KINS]` map.

Sim-only gotcha, not a defect: `estop_or.in0` is owned by the `qtplasmac_sim` panel and
starts engaged, so `machine.power` fails with `estop_reset_rejected` until that panel's
estop is released (or `halcmd setp estop_or.in0 0`).

### M1 — Live dashboard + run control  ← chosen MVP

- `plasma/pins.py`: transcribe the **91** `qtplasmac.*` pins (exact list already extracted
  from `qtplasmac_handler.py:842+` — `ext_*` inputs, `pmx485_*`, `material_change*`,
  `plasmac_state`, `z_height`, `vel_reduct`, `*_pierce_extent`, `ext_out_0..2`,
  `height_override`, `thc_feed_rate`, `laser_on`, `gcode_scale`, …) plus the `plasmac.*`
  in/out tables from `src/hal/components/plasmac.comp`, each tagged
  `read`/`write`/`realtime-owned`.
- `plasma/hal_bridge.py` + `services/plasma_publisher.py` per the design above.
- `handlers/plasma_pins.py`: `get_snapshot`, `set_param`, `set_enable`, `torch_enable`,
  `torch_pulse`, `height_override`, `thc_enable`.
- Frontend `src/screens/plasma/MainScreen.tsx` reproducing QtPlasmaC's MAIN tab
  (`qtplasmac.adoc:667`): DRO, arc voltage, THC up/down LEDs, torch-on indicator, sensor
  LEDs (float/ohmic/breakaway), Z height, height-override ±, cut feed rate, torch enable,
  THC enable, corner-lock/void-lock/auto-volts toggles, jog panel (reuse
  `DirectionalControl`), cycle start/pause/stop/abort (reuse existing `program.auto`
  handlers), and the STATISTICS panel (`qtplasmac.adoc:1235`).
- Decode `plasmac.state-out` / `stop-type-out` to human state names using the table in
  `qtplasmac.adoc:3974` ("QtPlasmaC State Outputs").
- **Exit criterion:** on the sim, arc voltage tracks `sim-torch`, THC LEDs and torch-on
  follow a running cut, height override writes through, and pause/stop/abort behave. Prove
  end-to-end latency: pin change → browser paint ≤ 100 ms.

**Backend half: done and verified on the sim VM.** `plasma/pins.py` (generated by
`scripts/gen_plasma_pins.py`), `plasma/hal_bridge.py`, `plasma/service.py`,
`plasma/state.py`, `services/plasma_publisher.py`, `handlers/plasma.py`.

| Checked on the VM | Result |
|---|---|
| `halcmd show comp` | `qtplasmac` user component, ready, alongside `qtplasmac_sim` |
| `halcmd show pin qtplasmac.` | 91 pins — 81 IN, 10 OUT, the exact set QtPlasmaC exports |
| POSTGUI ordering | halfiles now load *after* the backend answers HTTP, so `net … qtplasmac.*` finds the pins; `bin/lcncgui` changed accordingly |
| Snapshot on connect | 176 `plasmac.*` + 91 `qtplasmac.*` pins, decoded state `IDLE`, and the 18 pins 2.9.4 does not have listed as missing |
| `plasma.set_param` | `pierce-height` 0 → 4.2 in HAL, `plasma.pins.changed` diff followed |
| Write policy, live | `torch-on` (realtime output) and `arc-voltage-in` (HAL-driven) both refused with `pin_not_writable` |
| `plasma.torch_enable` | `plasmac.torch-enable` reads TRUE |
| Latency | HAL pin change → WebSocket message **35 ms** at a 50 ms poll, leaving the rest of the 100 ms budget to the browser |

Measured while doing it: reading all 177 `plasmac.*` pins with `hal.get_value` costs
**0.57 ms**, against 1.09 ms for a single `get_info_pins()` over all 1270 HAL pins. The
risk table's "poll hot pins fast, cold pins slow" fallback is therefore unnecessary.

Two version facts worth keeping: the sim VM runs LinuxCNC **2.9.4** while
`reference/linuxcnc` is **2.10**, so 18 `plasmac.*` pins in the table do not exist there
(`dry-run`, `pierce-type`, `torch-pulse-hold`, `torch-pulse-abort`, …). The bridge treats a
missing pin as absent — reads skip it, writes are refused with `pin_missing` — and
`torch_pulse` degrades to start/stop without hold or early abort.

**Frontend half: done and verified on the sim VM.** `src/screens/PlasmaMainScreen.tsx`
plus `src/components/plasma/*`, a `plasmaSlice` in the store, the three plasma events in
`statusMapping`, and `usePlasmaCommands` / `usePlasmaPins`.

| Checked in the VM's browser | Result |
|---|---|
| Screen renders from live pins | DRO, arc/target voltage, Z height (95.00 after homing), cut feed rate, the 11 LEDs, height override, toggles, cycle row and the statistics panel |
| Click TORCH ENABLE | `plasmac.torch-enable` reads TRUE in HAL, and the button turns active only *after* the pin diff comes back — no optimistic state anywhere |
| Missing pin | rendered as unavailable rather than as a real zero/off |
| Non-plasma machine | the screen and its sidebar entry never appear; the vendored UI is untouched |

Cycle start/pause/stop reuse the existing `ui.program.*` event bus, so they run through the
same `program.auto` / `machine.abort` path as the sidebar buttons rather than duplicating it.

**Exit criterion: met, on a running cut.** `nc_files/metric_line.ngc` (pierce at X10 Y10,
cut to X590, `M3 $0 S1` / `M5 $0`) run from the web UI on the sim, with the plasma screen
open in a browser on the host through an ssh tunnel.

| Checked on a running cut | Result |
|---|---|
| Cut sequence | `state-out` walked PROBE_HEIGHT → PROBE_DOWN → PROBE_UP → PIERCE_HEIGHT → TORCH_ON → ARC_OK → PIERCE_DELAY → CUT_HEIGHT → CUT_MODE_01 → SAFE_HEIGHT → IDLE, decoded by name in the UI at every step |
| Arc voltage | tracks `sim-torch` live in the browser (0 V idle, ~100 V through the cut), and `torch-on` / `arc-ok-out` follow it |
| THC | `thc-active` true through CUT_MODE_01, `target-volts` = cut volts, and the THC **up** LED lights in the browser while the torch climbs; dark again at idle |
| Statistics | run/probe/paused time, pierce count and cut length all advance during and after the cut |
| Pause mid-cut | torch off and arc voltage to 0 within a poll, torch retracts (MAX_HEIGHT), X frozen where it was |
| Resume | re-probes from the paused position (PROBE_HEIGHT → PROBE_DOWN), the way QtPlasmaC restarts a paused cut |
| Stop mid-probe | MAX_HEIGHT then IDLE, motion stopped, torch off |
| LinuxCNC operator errors | `top limit reached while THC moving up`, `safe traverse height has been reduced…` and a `wrong_task_mode` rejection all surfaced as UI errors rather than being swallowed |

The run found and fixed a real bug: **our component's own output pins started at zero, and
zero is not neutral for two of them.** QtPlasmaC's handler sets `gcode_scale` to 1 and
`thc_feed_rate` to `[AXIS_Z] MAX_VELOCITY * OFFSET_AV_RATIO * 60`; plasmac *divides* its
requested feed rate by `gcode_scale`, so a zero made the requested feed rate infinite, the
"running at cut speed" test never passed, `target-volts` was never set and the THC never
engaged — a cut ran with the torch height frozen and no LED ever lit. `HalBridge`
`apply_startup_values()` plus `qtplasmac_startup_values()` in `plasma/startup.py` now set
both (`thc_feed_rate` = 3600 on the sim, read from the INI), verified live in HAL.

Two things the sim needs that only M2 will provide, and which are **not** defects: plasmac's
cut parameters (`cut-feed-rate`, `pierce-height`, `arc-max-starts`, `pid-p-gain`, …) live in
QtPlasmaC's prefs file, so today they have to be `setp`-ed by hand before a cut — with
`arc-max-starts` at its zero default, plasmac pauses the program with "no arc detected after
0 start attempts" the instant it tries to fire. `docs/dev-vm.md` has the set of values that
make the sim cut. Related design point worth keeping: QtPlasmaC nets those parameters from
*qtvcp widget* pins (`qtplasmac.pid_p_gain-f`), which we deliberately do not recreate — that
is what leaves them unlinked and therefore writable by the backend's `plasma.set_param`.

Still open for later: `gcode_scale` is set once at startup and does not yet follow a program
switching units (QtPlasmaC re-scales it to 25.4 or 1/25.4 on G20/G21 against machine units).

### M2 — Materials, parameters, settings persistence

- `plasma/materials.py`: `<machine>_material.cfg` is INI-style with
  `[MATERIAL_NUMBER_<n>]` sections and exactly 14 keys — `NAME`, `KERF_WIDTH`,
  `PIERCE_HEIGHT`, `PIERCE_DELAY`, `PUDDLE_JUMP_HEIGHT`, `PUDDLE_JUMP_DELAY`,
  `CUT_HEIGHT`, `CUT_SPEED`, `CUT_AMPS`, `CUT_VOLTS`, `PAUSE_AT_END`, `GAS_PRESSURE`,
  `CUT_MODE`, `THICKNESS` (source of truth:
  `qtplasmac_handler.py:5299-5333`). Parse → JSON, write JSON → cfg preserving section
  order, with an atomic write modelled on `_atomic_write_text_file`
  (`linuxcnc_gateway.py:438`). Reject material numbers ≥ 1000000; support temporary
  materials (magic-comment materials via the `material_temp` pin,
  `qtplasmac.adoc:1470`).
- Material change protocol: honour `material_change`, `material_change_number`,
  `material_change_timeout`, `material_reload`, `material_temp` so automatic material
  handling (`qtplasmac.adoc:1441`) works with unchanged G-code.
- `plasma/prefs.py`: `<machine>.prefs` sections — `PLASMA_PARAMETERS` (27 keys: Arc Fail
  Timeout, Arc OK High/Low, Arc Voltage Scale/Offset, Pid P/I/D Gain, THC Delay/Sample
  Counts/Sample Threshold/Threshold, Setup/Offset Feed Rate, Skip IHS Distance, Slat
  Height, Spotting Threshold/Time, Scribe Arming/On Delay, Ohmic Probe Offset/Maximum
  Attempts, Velocity Anti Dive Threshold, Void Sense Slope, Y Pierce Offset, Arc Maximum
  Starts, Arc Restart Delay), `ENABLE_OPTIONS` (6), `GUI_OPTIONS` (19), `STATISTICS` (8),
  `COLOR_OPTIONS`, `POWERMAX`, `OFFSET_PROBING`, `CAMERA_OFFSET`, `LASER_OFFSET`,
  `SINGLE CUT`, `BUTTONS`, `CONVERSATIONAL` (8 keys, `conv_settings.py:60-101`).
- Screens: `MaterialScreen`, `ParametersScreen` (`qtplasmac.adoc:936`), `SettingsScreen`
  (`qtplasmac.adoc:1127`). Reuse `components/numeric` touch keypad and
  `evaluateNumericExpression`.
- On material select, write the material's values to the corresponding `plasmac.*`
  setpoints, matching QtPlasmaC's `change_material` behaviour.
- **Exit criterion:** an existing machine's `_material.cfg` and `.prefs` round-trip through
  the web UI byte-comparably (modulo intentional edits), and QtPlasmaC can still open them
  afterwards.

**Done and verified on the sim VM.** `plasma/machine_files.py`, `plasma/materials.py`,
`plasma/parameters.py` and `plasma/config_service.py` on the backend; `PlasmaScreen` with its
MAIN / MATERIAL / PARAMETERS tabs on the frontend.

Both files are read and written through `configparser.RawConfigParser` with
`optionxform = str` — the same class qtvcp's `Access` uses — so key case survives and the
output is byte-identical to what QtPlasmaC writes. Writes go through a temp file in the same
directory, so a crash cannot truncate a machine's config.

| Checked on the VM | Result |
|---|---|
| The shipped `qtplasmac-metric.prefs` | read as-is: `Pid P Gain` 10, `Arc Maximum Starts` 3, `Setup Feed Rate` 2880, `Safe Height` 25 all land on their `plasmac.*` setpoints at startup |
| Machine with no material file | material 0 written as QtPlasmaC's updater would (`4000 mm/min`, `99 V`, 3 mm pierce), then selected — so the cut parameters are real rather than zero |
| `[ENABLE_OPTIONS]` | `THC enable`, `Corner lock enable` and `Use auto volts` restored to their pins; flipping a toggle in the UI is written back |
| A cut, with **no `halcmd setp` at all** | probe → pierce → arc at 100 V → `thc-active` for 162 samples with `target-volts` learned at 100.08 → torch held at cut height → 580 mm cut, `pierce-count` 1 |
| MATERIAL tab, new material | `NEW` → name, `CUT_VOLTS` 137 → `SAVE` wrote `[MATERIAL_NUMBER_1]` in QtPlasmaC's exact format; selecting it put 137 on `plasmac.cut-volts` and 1 on `qtplasmac.material_change_number` |
| PARAMETERS tab | `Pid P Gain` 10 → 12.5 saved to the file *and* to the pin, with all 11 other prefs sections untouched |
| **Real QtPlasmaC opening our files** | `qtplasmac_s_metric.ini` (QtPlasmaC v2.9-238.315) started on the same config, showed `MATERIAL = 00000: Default` with `FR 4000 / PH 3.00 / CH 1.00 / KW 1.00`, and the anti-dive and auto-volts toggles lit — and both files were **byte-identical** afterwards |

The material change protocol is upstream's handshake, not a notification: `M190` raises
`qtplasmac.material_change`, writes the number it wants, and then polls
`motion.digital-in-03` for half a second before reporting a failed material change. Answering
it means writing pins HAL calls inputs — QtPlasmaC does the same with the pins it owns — so
those six pins carry an `OWNED_ACK` policy in the generated table rather than a hole in the
write check, and the one pin outside our two components goes through a one-entry allowlist.

Two upstream details worth keeping. QtPlasmaC's `read_one_material` *divides* its defaults by
`unitsPerMm`, which on an imperial machine defaults a 1 mm kerf to 25.4 inches; ours multiply,
so a missing key gets a sane value instead. And QtPlasmaC's `Pid P Gain` spinbox has no
decimals, so the 12.5 we saved came back as 13 on its pins — the file keeps 12.5, and this is
its widget precision rather than a disagreement about the value.

Deliberately not built: `GUI_OPTIONS`, `COLOR_OPTIONS`, `BUTTONS`, `CAMERA_OFFSET`,
`LASER_OFFSET`, `SINGLE CUT` and `CONVERSATIONAL`. Those configure QtPlasmaC's *own* widgets
(estop button style, DRO position, custom stylesheet, its user buttons), and this UI has its
own settings screen; writing them would be storing settings that change nothing here. They
are preserved on save, which is what matters for running both against one config. `POWERMAX`
and the RS485 link belong with M5, and the conversational settings with M4.

### M3 — Toolpath preview, program load, run from line

- `plasma/toolpath.py`: a headless canon subclassing `rs274.interpret.Translated` +
  `ArcsToSegmentsMixin`, collecting `straight_traverse` / `straight_feed` / `arc_feed` /
  `next_line` into a segment list, driven by `gcode.parse(path, canon, …)` (the same entry
  point `rs274/glcanon.py:1459` uses). No OpenGL. Emits
  `{segments:[{kind:'rapid'|'feed', pts:[[x,y,z]…], line:n}], extents, units}`. This reuses
  LinuxCNC's real interpreter, so subroutines, parameters, G-code offsets and
  QtPlasmaC's own magic comments are all handled correctly for free.
- `src/components/plasma/ToolpathCanvas.tsx`: 2D top-down Canvas2D render (pan/zoom,
  rapid vs cut colouring, live torch position from the coordinate stream, click-a-segment
  to pick a line). Replaces lcncgui's `MachineVisualization` placeholder. Views per
  `qtplasmac.adoc:905`.
- Program load path: the existing `[FILTER] ngc = qtplasmac_gcode` filter
  (`src/emc/usr_intf/qtplasmac/qtplasmac_gcode.py`, 1,629 lines) is invoked by LinuxCNC
  itself, not the GUI — **nothing to port**, it keeps working. Verify it does.
- Run From Line: `lib/python/plasmac/run_from_line.py` is pure (361 lines) — wrap
  `run_from_line_get` / `run_from_line_set` behind `plasma.run_from_line`, supporting both
  HERE TO END and THIS CUTPATH (`qtplasmac.adoc:2341`).
- **Exit criterion:** load a plasma sample from `nc_files/plasmac`, preview matches
  QtPlasmaC's preview visually, and run-from-line restarts mid-cut correctly on the sim.

**Done and verified on the sim VM.** `plasma/toolpath.py` and `plasma/run_from_line.py` on the
backend, `components/plasma/ToolpathCanvas.tsx` plus a PREVIEW tab on the frontend, and the
machine view on the home screen now draws the same preview instead of the placeholder.

| Checked on the VM | Result |
|---|---|
| `metric_squares.ngc` | `o100 repeat [3]` expanded by the interpreter: three concentric squares, 34 points, extents 0→150 mm in X and Y |
| `metric_wrench.ngc` | arcs and `#<holes>`: the outline and its hole, 399 points, extents 0→153.7 × 52.4 mm — the program's own numbers |
| Rapids vs cuts | traverses dashed and grey, cuts solid, torch drawn at the live machine position |
| Tap a cut | picks its source line (the hole's `G3` reported as line 15), and only cuts are hit-tested |
| HERE TO END from line 15 | `rfl.ngc` written with the modal replay (`G21`, `G64`, `M52`, safe-Z retract), positioned at X149.739 Y27.45, then loaded |
| Running it on the sim | probe → pierce → CUT_MODE_01 for 6 s with THC active, cut length 395.87 mm, one pierce, finished at `M2` and back to IDLE |
| THIS CUTPATH on 2.9.4 | refused with "this LinuxCNC's helper cannot stop at the end of a cut; use here to end" — see below |
| `[FILTER] ngc = qtplasmac_gcode` | still applied by LinuxCNC itself on open; nothing to port, and the filtered program is what the preview parses |

Four things the interpreter forced into the open, none of them guessable from the docs:

* **The canon is read as well as called.** `gcode.arc_to_segments` reads `lo`, `plane`,
  `rotation_cos/sin` and the nine g5x/g92 offsets straight off the canon object
  (`gcodemodule.cc:1457`). With a catch-all `__getattr__` absorbing the callbacks we ignore,
  those reads returned *functions*, and every program containing an arc failed with
  `parse_file interp_error` — while arc-free programs previewed perfectly.
* **Canonical length units are inches**, whatever the program says. AXIS divides machine
  values by `linear_units * 25.4` to get there (`glcanon.py:1086`); the preview multiplies
  back, so a 590 mm line reads 590 mm and not 23.2.
* **`[RS274NGC] FEATURES` decides whether `#<_hal[…]>` resolves**, and the interpreter reads it
  from the INI named in the environment. Every QtPlasmaC program begins with
  `F#<_hal[plasmac.cut-feed-rate]>`, so without `INI_FILE_NAME` set for the parse, a preview is
  one immediate error.
* **The installed helper is older than the reference tree.** 2.9.4 ships
  `run_from_line_get(file, startLine)`; the `lastLine` argument that bounds a single cut is
  2.10. Dropping it silently would turn THIS CUTPATH into HERE TO END — on a machine that then
  keeps cutting past the cut the operator picked — so the capability is checked and the
  operator is told instead.

One deliberate difference from upstream: `rfl.ngc` is written into `[DISPLAY] PROGRAM_PREFIX`
rather than `/tmp/qtplasmac`, because `program.open` only loads files under that prefix — a
guard worth keeping with a browser on the other end of it — and it leaves the generated program
where the operator can see it.

### M4 — Conversational

- `plasma/conversational.py`: a `ConvShim` with `conv_is_float` / `conv_is_int` copied from
  `conversational.py:531-544`, plus temp-file plumbing (`fTmp`, `fNgc`, `fNgcBkp`) and a
  `generate(shape, params) -> {gcode, error}` façade over
  `lib/python/plasmac/{line,circle,ellipse,triangle,rectangle,polygon,bolt_circle,slot,star,gusset,sector,block}.py`.
  Each module's `preview(Conv, fTmp, fNgc, fNgcBkp, …)` signature maps 1:1 to a JSON
  schema per shape.
- Handle the `gettext` quirk: those modules run `gettext.install("linuxcnc", localedir=…)`
  at import, deriving `localeDir` by scanning `sys.path` for `/lib/python`. On a LinuxCNC
  install this works; off-machine, pre-install a no-op `_` builtin before import.
- `ConversationalScreen` with per-shape forms, live preview through `ToolpathCanvas`
  (M3 dependency), add/undo/save-job, plus the block/array operations
  (`qtplasmac.adoc:2789`) and conversational settings (`:2667`).
- **Exit criterion:** golden tests — for each shape, our API output is byte-identical to
  calling the reference `plasmac` module directly with the same inputs.

**Shapes done and verified on the sim VM.** `plasma/conversational.py` plus a CONVERSATIONAL
tab. The exit criterion is met the only way that means anything: the golden tests import the
reference `plasmac` modules (pure Python, so they run off the machine too) and compare our
façade's output byte for byte — circle, rectangle, polygon, star, slot, bolt circle and sector,
including the multi-shape job case.

**The function signature is the schema.** Parameters are read off each module's `preview()` with
`inspect`, so the backend has no copy of the parameter lists and neither does the UI: the form
is built from what the installed LinuxCNC actually takes. A machine whose modules differ renders
a different form rather than silently dropping a field.

| Checked on the VM | Result |
|---|---|
| Shape list | all ten shapes, `ellipse` included (it needs numpy, which the sim has) |
| Circle form | geometry only — kerf, leadin, leadout, hole diameter and hole speed come from the material and `[CONVERSATIONAL]`, as they do upstream |
| PREVIEW | generated and drawn on the canvas, through the M3 preview parsing the unsaved text |
| ADD then a second shape | the job carried through: one preamble, both shapes, one postamble |
| SAVE | written to `nc_files/conversational.ngc` and loaded — `M190 P0`, `M66 P3 L3 Q1`, `F#<_hal[plasmac.cut-feed-rate]>`, `M3 $0` / `M5 $0` per shape |
| Machine off | `SAVE` refused with LinuxCNC's own precondition ("machine must be ON"), not a silent failure |

Two upstream quirks handled: the shape modules run `gettext.install` at import and derive their
locale directory by scanning `sys.path` for `/lib/python`, raising `NameError` where there is
none; and a shape whose own dependency is missing drops out of the list rather than taking the
others down with it. A shape rejecting its input ("DIAMETER cannot be zero") comes back as a
message for the operator rather than a failed command.

**Lines, arrays and the settings: done and verified on the sim VM.**

The line builder replays upstream's own per-press sequence for a whole list of segments, each
starting where the last ended, and its golden test compares byte for byte against that sequence.
`next_segment` is deliberately unused: it reopens a file by truncating at the first `M05 $0`,
which on a job that already contains a shape would throw that shape's cut away.

The array is `block.preview`, and it is where the two LinuxCNC generations differ most. 2.9.4
takes `cOffset`/`rOffset`, its own `convMirror`/`convFlip` bookkeeping, plus `fTmp`, `g5xIndex`
and `convUnits`; 2.10 takes `cSpacing`/`rSpacing`, `doMirror`/`doFlip`, a `window` and
`isConvBlock`. So the parameter list is reported to the UI and the panel is built from it —
which is why the screenshot on the sim says "Column offset" and "Mirror state" rather than the
2.10 names compiled into anything.

| Checked on the VM | Result |
|---|---|
| Line: point + radius arc from (20, 20) | generated, drawn on the canvas, one pierce and one `M05 $0` for the whole cut |
| ADD then ARRAY, 3 × 2 at 150 / 120 | six copies drawn, `;conversational block` written with upstream's own named parameters |
| Array panel fields | `columns`, `rows`, `cOffset`, `rOffset`, `convMirror`, `convFlip`, `convMirrorToggle`, `convFlipToggle` — 2.9.4's list, read off the machine |
| SETTINGS: `Leadin` 0 → 4.5 | written to `[CONVERSATIONAL]` in the prefs, and used by the next generated shape |

Two more version skews found the same way as the earlier ones. 2.9.4's
`line.first_segment` takes an extra `lineType` its body ignores (upstream passes the GUI's
line-type combo text), so the call is made by keyword and the argument supplied only when the
signature has it. And `block.get_midpoints` measures a qtvcp preview *widget* in 2.10; a centre
is a measurement rather than a decision, so it is measured off the toolpath preview and handed
to upstream by replacing that one function for the duration of the call, under a lock.

M4 is complete.

### M5 — Advanced feature parity

Ordered by machine value, each independently shippable: probing and offset probing
(`:1908`, `:1946`), cut recovery (`:2302`), consumable change, single cut (`:2171`), hole
cutting incl. automatic (`:2019`, `:2114`), THC tuning and auto-volts (`:1840`, `:3851`),
velocity/void anti-dive (`:1807`, `:3916`), mesh mode (`:2261`), ignore arc OK (`:2275`),
scribe (`:2408`), spotting (`:2467`), tube cutting (`:2513`), laser and camera offsets
(`:1615`, `:1673`, `:3691`), moving pierce — wiggle and ramp (`:4086`), user buttons from
`[QTPLASMAC] BUTTON_n_NAME/CODE` (`:3200`, ~490 doc lines of button code semantics),
PowerMax RS485 comms (`:4020`, port `pmx485-test.py`), external HAL pins (`:3753`),
keyboard shortcuts (`:2542`), error logging and critical/warning messages (`:2834`).

### M6 — Look, feel, customisability

- Port `qtplasmac.style` (21 KB Qt stylesheet) semantics to CSS custom properties so the
  existing colour options in `.prefs` `COLOR_OPTIONS` drive the web theme — same knobs,
  same names (`:3017`–`:3128`).
- Layout variants matching the three shipped screens: 16×9, 4×3, 9×16
  (`share/qtvcp/screens/qtplasmac{,_4x3,_9x16}`), as responsive breakpoints.
- Virtual keyboard custom layouts (`:2525`), tooltips (port `tooltips.py`, 548 lines),
  i18n (`:4213`) through the existing `react-i18next` setup.

## Files to create / modify

**New (backend):** `backend/adapters/hal_component.py`,
`backend/plasma/{__init__,pins,hal_bridge,materials,prefs,conversational,toolpath,statistics}.py`,
`backend/handlers/plasma_{pins,material,conversational,toolpath}.py`,
`backend/services/plasma_publisher.py`, `bin/plasmacweb`.

**Edited (vendored):** `backend/main.py` (register handlers on the existing `CommandBus`,
start/stop the publisher in `lifespan` — follow the exact pattern at `main.py:96-207`),
`backend/config.py` (add `PLASMA_*` intervals, comp name, file-path resolution),
`backend/adapters/linuxcnc_gateway.py` (extend `_read_ini_into_result` for the
`[QTPLASMAC]` section — do not restructure it).

**New (frontend):** `src/screens/plasma/*`, `src/components/plasma/*`,
`src/api/plasmaCommands.ts`, `src/store/plasmaSlice.ts`, `src/locales/en/plasma.json`.

**Reused as-is — do not reimplement:** `linuxcnc_gateway.py` (jog, homing, MDI, program
open/run, tool table, error channel, INI parsing, atomic file writes),
`application/command_bus.py`, `contracts/messages.py`, `ws/connection_manager.py`,
`api/ws.py`, `frontend_static.py`, `useBackendWebSocket`, `machineSlice`,
`components/numeric`, `components/ui`, `DirectionalControl`, `ProgramEditor`,
`evaluateNumericExpression`, `formatCoordinates`, and every module in
`reference/linuxcnc/lib/python/plasmac/`.

## Verification

**Off-machine (macOS, every commit):**
- `pytest backend/tests` — pure modules only: materials round-trip, prefs round-trip, pin
  table policy (no realtime-owned pin is writable), conversational golden tests against the
  reference `plasmac` modules, toolpath canon against recorded `gcode.parse` fixtures.
- `npm test` (vitest) for stores/hooks/components; `npm run lint`.
- `npx playwright test` against the `FakeHalBridge` replaying recorded snapshots — use the
  Playwright MCP headless (per global rules), not claude-in-chrome.

**On the Linux VM (each milestone):**
0. Deploy and start per `docs/dev-vm.md` (the Mac cannot reach the VM over IP yet, so the
   UTM guest agent is the transport).
1. `linuxcnc ~/linuxcnc/configs/qtplasmac/plasmacweb_metric.ini` (a copy of
   `qtplasmac_s_metric.ini` with `DISPLAY = plasmacweb`).
2. `halcmd show pin qtplasmac` — all 91 pins present with correct types/directions;
   `halcmd show pin plasmac` — no unconnected pin that QtPlasmaC connects.
3. Side-by-side against real QtPlasmaC on the same config: same material values applied to
   the same `plasmac.*` pins after selecting the same material (`halcmd getp` diff).
4. Cut a sample from `nc_files/plasmac` on the sim: arc voltage, THC LEDs, torch-on,
   statistics increment, pause/resume/abort, cut recovery.
5. Latency probe: toggle `sim:arc-ok` via `halcmd setp` and timestamp the browser update —
   assert ≤ 100 ms.
6. Restart QtPlasmaC afterwards on the same config to prove the drop-in claim: config,
   material file and prefs still load unmodified.

## Risks

| Risk | Mitigation |
|---|---|
| `hal.get_value` name-lookup cost at 20 Hz × ~190 pins | Own comp pins read via `comp['pin']`; measure early in M1; if `plasmac.*` lookups dominate, poll hot pins at 50 ms and cold pins at 500 ms |
| HAL comp must be ready before POSTGUI HAL files | Explicit ordering in the launcher/lifespan; M0 exit criterion tests it |
| Sim config is 4-joint XYYZ with 3 spindles and external offsets — lcncgui may assume simpler kins | That is exactly what M0 exists to surface, before any plasma code |
| Feature surface is genuinely large (6,431-line handler, 643 widgets, 4,726-line manual) | Milestones are independently shippable; M1–M4 is a usable machine, M5/M6 is the long tail |
| `qtplasmac_gcode` filter assumptions about the GUI | It is run by LinuxCNC, not the GUI; verified in M3 |
| Browser as the only UI on a cutting machine | Physical e-stop and HAL-latched enables remain authoritative; kiosk browser autostarts from the launcher as lcncgui already does |
