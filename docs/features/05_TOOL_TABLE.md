# 05_TOOL_TABLE

## Description

The tool list on the **Tools** screen and the **active tool** display (Home, Program) take their data from the LinuxCNC status: `linuxCncStatus.tools.tool_table` (serialized and enriched by the backend from `linuxcnc.stat.tool_table`). **LinuxCNC values** (T, P, offsets, D, …) come from the tool file; **lcncgui library data** (display name, type, material, free comment, flute count/length, **presets** for cutting data) live in a **sidecar JSON** next to the `[EMCIO] TOOL_TABLE` file (`<basename>.lcncgui-tools.json`) so `.tbl` line length limits do not apply.

## Data source

- INI `[EMCIO] TOOL_TABLE`: path to the tool file (relative to `CONFIG_DIR`), as in gmoccapy.
- Runtime: backend polls `stat` and sends `payload.tools.tool_table` in the `linuxcnc_status` stream.
- **Pkt (pocket)** column: often absent in `stat.tool_table`; the backend supplements from `stat.toolinfo(T)` when present, else from the **TOOL_TABLE file** (`T… P…` lines).
- **Comment** (text after `;` on the line): often missing in `stat.tool_table`; the backend supplements from the **TOOL_TABLE file**. When saving from the app, only a **short** plain text is written there (typically the display name) to stay under LinuxCNC line limits.
- **lcncgui sidecar:** backend loads `<TOOL_TABLE-path>.lcncgui-tools.json` (same directory, filename derived from table path) and attaches `lcncgui_meta` and `lcncgui_presets` per `toolno` to each entry in `payload.tools.tool_table`. Keys in the JSON file are tool numbers as strings (`"1"`, `"2"`, …). When **deleting** a tool, the backend removes the matching entry from the sidecar too. When **renaming** the T number (`tool.update_tool_table_row` with `new_toolno`), both the `.tbl` line and the sidecar key are updated together.
- **Frontend mapping:** [`src/lib/linuxCncToolTable.ts`](../../src/lib/linuxCncToolTable.ts) (`mapToolTableToTools`) builds the displayed list from `payload.tools.tool_table`. If the same tool number appears more than once, rows are **merged per UI `id` (`T<n>`)** — on duplicates the **last** matching line in snapshot order wins; then **sort by tool number**. That avoids duplicate table rows and duplicate React `key`s if the status contains duplicates.
- **Tests** (Vitest): [`src/lib/__tests__/linuxCncToolTable.test.ts`](../../src/lib/__tests__/linuxCncToolTable.test.ts) checks dedupe, sorting, and row mapping; [`src/lib/__tests__/toolMaterial.test.ts`](../../src/lib/__tests__/toolMaterial.test.ts) checks `normalizeToolMaterial`.

## Sidecar schema (`*.lcncgui-tools.json`)

- Root: `version` (number, currently `1`), `tools` (object, keys = `T` number as string).
- Per tool: `meta` (object) and `presets` (list).
- **`meta`** (examples): `name`, `type`, `material`, `comment`, `numberOfFlutes`, `flutesLength` — same meaning as before in `|LCNCGUI|`-JSON, but without line length limit.
- **`meta.material`** (optional): **Stored in English** (sidecar JSON and embedded `|LCNCGUI|`-JSON in the `.tbl` line once the app writes meta): only `HSS`, `Carbide`, `Ceramic`, `Titanium coated` — when writing from the UI always canonical spelling (`Ceramic` with capital **C**). **Not specified:** field omitted in `meta` / not sent. **Web UI:** selection via [`TouchSelectField`](../../src/components/ui/TouchSelectField.tsx) (button opens a second dialog with large entries) with **localized** labels from the **`tools`** i18n namespace (`tools.json` → `material.*` under `src/locales/{en,de}/`); display in list/details/home via `formatToolMaterialUi` in [`src/types/tools.ts`](../../src/types/tools.ts). The **backend** does not validate `material`. **Frontend:** `normalizeToolMaterial` recognizes only these four tokens (case-insensitive); any other value — including old German text or `VHM` in the file — is treated as **not specified** (`tool.material` empty). Implementation: [`src/types/tools.ts`](../../src/types/tools.ts), dialog [`src/components/tools/ToolEditDialog.tsx`](../../src/components/tools/ToolEditDialog.tsx), mapping [`src/lib/linuxCncToolTable.ts`](../../src/lib/linuxCncToolTable.ts).
- **`presets`:** entries with e.g. `id`, `name`, optional `comment`. Numeric cutting/feed fields (all optional, non-negative, float): `spindle_rpm`, `ramp_spindle_rpm`, `surface_speed_m_per_min`, `feed_mm_min`, `feed_per_tooth_mm`, `lead_in_feed_mm_min`, `lead_out_feed_mm_min`, `transition_feed_mm_min`, `helix_feed_mm_min`, `ramp_angle_deg`, `plunge_mm_min`, `plunge_feed_per_rev_mm`, `max_stepdown_mm`, `max_stepover_mm`. Booleans: `use_stepdown`, `use_stepover`. Coolant: `coolant` as one of `off`, `flood`, `mist`, `through_tool`, `external_water`, `air`. On **read/write** the backend discards entries without **substance**: neither non-empty **`name`** nor at least one known cutting value, nor `use_stepdown`/`use_stepover` **true**, nor set **`coolant`** — pure **`id`** stubs are not kept.

**Commands** `tool.add_tool_table_row` / `tool.update_tool_table_row`: optional parameters `lcncgui_meta` (object) and `lcncgui_presets` (list). The backend writes the `.tbl` line (CNC data + short comment from `meta.name`) and updates the sidecar file.

## Legacy: comment with `|LCNCGUI|`

External `.tbl` files may have after `;` the separator `|LCNCGUI|` plus JSON. **If there is no sidecar entry** for this `T`, the frontend still parses the comment (`src/lib/lcncGuiToolComment.ts`). Once a sidecar entry exists for the number, **`lcncgui_meta` in status is authoritative**.

Numeric tool data that LinuxCNC controls (**offsets, diameter, pocket**) always come from the LinuxCNC columns of the `.tbl`, not from the sidecar.

## UI interaction

- **Tools** table shows all rows with `toolno > 0` (empty slots hidden). Columns include icon, ID, pocket, X/Y/Z, name, diameter, type, comment — **material**, **flutes**, and **flute length** only in the **detail pane** on the right (and in the edit dialog). On wide viewports the table and detail pane sit **side by side**; below ~1024px width the detail pane moves **below** the table (fluid width up to ~35% / 420px when side by side). In the **Edit tool** dialog, **material** is chosen via [`TouchSelectField`](../../src/components/ui/TouchSelectField.tsx) with **localized** labels (`tools` i18n → `material.*`); English canonical values go to sidecar/JSON (`meta.material` above).
- Above the table: left **New tool** (same dialog as edit in create mode; **Add** sends `tool.add_tool_table_row`), right **Refresh** (refresh icon). Refresh sends `program.load_tool_table` so LinuxCNC reloads the file; the list updates on the next status poll. Outbound commands are correlated via **`usePendingWsCommandResults`** (`src/hooks/usePendingWsCommandResult.ts`); a local timeout clears the refresh spinner if no `command_result` arrives.
- Buttons are disabled when there is no WebSocket connection (`connectionStatus !== "connected"`).
- Right detail pane: **Edit** and **Delete**. Edit opens the dialog (offsets, geometry, lcncgui fields, **cutting presets** with their own sub-dialog for add/edit — UI [`src/components/tools/ToolPresetEditDialog.tsx`](../../src/components/tools/ToolPresetEditDialog.tsx), coupled fields/calculations [`src/lib/toolPresetCalculations.ts`](../../src/lib/toolPresetCalculations.ts)); **Save** sends `tool.update_tool_table_row` including `lcncgui_presets`. **Tool number (T)** can be changed in the edit dialog via [`TouchNumericPickerField`](../../src/components/numeric/TouchNumericPickerField.tsx); if the entered number differs from the previous one, the UI also sends **`new_toolno`** (still **`toolno`** = old row) — backend updates `.tbl` line and sidecar key (see [`docs/commands-events.md`](../commands-events.md)). Delete opens a confirmation dialog; on confirm the UI sends `tool.delete_tool_table_row`. Without connection, actions are disabled. **`program.load_tool_table`**, save, delete, and touch-off correlate outbound commands with inbound `command_result` messages via **`usePendingWsCommandResult(s)`** in `src/hooks/usePendingWsCommandResult.ts` (see [`docs/backend-frontend-messages.md`](../backend-frontend-messages.md)).
- **Dynamic fields (axes / mill vs. lathe):** visible **tool offset axes** in the edit dialog and the axis list in **tool touch-off** follow machine configuration. Data source order (first usable wins, else fallback all nine axes X…W):
  1. `linuxCncStatus.machine.axis_mask` from the `linuxcnc_status` snapshot (LinuxCNC `stat.axis_mask` / INI `[TRAJ] COORDINATES`).
  2. `iniRuntimeConfig.traj_coordinates` from the `machine.ini_config.loaded` event (backend reads `[TRAJ] COORDINATES`, supplements via line scan if needed).
  3. `linuxCncStatus.machine.traj_coordinates_hint` in the snapshot only when `axis_mask` is missing (backend: line scan of active INI).
  **Geometry:** **Diameter** is always visible. **Orientation (1–4), front angle, back angle** only when INI `[DISPLAY] LATHE` is set (`display_lathe` in the INI event). Implementation: `src/lib/machineToolUiProfile.ts`, hook `src/hooks/useToolMachineUiProfile.ts`, dialogs `ToolEditDialog` / `ToolTouchOffDialog`.
- **Select fields (touch / keyboard):** orientation, type, and material in the edit dialog, coolant in the preset dialog, and **axis** in touch-off use [`TouchSelectField`](../../src/components/ui/TouchSelectField.tsx): one button shows the current value and opens a second dialog with large buttons; the list has `role="listbox"`, each row `role="option"`. **Keyboard:** **up/down**, **Home**, **End** move focus between options (roving `tabIndex`).
- **Numeric fields (touch / keyboard):** tool number (T) — **create and edit** —, pocket, axis offsets, diameter, front/back angle (lathe), flute count and flute length in **Edit tool** and all numeric fields in the **preset dialog** use [`TouchNumericPickerField`](../../src/components/numeric/TouchNumericPickerField.tsx`): a button shows the value (or “—”), click opens a **sub-dialog** with [`TouchNumericEntry`](../../src/components/numeric/TouchNumericEntry.tsx) (large keypad, preview `= …`, simple expressions like `5-3`, **=** key). **OK** commits the value (via `parseTouchNumericForCommit`); **Enter** in the dialog confirms like **OK**; **Cancel** discards. In the **preset dialog**, a short **tooltip** on mouse hover over the **field label** explains the parameter ([`AppTooltip`](../../src/components/AppTooltip.tsx), `labelTooltip` on [`TouchNumericPickerField`](../../src/components/numeric/TouchNumericPickerField.tsx)). In the preset dialog, coupled calculations (e.g. speed ↔ surface speed) from [`toolPresetCalculations.ts`](../../src/lib/toolPresetCalculations.ts) run **after OK** in the picker, not while typing in the sub-dialog. **Ramp spindle speed** (`ramp_spindle_rpm`) is tied to **spindle speed** while the preset has no saved ramp speed and the user has not independently changed “ramp spindle speed”: changes to spindle speed or surface speed then use the same RPM for ramp; after a manual ramp adjustment it stays independent. When loading without stored `ramp_spindle_rpm`, the UI shows ramp speed like spindle speed (when present). UI: [`ToolPresetEditDialog.tsx`](../../src/components/tools/ToolPresetEditDialog.tsx). **Escape:** closes the calculator sub-dialog first; if **Edit preset** is open, another Escape closes it before **Edit tool** closes on Escape (stack behavior like the coordinates dialog, see [`docs/features/02_COORDINATES_DISPLAY.md`](02_COORDINATES_DISPLAY.md)).
- In create/edit dialog, **Add** and **Save** are disabled while the **interpreter is not idle** (e.g. program running) — the file is not written in that case. **Machine off** is no longer a blocker: the backend still writes `.tbl` and sidecar; immediate `load_tool_table` in LinuxCNC only when machine **ON**, `stat.enabled`, and interpreter idle. Otherwise `command_result` still `ok: true` with `result.toolTableReloadDeferred: true`; the UI shows a short **info toast** and the list updates after later **reload tool table** or when LinuxCNC is ready. Details: [`docs/commands-events.md`](../commands-events.md).
- **Change tool** sends MDI `T<n> M6 G43` via `program.mdi` for the selected tool (same word order as generated macro programs: `T… M6`, then **`G43`** for tool length compensation — LinuxCNC does not apply length offset on `M6` alone; one MDI line because `program.mdi` accepts a single block). The button is disabled when there is no connection, MDI is not allowed by machine state, or no valid tool number. If the selected tool is already in the spindle, a **green status** “Tool in spindle” appears in the same place and size as the primary button (not clickable, `role="status"`).
- **Last tool after restart:** Runtime `tool_in_spindle` is persisted to `user-preferences.json` (with a first-observation guard so a cold-start `0` does not wipe a saved tool before restore). After axes are homed, an enabled **Reload last tool after homing** setting restores it with `M61 Q… G43` (no physical change). See [`17_RELOAD_TOOL_ON_STARTUP.md`](17_RELOAD_TOOL_ON_STARTUP.md).
- **Tool touch-off** (gmoccapy style): button below change/edit; active only when **this** tool is **in the spindle** and MDI is allowed. Opens a dialog (**axis** as above only for configured axes, **target value**). **Target value** input uses the same touch keypad as the axis dialog: digits, operators, parentheses, comma/dot as decimal separator, **simple expressions** (e.g. `5-3`); preview `= …` and **=** to take the result. **Apply** is disabled until the expression evaluates to a valid number (empty, incomplete, or invalid syntax). **Apply** sends `tool.touch_off`. The backend runs `G10 L10 P<spindle_tool> …` and, with active G43, `G43` again, then returns to manual — see [`docs/commands-events.md`](../commands-events.md) → `tool.touch_off`.
- **MDI/command errors:** if the backend rejects a command (`command_result` with `ok: false`, e.g. `jog_active`), the web UI shows a **global error toast** (`useBackendWebSocket`); details remain in `error.message` / `error.code` and logs/DevTools. See [`docs/backend-frontend-messages.md`](../backend-frontend-messages.md) → `command_result`.

### Manual tool change (HAL) and confirmation dialog

**State:** Only when **`PLASMAWEB_TOOLCHANGE_HAL_ENABLED=1`** (or similar) is set does the backend poll via `halcmd getp` typically **`iocontrol.0.tool-change`** and **`iocontrol.0.tool-prep-number`**. **Without that** (default) there is **no** HAL tool-change dialog — regardless of what iocontrol reports. On a rising edge the backend sends WebSocket **`machine_event`** `machine.tool_change.requested` with `tool_number` and `description`. **Description** uses the same logic as the tool list: first **display name from sidecar** (`meta.name`), else comment from `stat.tool_table`, else on-disk **`[EMCIO] TOOL_TABLE`** comment suffix (after `;`). The web UI shows a modal dialog; **OK** sends `machine.tool_change_ack`, **Cancel** sends `machine.tool_change_abort`.

**Multiple events / open dialog:** If another `machine.tool_change.requested` arrives while the dialog is open, the frontend **replaces** the displayed pending entry with the new payload (no queue).

**WebSocket reconnect:** When **all** clients were briefly disconnected, the backend resets edge detection once at least one connection exists again — if the HAL “change requested” pin is still set, the event is **sent again** so a dialog appears after reload/reconnect.

**Configuration (backend process environment variables):**

| Variable | Meaning |
|----------|-----------|
| `PLASMAWEB_TOOLCHANGE_HAL_ENABLED` | **`1`** / `true` / `on` enables polling (default: **off**). Without enabling, no dialog. |
| `PLASMAWEB_TOOLCHANGE_POLL_S` | Poll interval in seconds (default `0.15`) |
| `PLASMAWEB_TOOLCHANGE_CHANGE_PIN` | HAL pin for change request (default `iocontrol.0.tool-change`) |
| `PLASMAWEB_TOOLCHANGE_PREP_NUMBER_PIN` | HAL pin for tool number (default `iocontrol.0.tool-prep-number`) |
| `PLASMAWEB_TOOLCHANGE_ACK_CMD` | **One shell line** after operator confirm (e.g. `halcmd setp …`); empty → ack command fails |
| `PLASMAWEB_TOOLCHANGE_ABORT_EXTRA_CMD` | Optional: shell after `command.abort()` |
| `PLASMAWEB_HALCMD_TIMEOUT_S` | Timeout for `halcmd getp` (default `3`) |

**Security / shell:** `PLASMAWEB_TOOLCHANGE_ACK_CMD` and `PLASMAWEB_TOOLCHANGE_ABORT_EXTRA_CMD` are executed in the backend with **`/bin/sh -c`**. Use only **trusted, short** command lines (typically one `halcmd setp …` or a fixed helper script). Never put unchecked remote input into these variables.

**HAL / PostGUI:** The backend runs as a **separate process** and does **not** use a `gmoccapy` HAL component. Machine configuration must wire iocontrol signals per LinuxCNC docs for manual change (cf. [hal-examples / hal_manualtoolchange](https://github.com/LinuxCNC/linuxcnc/blob/master/docs/src/hal/hal-examples.adoc)). Do **not** use `hal_manualtoolchange` with its own GTK dialog **and** plasmaweb dialog without coordination.

**PostGUI sketch** (adjust pin names per config; `PLASMAWEB_TOOLCHANGE_ACK_CMD` must hit the correct ack path):

```hal
# Prepare handshake (example, see LinuxCNC docs / sim configs)
net tool-prep-loop iocontrol.0.tool-prepare => iocontrol.0.tool-prepared

# Variant A: hal_manualtoolchange **without** parallel GTK dialog — simulate button:
#   net … => hal_manualtoolchange.change_button
#   PLASMAWEB_TOOLCHANGE_ACK_CMD='halcmd setp hal_manualtoolchange.change_button 1'

# Variant B: custom HAL out wired to iocontrol.0.tool-changed (like gmoccapy → iocontrol):
#   loadusr -Wn myack …   # e.g. provides myack.ack-bit
#   net tool-done myack.ack-bit => iocontrol.0.tool-changed
#   PLASMAWEB_TOOLCHANGE_ACK_CMD='halcmd setp myack.ack-bit 1'
```

On **cancel** in the dialog the backend roughly matches gmoccapy via `linuxcnc.command.abort()`; optionally `PLASMAWEB_TOOLCHANGE_ABORT_EXTRA_CMD` resets HAL pins (like manual reset in gmoccapy).

**gmoccapy reference:** In [gmoccapy.py](https://github.com/LinuxCNC/linuxcnc/blob/master/src/emc/usr_intf/gmoccapy/gmoccapy.py) the GUI component has `toolchange-change`, `toolchange-number`, `toolchange-changed` pins; plasmaweb reads **iocontrol** directly (configurable) and acknowledges via shell.

Protocol: [`docs/commands-events.md`](../commands-events.md), [`docs/backend-frontend-messages.md`](../backend-frontend-messages.md).

## Preconditions

- For live data: WebSocket connected; backend connected to LinuxCNC.
- `program.load_tool_table`: machine on, interpreter idle (backend checks like `program.open`).
- `tool.update_tool_table_row` (edit → save), `tool.add_tool_table_row` (new → add), `tool.delete_tool_table_row` (delete confirmed): **writing** requires interpreter `INTERP_IDLE` and reachable `TOOL_TABLE` (machine may be **OFF**). **LinuxCNC reload** (`load_tool_table`) only when machine ON, `stat.enabled`, and idle — else successful ACK with `result.toolTableReloadDeferred`. **Backup:** `.tbl` and matching `.lcncgui-tools.json` together. See [`docs/commands-events.md`](../commands-events.md).
- `Change tool` (`program.mdi`): same MDI preconditions as the MDI console (e.g. machine ON, no ESTOP, interpreter idle).
- `tool.touch_off`: same MDI-like gateway preconditions as `program.mdi`, plus `tool_in_spindle > 0` and no G41/G42; details and error codes: [`docs/commands-events.md`](../commands-events.md).
- **HAL tool-change dialog:** enable `PLASMAWEB_TOOLCHANGE_HAL_ENABLED`; WebSocket connected; backend has `halcmd` and **`PLASMAWEB_TOOLCHANGE_ACK_CMD`** set, else **OK** fails with `tool_change_ack_not_configured`.

## Example files

See [`examples/sample_tool_table.tbl`](../../examples/sample_tool_table.tbl) and sidecar [`examples/sample_tool_table.lcncgui-tools.json`](../../examples/sample_tool_table.lcncgui-tools.json) (reference; exact columns may vary with `TOOL_TABLE_FORMAT` in the INI).
