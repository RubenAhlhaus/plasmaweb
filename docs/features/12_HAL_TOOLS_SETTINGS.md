# 12_HAL_TOOLS_SETTINGS

## Description
From **Settings**, the operator can launch standard LinuxCNC HAL helper programs on the machine running the plasmaweb backend — the same tools available on the gmoccapy settings page (ClassicLadder, HAL Scope, HAL Status, HAL Meter, HAL Calibration, HAL Show).

Tool IDs are defined once in [`resources/hal-tool-ids.json`](../../resources/hal-tool-ids.json) and shared by backend and frontend.

## UI Interaction
- Open **Settings** from the right sidebar.
- In the **HAL tools** group, click one of the labeled buttons.
- The corresponding program is started on the LinuxCNC host in a separate window (when available).

Button order matches gmoccapy settings (bottom button list in settings mode): ClassicLadder, HAL Scope, HAL Status, linuxcnctop, HAL Meter, HAL Calibration, HAL Show.

## Preconditions
- plasmaweb backend is reachable (`POST /api/hal-tools/launch`).
- Programs run on the **LinuxCNC machine** (not in the browser); GUI tools need a working display session on that host (`DISPLAY` or `WAYLAND_DISPLAY`, same as gmoccapy).
- **HAL Calibration** requires a resolvable LinuxCNC INI path (`stat.ini_filename` or `INI_FILE_NAME` / `LINUXCNC_INI` / `INI_FILE`).
- **ClassicLadder** requires the `classicladder_rt` HAL component to be loaded.

## Event order
1. User clicks a HAL tool button in Settings.
2. Frontend sends `POST /api/hal-tools/launch` with `{ "tool": "<id>" }`.
3. Backend checks display session, resolves the launch command (gmoccapy-compatible: `tclsh …/halshow.tcl`, `halmeter`, `halscope`, `linuxcnctop`, `tclsh …/emccalib.tcl -- -ini …`, `classicladder`), and starts it detached (`subprocess.Popen`, new session).
4. Backend waits briefly (~350 ms); if the process already exited with a non-zero code, the launch is treated as failed.
5. HTTP **200** `{ "ok": true }` on success; the UI shows no extra confirmation (the tool window appears on the host).

Launch work runs in a worker thread (`asyncio.to_thread`) so the FastAPI event loop is not blocked by `halcmd` or `stat.poll()`.

## User Feedback
- On success: no toast; the external tool window opens on the LinuxCNC machine.
- On failure: error toast with a **localized** message from `settings:halTools.errors.<code>` (mapped from backend `detail.code`; unknown codes fall back to a generic message).
- While a launch request is in flight, all HAL tool buttons are briefly disabled.

## Edge Cases
- **Dev on Windows/macOS:** launch may succeed at the API level on Windows (no DISPLAY check); on Linux without a display session, `display_unavailable` is returned before spawn.
- **Multiple clicks:** only one launch request at a time from Settings; repeated launches of the same tool are allowed after the request completes (each opens another instance, like gmoccapy).
- **Missing `LINUXCNC_TCL_DIR`:** HAL Show falls back to PATH (`halshow`) or fails with `halshow_unavailable`.
- **Immediate process exit:** e.g. missing X server after spawn → `launch_failed` (HTTP 503) and localized toast.

## Errors
| Code | HTTP | Meaning |
|------|------|---------|
| `halshow_unavailable` | 422 | `halshow.tcl` / `tclsh` / `halshow` not found |
| `halmeter_unavailable` | 422 | `halmeter` not in PATH |
| `halscope_unavailable` | 422 | `halscope` not in PATH |
| `linuxcnctop_unavailable` | 422 | `linuxcnctop` not in PATH |
| `hal_calibration_unavailable` | 422 | `emccalib.tcl` / `tclsh` missing |
| `ini_path_unavailable` | 422 | INI path unknown (calibration only) |
| `classicladder_unavailable` | 422 | `classicladder_rt` missing or `classicladder` not in PATH |
| `display_unavailable` | 422 | No `DISPLAY` / `WAYLAND_DISPLAY` on Unix |
| `launch_failed` | 503 | `Popen` error or immediate non-zero exit |
| `network_error` | — | Frontend could not reach the backend |

HTTP error body: `{ "detail": { "code", "message" } }` (`message` is English from backend; UI prefers localized strings by `code`).

Invalid `tool` values are rejected by the API with **422** (validation).

## Related Features
- [08_WINDOW_MODE.md](08_WINDOW_MODE.md) — other Settings options
- [05_TOOL_TABLE.md](05_TOOL_TABLE.md) — HAL / PostGUI context on the LinuxCNC host
