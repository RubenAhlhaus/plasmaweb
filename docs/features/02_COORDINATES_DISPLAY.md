# 02_COORDINATES_DISPLAY

## Description
The coordinates display shows **work / display coordinates** for the axes (X, Y, Z; more axes may follow) — similar to a LinuxCNC DRO and gmoccapy, including **tool length offset (G43)**.
It reads computed values from the global store (`coordinates`) and renders them in a compact, always-visible area.
The **Coordinate systems & offsets** dialog lists G54–G59.3 with per-system offsets. Inactive systems use G5x values hydrated from the LinuxCNC parameter/VAR file when that file is readable (otherwise they may still show `0` until edited or activated). Every G54–G59.3 row (active and inactive) displays **`g5x + g92`** so Activate does not change the shown totals when only the active system switches.

## UI interaction
- The coordinates display is shown on the Home screen and the Program screen.
- The display is clickable and opens the **Coordinate systems & offsets** dialog.
- In that dialog the user can:
  - **Edit per-system offsets** (G54–G59.3):
    - **Table layout:** **fixed HTML table** (`table-fixed` + `colgroup` percentages, sticky header, scroll body with `scrollbar-gutter: stable`) so **header and data columns stay aligned** even with a vertical scrollbar.
    - **Cells:** **`p-0`** so **labels, value buttons, and (where present) the Active control fill the cell edge-to-edge** (no inner margin to the grid lines; `rounded-none`, `min-h-20`). The **machine (G53) row** has **no Active button**; if machine coordinates are the active context, that column shows read-only **Active** (same look as other active rows); otherwise the cell is visually empty, with an **`aria-label`** for assistive tech (no activation control).
    - **Footer row:** **Set axis X/Y/Z** and **Close** use **`size="lg"`** with extra **`min-h-14`** / min-width where needed for touch.
    - **Interaction:** Clicking **X/Y/Z** opens the same **touch numeric** sub-dialog as **Set axis** (`TouchNumericEntry` with `layoutSize="touch"`, `keyboardDecimalOnly`, **Cancel** / **Confirm** via **`TouchNumericDialogFooter`**, shell `touchNumericDialogContentClassName`). The sub-dialog title uses the **system label stored when opening** (e.g. G54) plus the axis.
    - **Commit:** On **Confirm**, the client sends `motion.set_coordinate_system_offset` with `{ systemId, x?, y?, z? }` for that axis. The machine row (`0`) has disabled cells (no editor).
  - **Activate** a **G54–G59.3** system from the per-row **Active** button; the client sends `motion.set_active_coordinate_system` with `{ systemId }`. The **machine (G53) row has no Active button** — in LinuxCNC, G53 is non-modal and only applies on the same line as a move (e.g. G0/G1), not as a selectable “active” coordinate system; when machine coordinates are active, the column shows read-only **Active** only. Same MDI preconditions as other MDI-backed commands (machine ON, enabled, interpreter idle, etc.).
  - **Keyboard (main dialog table):** **Arrow up/down** moves a **row highlight** (thick inset ring + optional gray row tint when the row is not the active system); the highlight **starts on the currently active** coordinate system when the dialog opens. Key handling uses a **document-level capture listener** so it works when focus stayed on the coordinate display behind the modal. **Enter** behavior: if focus is on an enabled **X/Y/Z offset cell** (`data-coordinate-offset-trigger`), **Enter** opens the **touch numeric offset** sub-dialog (same as click). If focus is on the **Active** control (`data-coordinate-aktiv-button`) **and** that row is the **currently highlighted** row, **Enter** activates that button (set active when not already active); if focus stayed on another row’s control while arrows moved the highlight, **Enter** applies to the **highlighted** row instead. Otherwise **Enter** activates the **currently highlighted** row when it is **not** the machine row (same as **Set active** when that row is not already active). **Enter** on the highlighted **machine** row does nothing toward activation. **Enter** on **Set axis X/Y/Z** / **Close** (elements marked `data-skip-enter-row-activate`) keeps the usual button behavior. Clicking an offset cell or a **G54–G59.3 Active** button updates the highlight to that row.
  - **Set axis target value** using the three actions at the bottom of the dialog (one per axis): opens a sub-dialog with **large touch-style** numeric entry (`TouchNumericEntry`, `layoutSize="touch"`), live preview, and a **Cancel** / **Confirm** footer built with **`TouchNumericDialogFooter`** — same two-column touch footer and **`dialogFooterTouchButtonClass`** min-heights as other numeric pickers (e.g. `TouchNumericPickerField`), with **Confirm** as the primary (`secondary`) action. The dialog shell uses **`touchNumericDialogContentClassName`** (see `src/components/numeric/touchNumericDialog.tsx`). There is **no** long explanatory paragraph in the sub-dialog — the title is enough. The initial value is loaded **only when the sub-dialog opens**; on open the field is **focused and fully selected** so the first keystroke replaces the value. **Physical keyboard:** **decimal input only** (optional leading minus, digits, one decimal separator); **on-screen keypad** still supports **expressions** (e.g. `5-3`, `10+0.5`) and **=** to commit the result. **Enter** confirms when the value is valid (same rules as **Confirm**). Invalid input on confirm shows an error in the dialog (no command).
  - For axis set-to-value the client sends `motion.set_axis_coordinate` with `{ axis, value }`; the backend issues `G10 L20 P0` style MDI for the active coordinate context.
  - **Escape:** The main dialog’s `DialogContent` uses `onEscapeKeyDown` returning `false` while an offset or axis **sub-dialog** is open, so **Escape closes the touch-numeric sub-dialog first**, then the main coordinate dialog (see `handleMainDialogEscapeKey` in `CoordinateSystemsDialog`).
- Virtual sidebar buttons **X**, **Y**, **Z** open the corresponding **Set axis** sub-dialog directly (via `ui.coordinates.openAxisDialog`).
- When the machine moves (jog, program, manual), values update from the backend status stream and high-rate `motion.coordinates.changed` events. The frontend **batches** coordinate store writes (default **66 ms**, ~15 UI updates per second, configurable via `ui.coordinateUiFlushMs` in `lcncgui-config.json`) and skips no-op updates within display precision (3 decimals).

## Preconditions
- WebSocket connected (`connectionStatus === "connected"`) so status updates arrive.
- Backend sends valid `motion` fields (`actual_position`, `g5x_offset`, `g92_offset`, `tool_offset`) so the frontend can derive display coordinates (see `src/api/statusMapping.ts` and `docs/backend-frontend-messages.md`).

## Event order
- Backend pushes status over WebSocket (`motion.actual_position`, `motion.homed`, etc.).
- On status snapshots, once the LinuxCNC INI path is known, the backend hydrates the in-memory **pure G5x** offset table for **all** G54–G59.3 systems from the RS274NGC **parameter / VAR file** (`[RS274NGC] PARAMETER_FILE`, resolved relative to the INI directory). Hydration runs **until it succeeds** (VAR path resolved and file read); after success it is not repeated for that backend process. LinuxCNC’s status channel only exposes the **active** G5x (+ G92); without this load, inactive rows would show zeros until each system was activated. Listed rows for G54–G59.3 always show **`g5x + current g92`** (active from live `stat`, inactive from hydrated/edited G5x plus live `g92_offset`). Edits via `motion.set_coordinate_system_offset` subtract G92 before `G10 L2` and store pure G5x in the in-memory table.
- Frontend status mapping updates:
  - computed `coordinates`
  - raw `linuxCncStatus.motion.homed`.
- During motion/jog the backend may emit `machine_event` with `event: "motion.coordinates.changed"` and `payload.coordinates` using the same formula as status mapping (**G5x, G92, `tool_offset` / G43**). The store updates only the affected coordinates, via the batcher in `useBackendWebSocket` (not on every WebSocket message).
- The coordinates display reads the store and shows:
  - numeric values per axis
  - normal vs. greyed-out styling from homing state.
- Click on the coordinates display publishes `ui.coordinates.openDialog` and opens the global dialog.
- Sidebar **X** / **Y** / **Z** publishes `ui.coordinates.openAxisDialog` with the axis and opens the sub-dialog directly.

## User feedback
- Each axis shows a numeric value with a fixed number of decimal places.
- Values update live while the machine moves (UI refresh capped by `coordinateUiFlushMs`, default 66 ms).

### Greyed-out axes
- While an axis is **not homed**, its row is **greyed out** (reduced opacity).
- Numbers still update so the user can see machine position.
- Grey state means: this axis is not referenced / homed yet.
- After homing (`motion.homed[index]` true, or joint homed fallback), the row returns to normal styling.
- Homing state uses the shared helper `isAxisHomed` in `src/utils/homing.ts` (reads `motion.homed` first, then `joints`).

### Header indicator (unhomed axes)
- When the WebSocket is connected and any X/Y/Z axis is not homed, the **HeaderBar** shows an orange **Not homed (X, …)** badge next to the machine status (E-stop / machine off / task mode).
- Copy comes from the **`common`** i18n namespace (`header.unhomedAxes.*` in `src/locales/{en,de}/common.json`).
- Clicking the badge fires `ui.homing.openDialog` with `source: 'header'` and opens the global homing dialog.
- Stable E2E hook: `data-e2e="header-unhomed-axes"` (see `e2e/helpers/headerBarStatusLocators.ts`).

## Edge cases
- **Missing or partial homing data** — during connect, `linuxCncStatus.motion.homed` may be unset; those axes are treated as not homed and greyed out.
- **No position data** — coordinates may stay at `0.000`; grey/normal homing styling is independent.
- **Parameter / VAR file missing or unreadable** — hydration is retried on later snapshots until the VAR file can be read; until then inactive G5x cache values may remain `0`. Missing parameters inside a readable file default to `0`.
- **Stale VAR vs live interpreter** — the VAR file is often flushed by LinuxCNC on exit. Hydration reflects **on-disk** values at read time, not necessarily in-memory interpreter params from the current session. After Activate, the active row uses live `stat` offsets; inactive rows keep the hydrated/edited G5x (+ live G92 for display).
- **G92 offset** — all G54–G59.3 dialog rows show `g5x + g92`. Offset edits subtract the current `g92_offset` before `G10 L2` so the entered total matches the on-screen value.

## Errors
- Backend/command failures are not shown inline on the coordinates widget; they surface via the general command/error UI.

## Related features
- 01_JOG_HOME_SCREEN
