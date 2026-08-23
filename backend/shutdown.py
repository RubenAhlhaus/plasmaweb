"""System shutdown helpers for app.exit with shutdown=true."""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
from pathlib import Path

from backend.adapters.linuxcnc_gateway import LinuxCncGateway

logger = logging.getLogger(__name__)

_STATE_OFF = 3
_SHUTDOWN_ABORT_TIMEOUT_S = 10.0
_SHUTDOWN_POWER_OFF_WAIT_S = 3.0
_SHUTDOWN_POWER_OFF_POLL_INTERVAL_S = 0.05
_SHUTDOWN_POWER_OFF_RETRIES = 6
_SHUTDOWN_POWER_OFF_RETRY_INTERVAL_S = 0.25


def shutdown_marker_path() -> Path:
    data_home = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    return data_home / "plasmaweb" / "shutdown-requested"


def mark_shutdown_requested() -> None:
    path = shutdown_marker_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()


def shutdown_helper_path() -> Path | None:
    root = os.environ.get("LCNCGUI_ROOT")
    if not root:
        return None
    helper = Path(root) / "bin" / "plasmaweb-shutdown"
    if helper.is_file() and os.access(helper, os.X_OK):
        return helper
    return None


def can_schedule_system_shutdown() -> bool:
    """Return whether a shutdown request is likely to succeed."""
    helper = shutdown_helper_path()
    if helper is None:
        return False
    try:
        result = subprocess.run(
            [str(helper), "--dry-run"],
            capture_output=True,
            timeout=5,
            check=False,
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("Shutdown dry-run failed: %s", exc)
        return False


def _machine_is_off(gateway: LinuxCncGateway) -> bool:
    snap = gateway.get_status_snapshot()
    machine = snap.get("machine") if isinstance(snap, dict) else None
    if not isinstance(machine, dict):
        return False
    power_on = machine.get("powerOn")
    task_state = machine.get("task_state")
    if power_on is not False:
        return False
    return task_state is None or int(task_state) == _STATE_OFF


async def _set_power_off_with_retry(
    gateway: LinuxCncGateway, loop: asyncio.AbstractEventLoop
) -> None:
    last_exc: BaseException | None = None
    for attempt in range(_SHUTDOWN_POWER_OFF_RETRIES):
        try:
            await loop.run_in_executor(None, gateway.set_power, False)
            return
        except RuntimeError as exc:
            last_exc = exc
            if "command_in_progress" not in str(exc):
                raise
            if attempt + 1 >= _SHUTDOWN_POWER_OFF_RETRIES:
                break
            await asyncio.sleep(_SHUTDOWN_POWER_OFF_RETRY_INTERVAL_S)
    if last_exc is not None:
        raise last_exc


async def prepare_linuxcnc_for_system_shutdown(gateway: LinuxCncGateway) -> None:
    """
    Best-effort safe state before exit: abort motion, then machine power off.

    Waits briefly for ``powerOn=false`` / ``task_state=STATE_OFF`` so LinuxCNC
    can shut down cleanly before the DISPLAY program exits.
    """
    loop = asyncio.get_running_loop()

    if _machine_is_off(gateway):
        logger.info("Shutdown: machine already off")
        return

    try:
        result = await loop.run_in_executor(
            None,
            lambda: gateway.abort_program(timeout_s=_SHUTDOWN_ABORT_TIMEOUT_S),
        )
        if not result.ok:
            logger.warning(
                "Shutdown: abort before power off failed: %s",
                result.error_message or result.error_code,
            )
    except Exception:
        logger.warning("Shutdown: abort before power off raised", exc_info=True)

    try:
        await _set_power_off_with_retry(gateway, loop)
    except Exception:
        logger.warning("Shutdown: machine power off failed", exc_info=True)
        return

    deadline = loop.time() + _SHUTDOWN_POWER_OFF_WAIT_S
    while loop.time() < deadline:
        if _machine_is_off(gateway):
            logger.info("Shutdown: machine is off")
            return
        await asyncio.sleep(_SHUTDOWN_POWER_OFF_POLL_INTERVAL_S)

    logger.warning(
        "Shutdown: timed out after %.1fs waiting for machine off; continuing anyway",
        _SHUTDOWN_POWER_OFF_WAIT_S,
    )


def request_system_shutdown_after_linuxcnc_exit() -> bool:
    """
    Mark shutdown for ``bin/plasmaweb``.

    Poweroff is deferred until after the LinuxCNC DISPLAY process exits (see
    ``maybe_shutdown_system`` in ``bin/plasmaweb``).
    """
    mark_shutdown_requested()
    logger.info("System shutdown requested after LinuxCNC exit (marker written)")
    return True
