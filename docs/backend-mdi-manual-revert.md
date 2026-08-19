# MDI / AUTO → manual mode revert (backend)

This document describes the background poller that switches LinuxCNC back to **manual** task mode (`MODE_MANUAL`) when the machine is in **MDI** (`MODE_MDI`) or **program / AUTO** (`MODE_AUTO`) but is not actively running interpreted motion.

## Location

- Implementation: `backend/services/mdi_manual_revert.py` (`mdi_manual_revert_tick`, `MdiManualRevertPoller`)
- Poll interval: `MDI_MANUAL_REVERT_POLL_INTERVAL_S` in `backend/config.py`

## Preconditions (all must hold)

The poller only attempts a revert when:

- `stat.enabled` is true
- Task state is **ON** (`STATE_ON`)
- Current task mode is **MDI** or **AUTO**
- Interpreter is **idle** (`INTERP_IDLE`)
- Motion is considered quiet: `motion_type == MOTION_TYPE_NONE` and `current_vel` ≈ 0

## Sequence

1. Call `wait_last_command_complete` on the gateway to synchronize with the LinuxCNC command channel before changing task mode (same idea as draining the channel after MDI).
2. Call `set_task_mode(MODE_MANUAL)`.

## `wait_last_command_complete` and program faults

After a failed **AUTO** run or MDI line, LinuxCNC’s `command.wait_complete()` may return **`RCS_ERROR`**, which the gateway surfaces as `GatewayCommandResult` with `error_code == "linuxcnc_command_failed"`.

In that situation the interpreter and motion may already be idle, but the command channel still reports failure. **The poller does not abort the revert** for this error code: it still calls `set_task_mode(MODE_MANUAL)` so the UI does not remain stuck in program mode.

Other wait failures (for example `command_in_progress`, `command_timeout`, `linuxcnc_unavailable`) **do** abort the revert for that tick; the poller will retry on subsequent polls while conditions remain valid.

## Logging

- **Warnings** (throttled, about every 30 seconds): non-`linuxcnc_command_failed` wait failures, and failures of `set_task_mode(MODE_MANUAL)`.
- **Debug** (throttled, same interval): when wait returns `linuxcnc_command_failed` and the code proceeds to attempt manual mode. Throttling avoids flooding logs when debug logging is enabled and the poller runs frequently (e.g. every 0.25 s).

On a successful `set_task_mode(MODE_MANUAL)`, warning and debug throttles for this flow are reset.

## Related UI behaviour

The frontend displays AUTO as a “program” mode in the header; returning to manual restores jogging and other manual-only actions without requiring a manual mode switch from the operator.
