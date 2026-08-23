# 11_EXIT_SHUTDOWN

## Description

The header **power icon** opens an exit dialog with two actions: close the UI only, or close the UI and shut down the controller PC. Shutdown is coordinated so LinuxCNC (motion/HAL/realtime) stops cleanly before system poweroff.

## UI Interaction

- Click the **power icon** in the header (`data-e2e="header-exit-open"`).
- **Fenster schließen** / **Close window** — closes the browser and stops the backend; LinuxCNC keeps running until the DISPLAY program exits normally.
- **Fenster schließen und herunterfahren** / **Close window and shut down** — same, then powers off the PC after LinuxCNC has exited.
- **Cancel** closes the dialog without action.

## Preconditions

- WebSocket connection to the backend (`connectionStatus === "connected"`).
- For system shutdown: `sudo ./install.sh --setup-shutdown` must have been run on the controller (passwordless `plasmaweb-shutdown` for the LinuxCNC user). Otherwise the backend returns `shutdown_unavailable`.

## Event order

### Close window only

1. User confirms **Close window**.
2. Frontend sends `app.exit` with `{}` (WebSocket timeout ~8 s).
3. Backend returns `command_result` with `ok: true`.
4. Frontend closes the browser tab.
5. WebSocket handler stops the backend (uvicorn exit / SIGINT).
6. `bin/plasmaweb` exits → LinuxCNC shuts down normally.

### Close window and shut down

1. User confirms **Close window and shut down**.
2. Frontend sends `app.exit` with `{ "shutdown": true }` (WebSocket timeout ~40 s).
3. Backend checks `plasmaweb-shutdown --dry-run`; on failure → `shutdown_unavailable`.
4. Backend **before ACK**: abort motion (`abort_program`, up to 10 s), machine off (`set_power(false)` with retries), wait up to 3 s for `STATE_OFF`, write shutdown marker file.
5. Backend returns `ok: true`.
6. Frontend closes the browser; WebSocket handler stops the backend.
7. `bin/plasmaweb` sees the marker, starts a detached job that waits for the LinuxCNC parent process (max. 60 s), removes the marker, runs `plasmaweb-shutdown`.
8. System powers off.

## User Feedback

- Exit dialog shows while the command is in progress (`exitInProgress`).
- On failure: error toast (`shutdown_unavailable`, timeout, or generic exit error).
- If the tab cannot be closed (e.g. dev mode): info toast after ~300 ms.
- Shutdown/poweroff failures on the controller: see `~/.local/share/plasmaweb/shutdown.log`.

## Edge Cases

- **Machine already off**: abort and power-off are skipped; marker is still written and shutdown proceeds.
- **Abort or power-off fails**: logged as warning; shutdown still continues (best effort).
- **plasmaweb not started by LinuxCNC** (manual dev run): parent is not detected as LinuxCNC → immediate poweroff attempt (no wait for parent).
- **LinuxCNC parent does not exit within 60 s**: poweroff proceeds anyway (logged).
- **Stale shutdown marker** (crash before `maybe_shutdown_system`): marker remains; next normal plasmaweb exit may trigger poweroff — user should remove `~/.local/share/plasmaweb/shutdown-requested` if that happens.

## Errors

| Code / case | When | UI |
|-------------|------|-----|
| `shutdown_unavailable` | Poweroff not configured | Localized error toast |
| WebSocket timeout | ACK not received in time (~40 s shutdown / ~8 s close) | Timeout toast |
| `noConnection` | WebSocket not open | Error toast |
| Poweroff helper missing at runtime | Logged in `shutdown.log` | No GUI feedback after browser closed |

## Related Features

- [`04_MACHINE_ON_OFF.md`](04_MACHINE_ON_OFF.md) — machine power off during shutdown sequence
- [`03_MACHINE_ESTOP.md`](03_MACHINE_ESTOP.md) — E-stop state independent of exit dialog
- [`08_WINDOW_MODE.md`](08_WINDOW_MODE.md) — kiosk vs windowed browser (exit still via power icon)
