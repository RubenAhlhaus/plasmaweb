"""Restart LinuxCNC from the UI, e.g. right after installing an update.

plasmaweb is LinuxCNC's ``[DISPLAY]`` program, so it cannot restart LinuxCNC from inside: when
it exits, LinuxCNC shuts down, and anything left in its process tree goes with it. So the
backend only leaves a marker and exits; ``bin/plasmaweb`` (the launcher) then starts a
detached helper that waits for LinuxCNC to finish shutting down and starts it again with the
same INI. Same pattern as the system shutdown in :mod:`backend.shutdown`.
"""

from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path

from backend.adapters.linuxcnc_gateway import LinuxCncGateway
from backend.shutdown import prepare_linuxcnc_for_system_shutdown
from backend.uvicorn_server_ref import schedule_backend_exit

logger = logging.getLogger(__name__)


def restart_marker_path() -> Path:
    """Read by ``bin/plasmaweb`` (``restart_marker_file``); keep the two in step."""
    data_home = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    return data_home / "plasmaweb" / "restart-requested"


def _ini_path() -> str | None:
    ini = os.environ.get("INI_FILE_NAME", "").strip()
    return ini if ini and Path(ini).is_file() else None


def can_restart_linuxcnc() -> bool:
    """
    Whether a restart would work: only when ``bin/plasmaweb`` launched this backend as
    LinuxCNC's display (it does the restart), the INI is known, and ``linuxcnc`` is on PATH.
    """
    return (
        os.environ.get("LCNCGUI_DISPLAY_LAUNCH") == "1"
        and _ini_path() is not None
        and shutil.which("linuxcnc") is not None
    )


async def restart_linuxcnc(gateway: LinuxCncGateway) -> bool:
    """
    Turn the machine off, ask the launcher to restart LinuxCNC, and stop this backend.

    Returns False (and does nothing) when :func:`can_restart_linuxcnc` says it would not work.
    """
    ini = _ini_path()
    if not can_restart_linuxcnc() or ini is None:
        return False
    await prepare_linuxcnc_for_system_shutdown(gateway)
    marker = restart_marker_path()
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(ini + "\n", encoding="utf-8")
    logger.info("LinuxCNC restart requested with %s; stopping the backend", ini)
    schedule_backend_exit()
    return True
