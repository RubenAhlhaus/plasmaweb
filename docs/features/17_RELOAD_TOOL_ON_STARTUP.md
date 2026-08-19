# 17_RELOAD_TOOL_ON_STARTUP

## Description

Like gmoccapy, lcncgui remembers the last tool that was in the spindle and can restore it after a restart once the machine is ready. The last tool number is stored in `~/.local/share/lcncgui/user-preferences.json` (`toolInSpindle`). When reload is enabled (`reloadToolOnStartup`, default **on**) and all jog axes (X/Y/Z) become homed while the spindle currently reports tool **0**, the UI issues MDI **`M61 Q<n> G43`** so LinuxCNC sets the tool number and length offset **without** a physical tool-change cycle (`T… M6`).

## UI Interaction

- **Automatic (no extra click):** After a successful tool change (any path that updates `tools.tool_in_spindle`), the new number is persisted (see Event order for the first-observation exception). After homing completes (or when status already shows all axes homed on connect) and the spindle still has tool 0, the saved tool is applied via `M61`.
- **Settings → Display → Reload last tool after homing:** Toggle enables/disables the restore behaviour (gmoccapy equivalent of “reload tool”). The last tool number is still saved when the toggle is off so turning it back on later can restore.

## Preconditions

- WebSocket connected; backend reachable for preference GET/PUT.
- Restore MDI only when:
  - `reloadToolOnStartup` is true,
  - stored `toolInSpindle` is an integer **> 0**,
  - current `linuxCncStatus.tools.tool_in_spindle` is **0** (or missing treated as not yet known — wait),
  - all jog axes X/Y/Z are homed (`getUnhomedAxes` empty),
  - MDI preconditions hold (machine ON, not ESTOP, interpreter idle, task mode MANUAL or MDI),
  - WebSocket is open (`connectionStatus === "connected"` and socket `OPEN`).

## Event order

1. Operator loads a tool (e.g. Tools screen **Change tool** → `T… M6 G43`, program, or HAL dialog). Status updates `tool_in_spindle`.
2. Frontend observes runtime `tool_in_spindle` and may `PUT /api/user-preferences/tool-in-spindle` with `{ "toolInSpindle": <n> }`:
   - **First observation** of `0` while a **positive** preference is already loaded: **seed only** (do not write) so a cold-start empty spindle does not wipe the saved tool before restore.
   - **First observation** that differs from the stored preference and is not that protected wipe (e.g. runtime `5`, prefs `0`): **persist** immediately (covers bootstrap failure while a tool is already loaded).
   - **Later changes** (including unload to `0`): always persist.
3. Backend writes `toolInSpindle` into `user-preferences.json` (same file as kiosk / autostart).
4. On a later session: bootstrap `GET /api/user-preferences` loads `toolInSpindle` and `reloadToolOnStartup` into the store (missing new keys default to `0` / `true` on the client).
5. When all axes become homed (or first usable status already has all axes homed), and spindle tool is still 0: frontend sends `program.mdi` with `M61 Q<n> G43` once the socket is open. The attempt is tracked as **in flight** only after `sendCommand` returns success.
6. On `command_result`: **ok** → session completed; **failure** → retry after a short delay (up to 3 attempts per homed session). Backend `mdi_manual_revert` returns to MANUAL when idle (same as other MDI).

## User Feedback

- No dedicated success toast for a normal restore (same quiet behaviour as gmoccapy).
- If MDI is rejected, the existing global `command_result` error toast applies; the UI may retry a few times.
- Settings toggle save failure → error toast; load failure at bootstrap shows one shared Display warning (`settings:display.userPreferencesLoadFailed`; `data-e2e="settings-user-preferences-load-failed"`).
- Help text under the Settings toggle explains that restore uses `M61` (no physical change) and runs after homing.

## Edge Cases

**Spindle already has a tool when all axes become homed**  
Do not issue `M61` (gmoccapy: skip reload if `tool_in_spindle != 0`). Mark the homed session completed for restore purposes.

**Stored tool is 0**  
No restore.

**Toggle off**  
Still persist `toolInSpindle` on change (per rules above); do not send restore MDI.

**Axes become unhomed then homed again**  
Allow restore attempts again for the new homed session (only if spindle tool is still 0).

**WebSocket not open when restore would fire**  
Do not mark the session completed; retry when status/connection updates while still homed.

**Backend unreachable**  
Background tool saves fail silently (no toast spam); Settings toggle shows a toast on failure. Restore cannot run without a loaded positive `toolInSpindle` in the store (from bootstrap or a later successful GET).

## Errors

- HTTP 503 when preferences cannot be written (disk/permissions).
- MDI errors from the gateway (same codes as other `program.mdi` calls).

## Related Features

- 05_TOOL_TABLE — active tool display and Change tool (`T… M6 G43`)
- 08_WINDOW_MODE — same `user-preferences.json` file
- 14_LINUXCNC_AUTOSTART — same preferences file / API family
- 01_JOG_HOME_SCREEN — homing / all-axes-homed detection
