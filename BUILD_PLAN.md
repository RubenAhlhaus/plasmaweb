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
1. `linuxcnc configs/sim/qtplasmac/qtplasmac_metric.ini` with `DISPLAY = plasmacweb`.
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
