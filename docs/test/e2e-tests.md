# E2E tests (browser + Playwright)

This document describes the current end-to-end approach for the GUI.

## Goals

- User-close tests for the web GUI (clicks, screen switches, visible UI results).
- Backend may run externally; tests focus on frontend user flows.

## Running

- Install browsers once: `npx playwright install`
- Start the LinuxCNC backend when tests need WebSocket/machine interaction (most specs except pure UI events with `skipVirtualSidebarMachineOn`).
- Run E2E: `npm run test:e2e`
- Playwright config: `e2e/playwright.config.ts`
- First MVP test: `e2e/tests/sidebar-navigation.spec.ts`

## Launch strategy (important)

- Playwright `webServer` runs `npm run build && npm run preview` (default `http://127.0.0.1:4173`; override with `E2E_PREVIEW_HOST` / `E2E_PREVIEW_PORT`).
- Each E2E run starts a **fresh** preview server (`reuseExistingServer: false`) so tests always hit the latest `dist/` build.
- Browser viewport defaults to **1920×1080** (`e2e/constants/testEnv.ts`) for the primary E2E baseline. Additional specs (e.g. `home-responsive-layout.spec.ts`) temporarily set smaller viewports to guard the fluid Home layout.
- The browser session is started once per worker (shared page). Before the first reload, `sharedPage` seeds **`localStorage`**: German UI (`lcncgui.locale`) and virtual sidebar enabled (`lcncgui.showVirtualSidebar` = `true`, see `e2e/helpers/e2eVirtualSidebar.ts`) for a deterministic baseline.
- The `appPage` fixture (`e2e/fixtures/webTest.ts`) calls **`resetAppView` before each test**, then by default **`ensureVirtualSidebarMachineOn`** (per test a WebSocket tap is attached, then check via header/DOM and softkeys if needed: **release E-stop and turn machine on**). If the machine is already on, **extra** clicks on E-stop and machine softkeys and **extra** outgoing `machine.set_task_state` commands for that purpose are skipped (tap setup and visibility checks still run). Specs that only check pure UI events without backend commands can set **`test.use({ skipVirtualSidebarMachineOn: true })`** (e.g. `event-home-opens-homing-dialog.spec.ts`) to avoid the longer waits of this step.
- After each test **no** E-stop is forced by the fixture; backend machine state persists between tests. The run uses `workers: 1` and is strictly serialized so one session stays consistent. If a spec needs ESTOP at the end, call **`ensureNotausActive`** from `e2e/helpers/resetAppView.ts` in the test.
- `e2e/helpers/resetAppView.ts` (UI baseline only, **no** forced E-stop at end):
  - **`window.__LCNCGUI_E2E__.resetMacroQueue()`** (if set): clears the macro queue in the state store so specs do not depend on each other (bridge installed in `App.tsx` via `installLcncguiE2eBridge` from `src/lib/lcncguiE2eBridge.ts`). Also exposes `setHomedFlags`, `setConnectionStatus`, and `setProgramExecutionState` (task mode + interpreter state for targeted UI checks).
  - Overlays: Escape several times; if visible: close homing dialog with “Close dialog”
  - Navigate **Home**
  - Open **Settings**, turn **virtual sidebar** on (if off) so softkeys exist
  - Back to **Home**
- Specs with **`page.reload()`** (e.g. WebSocket contract) may still call **`ensureVirtualSidebarMachineOn`** after reload themselves, because the page context is rebuilt and spindle/coolant expect a powered-on machine (idempotent if backend already reports ON).

## Selector convention

- Prefer semantic selectors:
  - `getByRole(...)`
  - `getByPlaceholder(...)`
- `getByTitle(...)` only where the app sets a **native HTML `title`** (e.g. some `Button` props). **Right navigation sidebar** (`RightSidebar`) and **header machine status** (`HeaderBar`) use `AppTooltip` — there is no reliable `title` on the clickable element; E2E uses documented **`data-e2e`** hooks or `e2e/helpers/headerBarStatusLocators.ts`.
- For new features without stable roles/texts, add `data-e2e="..."` (and document under **Stable test hooks** below).

## Artifacts

- Playwright output under `test-results/playwright/`.
- Screenshot/trace only kept on failure (`only-on-failure` / `retain-on-failure`).

## Current MVP scope

- Sidebar navigation (`e2e/tests/sidebar-navigation.spec.ts`):
  - Home
  - Macros
  - Program
  - Tools
  - Probing
  - Settings
- Verification each time via screen-specific markers (visible content after click).
- Additionally: virtual sidebar toggle, E-stop / machine ON-OFF softkeys, **HeaderBar status** via `data-e2e` (E-stop / machine off / task mode when machine on — see **Stable test hooks**), and outgoing WebSocket commands `machine.set_task_state` (including case “machine on with active E-stop sends no command”).
- **Startup E-stop:** Ideal is a backend that already reports `STATE_ESTOP` (visible header hook `header-estop-active`). If the environment does not (e.g. simulation without ESTOP), the test **once** clicks the E-stop softkey to force ESTOP before the fixed sequence — same machine logic as “E-stop from backend”.

- **Outgoing commands (frontend → backend)** — helper `e2e/helpers/outgoingWebSocketCommands.ts`:
  - Playwright [`WebSocket`](https://playwright.dev/docs/api/class-websocket): event **`framesent`** = page sends to the server (your `type: "command"` JSONs).
  - Symmetric to `framereceived` in `websocketContract.ts`.
  - **`page.on('websocket')` only sees new connections** — where needed (e.g. status contract) use **`page.reload()`** so a fresh handshake is visible.
  - `waitForOutgoingCommand(page, { predicate }, () => locator.click())`: builds **one** CDP session, waits for one command, closes again (single step).
  - `createOutgoingCommandSession(page)` → `{ waitForOutgoingCommand, dispose }`: **one** CDP session for **several** sequential commands (without reconnecting each step); call `dispose()` at the end (e.g. when bundling multiple steps with one shared CDP listener).
  - `attachOutgoingWebSocketTap(page)`: CDP + `framesent`, collects all outgoing commands; `dispose()` removes listeners. If the CDP session arrives **after** `dispose`, it is disconnected immediately (no leak). **WebSocket contract** (`websocket-contract.spec.ts`) uses this tap for spindle/coolant — details and reload see bullet “WebSocket contract” below.
  - For **multiple** commands with poll/negative checks (e.g. “no `machine.set_task_state`”): `attachOutgoingWebSocketTap(page)` with `waitForNextOutgoingCommand` or `assertNoOutgoingCommandSince` — the latter polls up to ~1 s and fails if a forbidden command **appears later** (see `e2e/tests/sidebar-navigation.spec.ts`).
  - `matchMachineSpindle('forward'|'reverse')` expects **no** `params.speed` — the sidebar sends spindle forward/reverse without fixed RPM so LinuxCNC uses the programmed S speed (interpreter).
- WebSocket contract (`e2e/tests/websocket-contract.spec.ts`):
  - Listens to inbound WebSocket frames in the running browser page.
  - Waits up to 15 seconds for a `linuxcnc_status` message.
  - Validates the message strictly against the expected contract:
    - Envelope (`type`, `protocolVersion`, `event`, `payload`)
    - Required regions in `payload` (`machine`, `motion`, `io`, `program`, `overrides`, `spindle`, `joints`, `axes`, `tools`)
    - no unknown keys on envelope and `payload` top level.
  - Virtual sidebar spindle/flood coolant: flow Home → Settings (enable virtual sidebar) → Home again; clicks run in Home context. After attaching listeners, `reload` + `waitForEvent('websocket')` so Playwright sees the connection. **Outgoing:** always `machine.spindle` / `machine.flood` via `attachOutgoingWebSocketTap`. Flood softkey 9 is **disabled** until the machine is ON (`task_state === STATE_ON`); tests call **`ensureVirtualSidebarMachineOn`** before flood/spindle clicks. **Inbound status mirroring:** optional with env var `E2E_LINUXCNC_STATUS=1` — then `createIncomingLinuxCncStatusSession` (Playwright `WebSocket.framereceived`). Waits on strict fields (`direction`/`speed`, `io.flood`) **or** on a change in `spindle` JSON or slim `io` (without `din`/`dout`). Without the variable, outgoing proof is enough; many LinuxCNC setups keep long zeros in `stat.spindle` while the axis runs — then a status assert can false-fail.
- Event flow:
  - `e2e/tests/event-home-opens-homing-dialog.spec.ts`
  - `e2e/tests/header-unhomed-axes.spec.ts` — sets homed flags via `window.__LCNCGUI_E2E__`, expects `header-unhomed-axes` visible, click opens homing dialog.
  - Flow: open Settings → enable virtual sidebar → click virtual Home button.
    - Expectation: homing dialog visible (e.g. heading from **`components.homing.title`** in the active locale; default English **“Homing”**) and primary row control **`data-e2e="homing-home-all"`** — see `e2e/tests/event-home-opens-homing-dialog.spec.ts`.

## Spindle and feed override dialogs

- UI: `SpindleFeedDialogsHost` / `OverrideSliderSection` — open via spindle or feed `SliderControl` on Home/Program (see [`docs/features/01_JOG_HOME_SCREEN.md`](../features/01_JOG_HOME_SCREEN.md)).
- **Override percent (direct entry):** click the percent trigger ([`TouchNumericPickerField`](../../src/components/numeric/TouchNumericPickerField.tsx)) beside “Current” → sub-dialog with keypad → confirm with **`*-ok`**; **Cancel** via **`*-cancel`**. Same suffix pattern as the tool table (`*-touch-entry`, `*-ok`, `*-cancel`).
  - Spindle: `spindle-override-percent-picker` → `spindle-override-percent-picker-touch-entry` → `spindle-override-percent-picker-ok`; apply command: `spindle-apply-override`; slider: `spindle-override-slider`.
  - Feed override: `feed-feed-override-percent-picker` → `feed-feed-override-percent-picker-touch-entry` → `feed-feed-override-percent-picker-ok`; slider: `feed-feed-override-slider`.
  - Rapid override: `feed-rapid-override-percent-picker` → `feed-rapid-override-percent-picker-touch-entry` → `feed-rapid-override-percent-picker-ok`; slider: `feed-rapid-override-slider`.
  - Feed dialog apply (both overrides): `feed-apply-overrides`. Left column programmed F: `feed-f-touch-input`.
  - Spindle programmed S (left column): `spindle-rpm-touch-input`.
- OK in the percent sub-dialog only updates the local slider; E2E for backend commands must click **Apply** afterward (`machine.spindle_override`, `machine.feed_override` + `machine.rapid_override`).

## Tool table (Tools)

- Spec: `e2e/tests/tool-table.spec.ts` — navigation, reload command, dialog validation (duplicate T number), file mutations (create / save offset / delete) with UI poll, MDI `T… M6 G43`, `tool.touch_off`. Machine-on prep runs centrally in the **`appPage` fixture** (`ensureVirtualSidebarMachineOn` after `resetAppView`). The mutation test fails if the dialog does not close after successful outgoing `add_tool_table_row` (backend/TOOL_TABLE/interpreter). `openAddToolDialog` waits for an empty display-name field so Playwright does not type before form reset — otherwise the display name can stay empty and the row shows only `T<n>` (metadata/storage: `docs/features/05_TOOL_TABLE.md`).
- `data-e2e="tools-table-row"` and `data-tool-id="T<n>"` on each table row (`ToolsTable`); in create/edit dialog e.g. `tool-edit-display-name`, numeric fields via [`TouchNumericPickerField`](../../src/components/numeric/TouchNumericPickerField.tsx) (`ToolEditDialog`). **Numeric input:** click trigger (e.g. `tool-edit-offset-Z`) → sub-dialog with keypad `tool-edit-offset-Z-touch-entry` → confirm with **`tool-edit-offset-Z-ok`** (no longer `.fill()` on the trigger directly). Same pattern for **T number** in create mode: `tool-edit-create-toolno` → `tool-edit-create-toolno-touch-entry` → `tool-edit-create-toolno-ok`. In **edit** mode for tool number (rename): `tool-edit-edit-toolno` → `tool-edit-edit-toolno-touch-entry` → `tool-edit-edit-toolno-ok`. Further triggers: `tool-edit-pocket`, `tool-edit-diameter`, `tool-edit-front-angle`, `tool-edit-back-angle`, `tool-edit-flutes-count`, `tool-edit-flutes-length`; each `*-touch-entry` and `*-ok` / `*-cancel` in the sub-dialog. Offset triggers exist **only for axes the machine configuration exposes** (LinuxCNC `axis_mask` / INI `[TRAJ] COORDINATES`); E2E expecting e.g. `tool-edit-offset-Z` needs a matching sim/INI config.
- Environment variable **`E2E_TOOL_TABLE_T`** (optional): when set, lower bound for T number: effectively `max(highest_T_in_table + 1, value)`. Without variable: only `highest_T + 1`. Mutation tests write to the LinuxCNC **TOOL_TABLE**; in `finally` the created row is deleted again via UI when needed.
- Matchers in `e2e/helpers/outgoingWebSocketCommands.ts` (each factory returns `(msg) => boolean`): `matchProgramLoadToolTable()`, `matchProgramRead(pathSubstring?)`, `matchToolAddRow(toolno?)`, `matchToolUpdateRow(toolno?)`, `matchToolDeleteRow(toolno?)`, `matchToolTouchOff(axis, value)`.
- Helpers: `e2e/helpers/toolTableE2e.ts` (`navigateToTools`, `toolTableRow`, `toolDetailsActionBar`, …).

## Stable test hooks (currently used)

- **Right sidebar (screen switch):** `data-e2e="sidebar-nav-home"`, `sidebar-nav-macros`, `sidebar-nav-program`, `sidebar-nav-tools`, `sidebar-nav-probing`, `sidebar-nav-settings` (`RightSidebar`; page object `e2e/pages/Sidebar.ts`).
- **Header machine status** (`HeaderBar`): `data-e2e="header-estop-active"` (E-stop), `header-machine-off` (machine off), `header-unhomed-axes` (connected and any jog axis not homed — orange badge, opens homing dialog on click), `header-task-mode-on` (machine on — short label Manual/Program/MDI). Additionally `data-task-mode="manual"|"auto"|"mdi"|"on"` on the task-mode span for prefix checks (e.g. Jog E2E: manual mode). Shared Playwright locators: `e2e/helpers/headerBarStatusLocators.ts` (used by `ensureVirtualSidebarMachineOn`, `sidebar-navigation.spec.ts`, `ensureNotausActive`, `jogging.spec.ts`, `header-unhomed-axes.spec.ts`).
- **Header exit** (`HeaderBar`): `data-e2e="header-exit-open"` (power icon — always opens exit dialog), `header-exit-close-window` (dialog — sends `app.exit` with `{}`, stops the backend, closes the browser; WebSocket timeout ~8 s), `header-exit-close-window-shutdown` (dialog — sends `app.exit` with `{ "shutdown": true }`; backend aborts motion and powers the machine off before ACK; WebSocket timeout ~40 s; fails with `shutdown_unavailable` if poweroff is not configured), `header-exit-cancel` (“Cancel” in exit dialog). If the tab cannot be closed, an info toast appears after ~300 ms. Locator helpers: `headerExitOpenLocator` / `headerExitCloseWindowLocator` / `headerExitCloseWindowShutdownLocator` / `headerExitCancelLocator` in `e2e/helpers/headerBarStatusLocators.ts`.
- `data-e2e="settings-row-virtual-sidebar"` for the Settings switch.
- `data-e2e="settings-row-virtual-sidebar-hotkey-{n}"` for each virtual sidebar hotkey row in Settings (`n` = softkey slot 1–16, same physical order as the sidebar).
- `data-e2e="settings-hotkey-button-{n}"` for the hotkey capture control on each row.
- Spec: `e2e/tests/virtual-sidebar-hotkeys.spec.ts` — assign F9 to softkey 2 (Home), verify `localStorage`, trigger homing dialog from Settings and from Home.
- `data-e2e="settings-feed-override-hotkeys"` / `settings-spindle-override-hotkeys` — collapsible Settings groups; rows `settings-row-{feed|spindle}-override-hotkey-{0…15}`, capture controls `settings-{feed|spindle}-override-hotkey-{0…15}`.
- Spec: `e2e/tests/override-preset-hotkeys.spec.ts` — assign F8 to feed position 8 (80 %), verify `localStorage`, assert outgoing `machine.feed_override` with `factor: 0.8`; feed position 0 shows `~1 % / Pause` and sends `feed_override` factor `0.01` when idle. Pause/resume while AUTO and ignoring >100 % after feed 0 % (encoder wrap) are covered by unit tests (`feedOverridePresetAction`, `useMachineEventBridge`).
- `data-e2e="settings-row-window-mode"` for the Settings **Window mode at startup** picker (kiosk vs window with title bar; persisted via `/api/user-preferences`).
- `data-e2e="settings-user-preferences-load-failed"` for the shared warning when GET `/api/user-preferences` failed at bootstrap (covers window mode, autostart, reload-last-tool defaults).
- `data-e2e="settings-row-linuxcnc-autostart"` for the Settings **Run LinuxCNC at startup** toggle (persisted via `PUT /api/user-preferences/linuxcnc-autostart`).
- `data-e2e="settings-row-reload-tool-on-startup"` for the Settings **Reload last tool after homing** toggle (persisted via `PUT /api/user-preferences/reload-tool-on-startup`).
- `data-e2e="settings-linuxcnc-autostart-ini"` for the stored INI path line (visible only when autostart is enabled).
- E2E: [`e2e/tests/settings-linuxcnc-autostart.spec.ts`](../e2e/tests/settings-linuxcnc-autostart.spec.ts) — toggle enable/disable with mocked API, localized error toast on failure.
- E2E: [`e2e/tests/settings-reload-tool-on-startup.spec.ts`](../e2e/tests/settings-reload-tool-on-startup.spec.ts) — toggle with mocked API, error toast on save failure.
- `data-e2e="settings-row-ws-url"` for the read-only **WebSocket URL** row on Settings (effective URL from `lcncgui-config.json`).
- `data-e2e="settings-hal-tool-{id}"` for HAL tool launch buttons in Settings (`id` from `resources/hal-tool-ids.json`).
- E2E: [`e2e/tests/settings-hal-tools.spec.ts`](../e2e/tests/settings-hal-tools.spec.ts) — button click, mocked `POST /api/hal-tools/launch`, localized error toast on 422.
- `data-e2e="virtual-sidebar-home"` for the Home button in the virtual sidebar.
- `data-e2e="virtual-sidebar-coolant"`, `virtual-sidebar-spindle-left`, `virtual-sidebar-spindle-stop`, `virtual-sidebar-spindle-right` for coolant/spindle softkeys.
- `data-e2e="virtual-sidebar-hal-softkey-14"`, `virtual-sidebar-hal-softkey-15`, `virtual-sidebar-hal-softkey-16` for configurable HAL softkeys (bottom of sidebar). Optional inbound check: `linuxcnc_status` → `io.hal_softkeys` (`"14"|"15"|"16"` → `0|1`; missing key = unreadable/off).
- `data-e2e="screen-placeholder"` on the **Probing** placeholder screen (`PlaceholderScreen`); `e2e/pages/Screens.ts` → `probingMarker()` uses this hook (visible copy is locale-dependent).
- `data-e2e="tool-change-dialog"` — root of the “Manual tool change” modal (HAL dialog after `machine.tool_change.requested`).
- `data-e2e="tools-table-row"` + `data-tool-id` — see **Tool table** above.
- `data-e2e="tool-edit-display-name"` — display name in tool dialog; `data-e2e="tool-edit-material"` — trigger for material selection (`TouchSelectField`); `data-e2e="tool-edit-offset-X"` … `tool-edit-offset-W` — triggers for numeric offset pickers (**only** for visible axes); related `tool-edit-offset-<axis>-touch-entry`, `-ok`, `-cancel`. Same for `tool-edit-create-toolno` and **`tool-edit-edit-toolno`** (+ `-touch-entry`, `-ok`, `-cancel`), `tool-edit-pocket`, `tool-edit-diameter`, `tool-edit-front-angle`, `tool-edit-back-angle`, `tool-edit-flutes-count`, `tool-edit-flutes-length` with the same suffixes in the numeric sub-dialog. Without field-specific `data-e2e` on the picker: `touch-numeric-picker-ok` / `touch-numeric-picker-cancel` (e.g. preset dialog).
- `data-e2e="tool-touch-off-axis-picker"` — content of the axis selection dialog in tool touch-off (`TouchSelectField` picker, spec `tool-table.spec.ts`). Entries are `role="option"` (Playwright e.g. `getByRole('option', { name: 'Z' })`).
- `data-e2e="tool-details-actions"` — action bar in the tool detail column (`ToolDetailsSidebar`).
- `data-e2e="axis-coordinate-input"` — target value field in the sub-dialog “Set axis to value” (`CoordinateSystemsDialog`, spec `set-axis-coordinate.spec.ts`).
- `data-e2e="coordinate-system-offset-input"` — input field in the touch-numeric sub-dialog for **coordinate system offsets** (title e.g. `G54 – X offset`), opened by clicking an **X/Y/Z cell** in the offset table (`CoordinateSystemsDialog`). **Cancel** / **Confirm** in the footer initially have no dedicated `data-e2e`; locator e.g. `getByRole('button', { name: 'Cancel' })` / `'Confirm'`.
- **Coordinate system keyboard:** spec `e2e/tests/coordinate-system-keyboard.spec.ts` — dialog “Coordinate systems & offsets”, focus on **Active** button of active row, **ArrowDown** + **Enter**; expects outgoing `motion.set_active_coordinate_system`. Additional stable hooks: offset cells `data-coordinate-offset-trigger` (with `data-system-id`, `data-offset-axis`, `data-offset-display`, `data-system-label`), **Active** column `data-coordinate-aktiv-button` / `data-system-id` (**only** G54–G59.3, not machine row G53); footer regions **Set axis** / **Close** `data-skip-enter-row-activate`.
- `data-e2e="program-reload-from-disk"` — icon “Reload program file from control PC” on Program screen (`ProgramScreen`, spec `program-screen.spec.ts`).
- **Home responsive layout** (`home-responsive-layout.spec.ts`): `data-e2e="home-jog-panel"` — right column (jog + MDI); **`data-jog-size="full"`** or **`"compact"`** reflects measured jog sizing. `data-e2e="home-jog-controls"` — increment selector + jog pad row. `data-e2e="mdi-history"` — MDI history panel (`MDIConsole`). MDI readiness for send: `data-e2e="mdi-send"` (enabled when `useMdiPreconditions` allows); the `#mdi-input` field stays focusable even when send is blocked (`mdi.spec.ts`).
- **Macros / program queue** (`ProgramQueue`, `PatternQueueBlock`, `ProgramQueueRootTailDrop`):
  - `data-e2e="macros-program-head-block"` — fixed **program header** above the sortable list (`ProgramQueueSetupBlock`).
  - `data-e2e="macros-program-head-dialog"` — “Program header” dialog; inside: `macros-program-head-wcs` and `macros-program-head-units` on the respective `TouchSelectField` triggers; `macros-program-head-z-retract` on the machine-Z retract **switch** (`role="switch"`).
  - `data-e2e="macros-queue-pattern-phases"` — inner phase area (drop target; macros append to end of phase list).
  - `data-e2e="macros-queue-add-into-pattern"` — **“Macro here”** button on the nested block (`PatternQueueBlock`).
  - `data-e2e="macros-queue-tail-drop"` — dashed area under the queue (drop to end of root list).
  - `data-e2e="macros-param-dialog-delete"` — **Delete** in parameter dialog (`MacroParamDialog`, edit mode only). **Drill pattern** (`nested-pattern-block`): no `paramSections` grid; tabs via **`role="tab"`** (e.g. “Custom layout”, “Round layout”, “Rectangular layout”), table and touch-numeric triggers like other macros. **Drill / face milling** etc.: sections as semantic **`h3`** headings without extra `data-e2e`; targeted selection e.g. `getByRole('heading', { name: 'Tool' })` (name = text from `paramSections.heading` in [`macroDefinitions.ts`](../../src/data/macroDefinitions.ts)).
  - `data-e2e="macros-from-pattern-hint"` — notice when adding/editing a **standard drill** or **helical bore** phase **inside** a drill pattern (X/Y and part surface Z hidden; taken from parent pattern).
  - `data-e2e="macros-delete-confirm-cancel"` / `macros-delete-confirm-confirm` — Cancel vs. Delete in confirmation (`MacrosScreen`, `TouchNumericDialogFooter`).
  - `data-e2e="macros-tile-<macroTypeId>"` — left catalog tile (`MacroTile`); built-ins use their definition id (e.g. `macros-tile-bohren-normal`); machine macros use `macros-tile-user-ngc-<o-name>` (e.g. `macros-tile-user-ngc-go_home`).
  - `data-e2e="macros-user-macro-info-close"` / `macros-user-macro-info-delete` — Close vs. Delete on the machine-macro info dialog (edit of `user-ngc-…` queue entries; no param form).
  - `data-e2e="macros-generate-program-code"` — **“Go to program”** under the queue (only visible when the list is not empty); on click: generate G-code from queue, `program.list` → `program.write` (file `lcncgui_queue_<timestamp>.ngc` in default `PROGRAM_PREFIX`) → `program.open` → `program.read`, set editor, switch to Program screen. During pipeline `disabled` and label **“Generating program…”**.  
  See [`docs/features/07_MACROS_SCREEN.md`](../features/07_MACROS_SCREEN.md).

## Program screen

- Spec: `e2e/tests/program-screen.spec.ts` — loads a first file via file browser (if present in `PROGRAM_PREFIX`), captures the `program.read` path from that load, then checks that reload sends `program.read` with the same `params.path` (logical editor path). Without a suitable file the test is skipped via `test.skip`.
