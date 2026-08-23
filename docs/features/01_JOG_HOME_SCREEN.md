# 01_JOG_HOME_SCREEN

## Description
Jogging the machine via the jog buttons on the Home screen. The user can move axes X, Y, and Z either continuously or incrementally. Jog mode and increments are selected with `IncrementSelector`.

## UI interaction
- The Home screen uses a **two-column layout** (via [`MachinePreviewColumn`](../../src/components/MachinePreviewColumn.tsx) and shared classes in [`machineScreenLayoutClasses.ts`](../../src/lib/machineScreenLayoutClasses.ts)): machine preview on the left; jog controls on the right. **Below ~1280px viewport width (`xl`)** the columns **stack vertically** (preview → jog → MDI). The preview block height is **capped** when stacked so **`MDIConsole`** keeps usable space; the second grid row fills the remaining viewport height.
- **Left preview column:** top row (in document flow, not overlaid on the visualization): **`CoordinatesDisplay`** and **`ProgramCodesDisplay`** side by side with wrap; center: **`MachineVisualization`** (placeholder SVG plus **“Coming soon!”** until a G-code viewer replaces it); footer: **`ToolInfoDisplay`** plus **spindle/feed** gauges (the two gauges stay grouped as a pair when the footer wraps).
- On the right column, **`IncrementSelector`** sits to the **left** of the **`DirectionalControl`** pad (same row; **compact by default**, **full size** in the two-column layout when the right column is **≥520px** wide — measured via `ResizeObserver` in [`useJogPanelSize`](../../src/hooks/useJogPanelSize.ts), constant [`JOG_CONTROL_FULL_MIN_WIDTH_PX`](../../src/lib/jogControlSize.ts)). The panel exposes **`data-jog-size="full"`** or **`"compact"`** on `[data-e2e="home-jog-panel"]` for debugging; **`MDIConsole`** fills the space below:
  - The central pad represents X and Y directions:
    - Top: Y+
    - Bottom: Y-
    - Left: X-
    - Right: X+
  - To its right are two vertically stacked buttons for Z:
    - Top: Z+
    - Bottom: Z-
- The user:
  - Selects jog mode in `IncrementSelector`:
    - **Continuous** / **Kontinuierlich** (localized via `components:jogIncrements.continuous`) for continuous jogging.
    - One of the listed steps for incremental jogging.
  - Presses a jog button to move the machine along the chosen axis and direction.
  - **Continuous mode (hold-to-jog):** Hold a direction button to jog; release to stop. Touch long-press must not open a context menu (details under Edge cases). Direction buttons expose stable `data-e2e` ids (`jog-x-positive`, `jog-y-negative`, …) and localized `aria-label`s via `components:jogDirectional.*`.

## Preconditions
- WebSocket connection to the backend is established (`connectionStatus === "connected"`).
- The machine is in a state where jogging is allowed:
  - **On the frontend**, `useJogPreconditions` / `DirectionalControl` only checks the mapped store status (`evaluateJogPreconditions` in `src/hooks/useJogPreconditions.ts`): jog buttons are active when
    - `task_state === STATE_ON` (machine ON),
    - neither `STATE_ESTOP` nor `machine.error === true` (hardware/software E-stop),
    - `task_mode === TaskMode.MODE_MANUAL`.
  - There is **no** separate fallback via a raw `machine.mode` field; if `task_mode` is missing or wrong, the machine counts as “not in manual mode” and the buttons stay disabled.
  - Otherwise jog buttons are disabled and the pad shows a tooltip with the reason (e.g. “Machine off”, “Jogging only possible in manual mode”, “E-stop active”).
- For incremental jogging, a valid increment is selected in `IncrementSelector` (increment selection is independent of the states above).
- For jogging in **axis mode** (Cartesian), the respective axis must already be homed. If an axis is not homed, a hint dialog is shown before the first jog attempt per homing cycle, then jogging continues in **joint mode**.

## Event order
- User clicks a jog button in `DirectionalControl`.
- The component publishes `jog.move` or `jog.stop` over the event bus (`UiJogRequest` as in `src/api/jogTypes.ts`).
- In `App.tsx`, **`useJogEventSubscription`** (`src/hooks/useJogCommand.ts`) subscribes to these events and internally calls handlers from **`useJogCommand`** / **`useJogStopCommand`**. Logic in the `useJogCommand` callback:
  - Reads `jogMode` and `selectedJogIncrement` from the global store.
  - Reads current LinuxCNC status (`linuxCncStatus.motion.homed` / joints) and a UI flag whether the hint dialog was already shown for this axis.
  - Checks whether the requested axis is already homed:
    - **homed** → jog in axis mode (`jointMode: false`).
    - **not homed** and hint dialog for this axis **not** yet shown → **no** `motion.jog` is sent; instead the hook fires `ui.unhomed_jog.confirm` with the jog request.
    - **not homed** and hint dialog for this axis already shown → jog in joint mode (`jointMode: true`).
  - Maps the axis to an index (`x → 0, y → 1, z → 2`).
  - Builds the `params` payload for the `motion.jog` command:
    - `jointMode: false` for homed axes (axis mode).
    - `jointMode: true` for unhomed axes after confirming the hint dialog (joint mode).
    - `index: 0 | 1 | 2`
    - `velocity: number` (sign per direction) — magnitude from store `jogVelocityMmPerMin` (**mm/min**, same unit as programmed feed); default **100 mm/min**
    - `mode: "continuous"` or `"increment"`
    - `distance?: number` (only for `"increment"`, from `selectedJogIncrement`)
  - Calls `sendCommand('motion', 'jog', params)` and sends a `CommandEnvelope` over WebSocket:
    - `type: "command"`
    - `category: "motion"`
    - `action: "jog"`
    - `params: { ... }` as above.
- The backend receives the `motion.jog` command and translates it into `linuxcnc.command().jog(...)` calls.
- Machine state changes are streamed back to the frontend via `linuxcnc_status` events.

## User feedback
- The user sees machine position change in the coordinate display on the Home screen once the backend sends updated status.
- With incremental jogging, the user can estimate per click how far the axis moves from the coordinates.
- If the user tries to jog an **unhomed axis**, a dialog appears once per axis and homing cycle explaining that joint mode will be used and individual motors move directly. After confirmation, further jog commands for that axis run in joint mode until the axis is homed again.
- On connection issues (no WebSocket), the buttons currently show no explicit error; future versions may add toasts or disabled states.

## Edge cases
- **Continuous jog on a touch panel / long-press:** Without suppression, the OS/browser long-press gesture would show a context menu (as if right-clicking) and typically cancel the pointer → jog would stop. In **continuous** mode only, `DirectionalControl` suppresses `contextmenu` (`preventDefault` on pointer down and on `contextmenu`) and applies `touch-action: none` / no touch callout on the direction buttons so hold-to-jog works until release. Incremental mode does not apply those hold-specific classes or handlers.
- Jog buttons pressed while WebSocket is not connected:
  - The command is not sent; there is currently no explicit user warning.
- Incremental jog mode with unusually small or large increment values:
  - The command is sent with the corresponding `distance`; limit and safety checks happen in the backend.
- `[DISPLAY] INCREMENTS` from the active LinuxCNC INI is passed to the frontend as `jog_increments_spec`. Supported formats:
  - Comma-separated with a space before the unit: `1 mm, 0.5 mm, 0.1 in`
  - gmoccapy/PNCconf style, space-separated with glued unit: `10mm 5mm 1mm .1mm`
  - Parsing lives in `src/lib/jogIncrements.ts`; invalid tokens are dropped silently.
  - At most **four** increment buttons are shown (plus the localized **Continuous** tab); extra INI values are ignored.
- **MPG / jogwheel HAL scale:** While the WebSocket is connected, the selected increment (`selectedJogIncrement`, machine units) is written to HAL `axis.x/y/z.jog-scale` via `hal.set_jog_wheel_scale` (same role as gmoccapy’s `jog-increment` pin). The physical wheel therefore moves by the step shown in `IncrementSelector`. In **Continuous** UI mode the last selected increment value is still used for the wheel. Override pin list with env `PLASMAWEB_JOG_WHEEL_SCALE_PINS` (comma-separated). Hook: `useJogWheelScaleSync` in `App.tsx`. Failed HAL writes (missing pins / no `halcmd`) are treated as optional (`noop`, no error toast) so Connect/E2E without an MPG setup stays quiet; the hook also skips re-sending the same scale.
- Rapid repeated clicks on jog buttons:
  - Multiple `motion.jog` commands are sent; the backend decides how to queue or limit them.

## Errors
- Backend rejects `motion.jog` (e.g. due to E-stop, limits, invalid parameters):
  - Response as **`command_result`** with `ok: false` and `error: { code, message }` (see `docs/backend-frontend-messages.md`).
  - The frontend shows the message as a **global error toast** (`useBackendWebSocket` → `showErrorToast`).
- Invalid or inconsistent jog parameters (e.g. missing `distance` for `"increment"`) are validated by the backend and typically return `error.code` = `invalid_params`.

## Spindle and feed circular gauges (dialogs)

In the **footer of the left preview column** on the Home screen (and the same column on Program), two `SliderControl` widgets show **spindle** and **feed rate** as a **paired group** (they stay adjacent when the footer wraps). A click on the **entire circular area** opens a global dialog (`SpindleFeedDialogsHost` in `App.tsx`):

**Circular gauge (`SliderControl`):**

- **Ring (percent):** spindle and feed overrides as in LinuxCNC (`spindle[0].override`, `overrides.feedrate`, each 0–200 % in the UI).
- **Large number:** **effective** spindle RPM = programmed **S** × spindle override when override is enabled (`program.settings[2]` × `spindle[0].override`; if `spindle[0].override_enabled` is `false`, factor **1**). When S is unset/zero, falls back to `|spindle[0].speed|` **without** re-applying override (status speed may already be commanded/effective). Shown as an **integer**. Feed: **effective** value = programmed **F** × feed override (`program.settings[1]` × `overrides.feedrate`), also shown as an **integer** (no long fractional tails from float/override).

**Dialogs (settings):**

- Both dialogs are **wide** (`max-w-5xl`), **two columns** from large viewport width: left numeric entry with calculator (`TouchNumericEntry`, preview **`= …`**, **=**, integers only on the pad), right **override (percent)** with slider(s) and **Apply override** button(s). The feed dialog includes **feed override** (1–200 %), **rapid override** (0–100 %), and a **jog speed** slider (**mm/min**, range **1–1000**, picker step **1**, slider step **10**) stacked in the right column; one **Apply overrides** button sends feed and rapid only. Jog speed is a **session-local UI setting** (`jogVelocityMmPerMin` in the store): changing the slider or its numeric picker **applies immediately** for the next `motion.jog` (no LinuxCNC override command). Next to each override / jog slider, the **current value** is a tappable control ([`TouchNumericPickerField`](../../src/components/numeric/TouchNumericPickerField.tsx) in [`OverrideSliderSection`](../../src/components/SpindleFeedOverrideSliderSection.tsx)): click opens a **sub-dialog** with the same touch keypad as elsewhere; enter e.g. `100` (no `%` / unit suffix required) and **OK** updates the slider — for feed/rapid percent the value is **not** sent to LinuxCNC until **Apply override** / **Apply overrides**; for jog speed **OK** writes the store immediately. Valid ranges: spindle and feed override **1–200 %**, rapid override **0–100 %**, jog speed **1–1000 mm/min** (out-of-range shows an error in the sub-dialog). **Escape** closes the sub-dialog first, then the main override dialog (`useTouchNumericModalEscapeStack`). Buttons **Set speed** / **Set feed** and **Apply override** have a large minimum height for touch; **Close** is also taller/more touch-friendly than a default button but lower than the three primary actions. The wide dialog shell scrolls vertically when content exceeds the viewport (including large/`lg` layouts), so feed override, rapid override, and jog speed remain reachable.
- **Spindle:** **Set speed** sends MDI `S… ; …` internally (`program.mdi` via `useSendMdiCommand`; comment from `spindleFeed.rpmLabel`, e.g. `S5000 ; Speed (rpm)`). On **successful** `command_result`, the line is appended to **MDI history** and the dialog closes; on error no history entry. **Apply override** → `machine.spindle_override`. Initial values include `program.settings[2]`, `spindle[0].override`. On override failure an error toast is shown. **Set speed** is disabled when MDI is not possible or input is invalid. When disabled, **hover** (`title` on the wrapper) and **assistive tech** (`aria-describedby` + hidden text) give the same short everyday explanation (without MDI jargon); with multiple blockers a **compact list** (e.g. with “·”).
- On open, the numeric field is **focused and its content selected**; first keyboard input replaces the value; the **first** pad key also replaces the previous value (then normal append). **Enter** in the dialog performs the same step as **Set speed** / **Set feed** when possible and focus is not on another button or the override slider.
- **Feed:** **Set feed** sends MDI `F… ; …` (comment from `spindleFeed.feedLabel`, e.g. `F1200 ; Feed (mm/min)`); same **MDI history** behaviour as **Set speed** and **Apply preset**. **Apply overrides** sends `machine.feed_override` and `machine.rapid_override` together. Initial values: `program.settings[1]`, `overrides.feedrate`, `overrides.rapidrate`. On override failure an error toast is shown; the dialog closes only after both overrides succeed. **Set feed** disabled for invalid input; hints like spindle (hover + ARIA, multiple reasons compact). The **jog speed (mm/min)** control under the rapid override sets how fast continuous and incremental button jogs move; it does not change programmed feed **F** or feed/rapid overrides.

Circular gauge value derivation is bundled in `useSpindleFeedSlidersFromStatus` (including `effectiveSpindleRpm` and `effectiveFeedRateMmMin`).

After a successful `command_result`, dialogs close automatically. Command details: [`docs/commands-events.md`](../commands-events.md) (`program.mdi`, `machine.spindle_override`, `machine.feed_override`, `machine.rapid_override`).

## Active tool (preview column footer)

In the preview column footer, **`ToolInfoDisplay`** (`src/components/ToolInfoDisplay.tsx`) shows the **active tool card**. A click opens a dialog with the same details as in the overview (ID, diameter, material, flutes, comment if any).

- **Cutting preset:** If the tool has **presets** (`lcncguiPresets`, editable in the “Edit tool” dialog, see [`05_TOOL_TABLE.md`](05_TOOL_TABLE.md)), a **Cutting preset** section appears with a **touch-friendly selector** ([`TouchSelectField`](../../src/components/ui/TouchSelectField.tsx), same trigger classes as the edit dialog). Optionally an **MDI: S… F… ; …** preview line is shown from valid numbers of the selected preset; the part after **`;`** is the preset **name** (or preset **id** if the name is empty), formatted by `formatPresetMdiLine` / `presetDisplayLabel` in `src/lib/presetMdiValues.ts`.
- **Apply preset** sends **one** MDI line `S… F… ; <preset name>` with **spindle speed** (`spindle_rpm`) and **feed** (`feed_mm_min`, rounded to integer, must be positive) from the selected preset via **`program.mdi`** (`useSendMdiCommand` in `src/hooks/useSendMdiCommand.ts`; the trailing comment is ignored by the interpreter). Same **MDI preconditions** as the spindle/feed circle dialogs and the MDI console (`useMdiPreconditions` in `src/hooks/useMdiPreconditions.ts`): e.g. machine ON, interpreter idle, **task mode manual or MDI** (MDI locked in **program/auto mode**). While **`task_mode`** is briefly missing from status, MDI stays locked until the mode is known. The button is **primary (blue)** when it can run, otherwise grayed out like usual. After a **successful** `command_result`, the dialog closes and the line is appended to **MDI history**; on error the dialog stays open and **no** history entry is added. With no presets or invalid speed/feed in the preset, the button is disabled (hints like spindle/feed dialogs). E2E: `data-e2e="tool-info-preset-select"` / `data-e2e="tool-info-preset-apply"`.

## MDI console

On the **Home screen** only (not on the Program screen), `MDIConsole` (`src/components/MDIConsole.tsx`) renders a **history** of sent MDI lines and an **input** line; sent lines go through `program.mdi` via `useSendMdiCommand` (see [`docs/commands-events.md`](../commands-events.md)). History lives in the **state store** (`UISlice.mdiCommandHistory` / `appendMdiCommandHistory` in `src/store/uiSlice.ts`), so it persists across **sidebar and screen switches** within the same app session and is capped as a **ring** at `MAX_MDI_COMMAND_HISTORY` entries (`src/store/mdiHistoryConstants.ts`). On **full window reload** or **app restart** it starts empty. **Console input:** a line is appended to history **immediately on send** (before `command_result`). After **Enter** or **Send**, keyboard **focus stays on the MDI input** so further lines can be typed without clicking again. The input itself stays focusable even when MDI preconditions fail (e.g. interpreter busy right after a command); only **Send** / submit is blocked (`data-e2e="mdi-send"`). While blocked, the precondition text is exposed via hover tooltip and **`aria-describedby`** (sr-only); **Enter** with a non-empty line shows the same text as an **info** toast (`kind: mdi_preconditions`). **Apply preset**, **Set speed**, and **Set feed** append only after a **successful** `command_result`. **G-code syntax highlighting** (input and history) uses the same logic as the program editor — overview and color rules: [`docs/features/06_PROGRAM_SCREEN.md`](06_PROGRAM_SCREEN.md) → G-code syntax highlighting. **G/M code reference:** above the input, moving the mouse shows a **tooltip** with short info, syntax, and related codes (same JSON source as “Active codes”); in **history**, G and M tokens are linked on hover to the same tooltip (`GmCodeCursorTooltip`, `GmCodeHoverSpan`, helpers under `src/utils/gmTokenAtTextIndex.ts` and `src/utils/textareaIndexFromPointer.ts`). **Clicking a history line** copies it into the MDI input; there is **no** separate line-hover tooltip (would overlap G/M reference tooltips). For assistive tech each history row uses `aria-label` from **`components:mdi.applyToLineAria`** in `src/locales/{en,de}/components.json` (e.g. English: “Apply command to MDI line”; wording is **locale-dependent**).

## Active G- and M-codes (Home)

The **Active codes** widget (`ProgramCodesDisplay`, `src/components/ProgramCodesDisplay.tsx`) sits in the **top row of the left preview column** next to **`CoordinatesDisplay`** (in-flow layout with wrap; not overlaid on the machine visualization). It shows modal **G** and **M** codes from the LinuxCNC status, formatted by `src/utils/formatProgramCodes.ts`. Clicking a code opens a dialog with a short **summary** (from `summary`, or `description` as fallback if no separate summary exists in the JSON), a **syntax** line (aligned with the LinuxCNC [G-code](https://linuxcnc.org/docs/html/gcode/g-code.html) and [M-code](https://linuxcnc.org/docs/html/gcode/m-code.html) manuals), and where useful a **Related codes** list (`related` in `src/data/linuxCncGcodeMcodeReference.json`) with typical companion codes (e.g. M5 ↔ M3/M4, G40 ↔ G41/G42 and length offsets). There is **no** separate long “description” block in the dialog; the full `description` field in JSON is only used as the summary fallback. Related entries are clickable and open that code’s dialog. Maintenance: run `node scripts/augment-code-reference.mjs` to merge `summary`, `syntax`, and validated `related` into the JSON (related targets are checked against reference keys; definitions live in `scripts/code-reference-related.mjs`). The dialog links to the appropriate official manual page (G vs. M).

## Related Features

