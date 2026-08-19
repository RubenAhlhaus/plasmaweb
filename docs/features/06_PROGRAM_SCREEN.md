# Program screen

## Purpose

The Program screen shows the machine preview (like Home), coordinates, tool/overrides, and on the right a **G-code editor** with actions to load and save on the control PC (WebSocket commands `program.open`, `program.read`, `program.list`, `program.write` — see [`docs/commands-events.md`](../commands-events.md)).

## Layout

- **Two columns** (shared [`MachinePreviewColumn`](../../src/components/MachinePreviewColumn.tsx) + [`machineScreenLayoutClasses.ts`](../../src/lib/machineScreenLayoutClasses.ts)): left = machine preview (coordinates header, visualization, tool + spindle/feed footer); right = **ProgramEditor** and file/action bar.
- **Below ~1280px (`xl`)** the columns **stack vertically** (preview block above the editor).
- Home-only widgets (**Active codes**, **MDI**) are not on this screen; coordinates and overrides use the same preview column as Home.

## Editor state in the app store

The sidebar only renders the active screen (`App.tsx`). When navigating away from the Program screen the component **unmounts**; without the store, editor state would be lost even though LinuxCNC still has the program loaded.

Therefore relevant editor UI state lives in the **state store** (`UISlice.programEditor`, type `ProgramEditorState` in `src/store/types.ts`). `ProgramScreen` binds these fields with `useShallow` and updates them with **`setProgramEditor(partial)`**.

| Field | Meaning |
|------|-----------|
| `content` | Displayed / editable program text |
| `filePath` | Last chosen or backend-resolved backend path (browser, “Save as…”, `program.read` response) |
| `currentLineIndex` | Highlighted line in the view (0-based index): **“Run from line…”** sets it before start; during execution in auto, `useLiveProgramLineHighlight` overwrites it from LinuxCNC status (see below) and clears it to `null` after end |
| `runFromLineInput` | Input in the “Run from line…” dialog |
| `pendingAutoRunStartLine` | Next `startLine` for `program.auto` / `run` on the next cycle start (`0` = from file start); after a sent `run`, `useProgramExecutionEventBridge` resets to `0` |
| `openError` | Error text for **`program.open`**, for **`program.read`** (automatic after empty editor / UI reload **and** manual reload via refresh icon); shared banner under the editor |
| `writeError` | Error text for **`program.write`** |

Whether the editor is **editable** or shows **read-only** (`ProgramEditor`) is **not** in the store; it is derived from LinuxCNC status: **`isProgramFileExecuting`** in `src/lib/programFileExecuting.ts` is true exactly when `machine.task_mode === MODE_AUTO` and `program.interp_state` is **READING**, **WAITING**, or **PAUSED** — i.e. during **active program interpretation** (running, waiting, paused). With **`INTERP_IDLE`** in auto, text stays editable. **`resetProgramEditor()`** resets table fields to initial state **and clears the macro queue** (`macroQueueItems` in `UISlice`, see [`07_MACROS_SCREEN.md`](07_MACROS_SCREEN.md)) — e.g. from Settings under debug.

## WebSocket command correlation

`ProgramScreen` and [`ProgramFileBrowserDialog`](../../src/components/ProgramFileBrowserDialog.tsx) match outbound `program.open` / `program.read` / `program.write` / `program.list` commands to inbound `command_result` messages by `commandId` using **`usePendingWsCommandResults`**, **`usePendingWsCommandResultMap`**, and the same hooks — see `src/hooks/usePendingWsCommandResult.ts` and [`docs/backend-frontend-messages.md`](../backend-frontend-messages.md). Manual **reload from disk** uses a local timeout fallback when no response arrives.

## Run from line (dialog and cycle start)

- **Dialog** (“Run from line…” or click a **line number** in the editor): pick line (touch numeric like other numeric dialogs) and confirm with **Apply**; **Cancel** closes without change. Footer and minimum button heights follow the shared pattern `TouchNumericDialogFooter` / `touchNumericDialogContentClassName` (see `src/components/numeric/touchNumericDialog.tsx`). Sets `pendingAutoRunStartLine` (conversion from 1-based editor line to WebSocket `startLine` via `editorLineToStartLine` in `src/lib/editorLineToStartLine.ts`; see also [`docs/commands-events.md`](../commands-events.md) → `program.auto`). While `pendingAutoRunStartLine > 0`, the action bar shows an extra hint with the chosen start line (display mapping via `startLineToEditorLine1Based` in the same module).
- **Cycle start** (virtual sidebar / `ui.program.cycleStart` / configured **hotkey** with `source: 'hotkey'`): `useProgramExecutionEventBridge` checks with **`isProgramInterpreterPaused`** (`src/utils/isProgramInterpreterPaused.ts`) whether the interpreter is **paused** — same meaning as LinuxCNC: **`program.interp_state === INTERP_PAUSED`** (snapshot field `interp_state`; optionally also `program.paused` if set). **If paused**, sends `program.auto` with `{ command: 'resume' }` (without `startLine`). **Else** sends `{ command: 'run', startLine: pendingAutoRunStartLine }` and then resets the flag to `0`.
- **Pause** (virtual sidebar / `ui.program.pause` / **hotkey**): **toggle** — when interpreter paused `resume`, else `pause` (also via `isProgramInterpreterPaused` and `program.auto`).
- **Stop** (virtual sidebar / `ui.program.stop` / **hotkey**): sends **`machine.abort`**, not `program.auto` (see [`docs/commands-events.md`](../commands-events.md)).

Event and WebSocket mapping overview: [`docs/frontend-eventbus-overview.md`](../frontend-eventbus-overview.md) (virtual sidebar — cycle start, pause, stop).

## Live highlight of current line

When **`isProgramFileExecuting`** (see above — same as “active program interpretation” / running-waiting-paused) is true, hook **`useLiveProgramLineHighlight`** (`src/hooks/useLiveProgramLineHighlight.ts`) sets `currentLineIndex` from the status snapshot:

- **`program.motion_line`** is preferred once the value is **> 0** (typically: line associated with current motion).
- Else **`program.current_line`** if **> 0**.
- LinuxCNC reports **1-based** file line numbers; conversion to editor index is in **`programLinesToEditorLineIndex`** (`src/lib/programLineToEditorIndex.ts`).

After execution ends (transition to **`INTERP_IDLE`** after a previously active interpreter state), highlighting is cleared **without** clearing a “run from line” choice made before start if no run had started yet (only IDLE → no reset).

If the machine switches **from auto to another task mode** while live marking came from a **running** interpreter, `currentLineIndex` is also cleared (stale line after mode change).

The backend snapshot (`LinuxCncGateway.get_status_snapshot`) provides under **`program`** among others **`current_line`**, **`motion_line`**, **`read_line`**, and **`interp_state`** (besides `file` / G and M codes). Payload details: [`docs/backend-frontend-messages.md`](../backend-frontend-messages.md) → `payload.program`.

## G-code syntax highlighting

**Tokenization:** intentionally simple (`src/utils/gcodeSyntax.ts`), **rendering:** `src/components/GcodeHighlightedText.tsx`.

**Program screen (`ProgramEditor`):** In **editable** and **read-only** modes, G-code-like elements are color-highlighted.

**Line wrap:** Long **logical** lines **wrap** in the editor (`pre-wrap`); there is **no horizontal scrollbar**. The **line number** appears only on the **first** visible line of a logical line; on wrap, empty number fields follow at the same height as code lines (measurement via `src/utils/editorWrapLayout.ts`, ResizeObserver on width change). Read-only mode uses the same layout (no table `max-content` width).

**Home screen (`MDIConsole` in `src/screens/HomeScreen.tsx`):** The same highlighting applies to the **MDI input** and **history** of sent commands (not placed on the Program screen).

**G/M reference (Program and Home):** In the **editable** `ProgramEditor`, a **cursor tooltip** (portal) shows short info, syntax, and related codes for the G/M word under the mouse — same JSON reference as “Active codes”. In the editor **read-only** mode and **MDI history**, **hover tooltips** apply to tokens (`gmHover` in `GcodeHighlightedText`). In MDI history there is **no** extra whole-line hover for click — only G/M hover tooltips and an `aria-label` on the line button (see [`docs/features/01_JOG_HOME_SCREEN.md`](01_JOG_HOME_SCREEN.md) → MDI console). Mouse position for input is converted to a text index via `textareaIndexFromClientPoint` or for single-line MDI `singleLineInputIndexFromClientPoint` (`src/utils/textareaIndexFromPointer.ts`, `src/utils/gmTokenAtTextIndex.ts`). With **line wrap** in the program editor, horizontal mapping to text index is **approximate** (monospace column heuristic); the tooltip may sit slightly off on very long wrapped lines.

Tooltip-to-reference mapping is in `src/utils/gmCodeLookupFromText.ts`: **case** of G/M does not matter (LinuxCNC accepts e.g. `g0` like `G0`), and the **full token text** from tokenization is matched, not only a letter type from the highlighter.

**Rules:** **G** and **M** words, **F**/**S**/**T**, **axis letters** (X/Y/Z …), remaining **parameter words**, **`#` parameters**, and **comments** (`;` to end of line and parenthetical `(…)`). For **G** and **M**, **letter and number** are one unit (one command, e.g. `G0` all in G color). For **axes**, **F**/**S**/**T**, and other parameters, **letter** and **number** stay separate; all **numbers** in those words share the same neutral gray (e.g. `F10` and `X1.0`). **G** group and **axes** stay clearly distinct in color.

MDI UI on the Home screen: [`docs/features/01_JOG_HOME_SCREEN.md`](01_JOG_HOME_SCREEN.md) → MDI console.

## Display of loaded path

The line under the editor shows first the canonical path from **`linuxCncStatus.program.file`** (after `program.open`), else **`programEditor.filePath`** if the GUI knows a path but LinuxCNC reports an empty `program.file`. That display path can differ from the path used for **`program.read`** when LinuxCNC reports a realpath (e.g. via a symlink under `PROGRAM_PREFIX`) while the GUI keeps the logical path from the file browser.

## Reload program file from control PC

Besides **“Load file”** (file browser) there is an **icon button** (refresh, `RefreshCw`) with `data-e2e="program-reload-from-disk"`. It sends **`program.read`** with **`programEditor.filePath`** as `path` and, when it differs, also **`linuxCncStatus.program.file`** as optional `statusPath`. The backend picks the path: same real file → logical editor path (symlink-safe); different files → LinuxCNC status path (source of truth if the program was loaded elsewhere). With only one path known (e.g. after full UI reload), that path alone is sent. Reload syncs the editor with the **actual file on the control PC**; **unsaved GUI changes are lost**. The button is disabled while **no readable path** is available (`filePath` or `program.file`) or a reload is already running.

## Lifetime and automatic `program.read`

- **Within one app session (without full UI reload):** `programEditor` stays in the store. Navigating via the sidebar does **not** lose **content, path, error fields**, or other table fields — there is **no** automatic `program.read` for that. The user can still use **“Load file”** (other path) or the **reload** button (current path) manually.

- **Full UI restart (e.g. window reload):** The store is initially empty again (`content` empty, `filePath` usually `null`), but LinuxCNC may still report a loaded program (`program.file`). When WebSocket is **`connected`**, editor text is still **empty**, and a **readable path** can be determined (`programEditor.filePath` if set, else `program.file` from status), `ProgramScreen` triggers **`program.read`** and on success fills `content` and `filePath` from the response.  
  - **Limitation:** If only `program.file` is available and it is a realpath **outside** `[DISPLAY] PROGRAM_PREFIX` (typical for symlinked library folders like `ngcgui_lib`), auto-sync and reload can still fail with `outside_program_prefix` until the user loads the file again via **“Load file”** (which uses the logical prefix path).  
  - The same path is not requested in parallel twice (pending map).  
  - If automatic read fails, **the same path on this mount** is not auto-requested again (loop/spam guard). **Unmount** of the component (e.g. brief switch to another sidebar entry and back) resets those flags — a new auto attempt is possible. **“Load file”** and the **reload** button remain available manually.

- **Empty editor with known path (edge case):** If `content` is empty and a path exists (e.g. user deleted all text), the same condition applies — **`program.read`** fires again to sync with the file on the control PC.

- **LinuxCNC restart / loss of backend connection:** unchanged — last shown text remains in the GUI store; after reconnect, reload or save as needed.

## Performance note

`ProgramScreen` reads `programEditor` fields with **`useShallow`**: changes **outside** those fields (e.g. other slices) do not re-render the screen while extracted editor values are unchanged. Every change to **`content`** (typing in the editor) changes the selector output — the screen re-renders as expected.

**`ProgramEditorConnected`** (`src/components/ProgramEditorConnected.tsx`) subscribes with `useShallow` to e.g. `content`, `currentLineIndex`, and **`linuxCncStatus`**, so props for `ProgramEditor` (especially edit vs. read-only via **`isProgramFileExecuting`**) stay correct on status updates. The bundled **Program screen** also reads the store directly for the editor and derives the same from `linuxCncStatus`.

## Read-only and active program interpretation

- While **`isProgramFileExecuting`** is true (AUTO mode and interpreter **READING**, **WAITING**, or **PAUSED** — see `src/lib/programFileExecuting.ts`), program text is **not editable**; `ProgramEditor` renders **read-only** with the same line height per visible text line as in edit mode (one logical line may span multiple lines due to wrap). Lines are **not** stretched over the full editor height (short programs stay compact at the top). Under the editor appears the hint “Program running – editing locked.”
- When **active program interpretation** ends (typically **`INTERP_IDLE`** in auto, or task mode change), the editor becomes **editable** again; there is no manual toggle.
- The action bar includes **Save** (write to known control PC path), **Save as…**, and **Load file**; reload uses the **refresh** icon (see above).
- On a successful **`program.write`** (**Save** or **Save as…**), the **triggering** button briefly switches to a checkmark / “Saved” style (`data-e2e="program-save"` or `data-e2e="program-save-as"`). Feedback lasts **`SAVE_SUCCESS_FEEDBACK_MS` (2000 ms)** and clears immediately when a new write starts, a write error is shown, or the editor content changes (including edits while the write was in flight — then no success style is shown).
- Below the action buttons, a **cycle-start hint** (`data-e2e="program-cycle-start-hint"`) explains how to run the program: with the virtual button sidebar visible (`showVirtualSidebar`), it points to the **Cycle start** button on the left; when the sidebar is hidden, it mentions the configured hotkey (Settings) or the physical cycle-start button. The hint also references **“Run from line…”** for optional start-line selection. It is **hidden** while **`isProgramFileExecuting`** is true (same condition as the locked-editor hint above). When **`pendingAutoRunStartLine > 0`**, a second line states the next start line.
