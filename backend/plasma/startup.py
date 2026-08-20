"""Build the plasma HAL stack at import time, or decide there is nothing to build.

Timing is the whole point of this module. The ``qtplasmac`` component has to exist and be
``ready()`` before ``[HAL] POSTGUI_HALFILE`` runs, and ``bin/lcncgui`` runs those halfiles
once HTTP answers — so the component is created while ``backend.main`` is being imported,
not in the lifespan handler.

Off the machine (macOS, CI, unit tests) ``import hal`` fails and everything here returns
``None``; the ``plasma`` commands then answer ``plasma_unavailable`` and the rest of the
backend is unaffected.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional, Tuple

from backend import config
from backend.plasma.hal_bridge import HalBridge, NativeHalRuntime
from backend.plasma.service import PlasmaService

logger = logging.getLogger(__name__)

#: Where LinuxCNC puts the active INI path for the processes it launches.
_INI_ENV_KEYS = ("INI_FILE_NAME", "LINUXCNC_INI", "INI_FILE")


def _ini_path() -> Optional[str]:
    for key in _INI_ENV_KEYS:
        raw = os.environ.get(key)
        if not raw:
            continue
        path = os.path.expanduser(raw.strip())
        if os.path.isfile(path):
            return path
    return None


def _ini_reals(ini_path: str, section: str, keys: Tuple[str, ...]) -> Dict[str, float]:
    """Read floats from one INI section, preferring ``linuxcnc.ini`` over a line scan.

    ``linuxcnc.ini`` tolerates the duplicate keys LinuxCNC INIs are allowed to have; the line
    scan is there so this works off the machine (and in tests) where the module is absent.
    """
    found: Dict[str, float] = {}
    try:
        import linuxcnc  # type: ignore

        inifile = linuxcnc.ini(ini_path)
        for key in keys:
            raw = inifile.find(section, key)
            if raw is not None and str(raw).strip():
                found[key] = float(str(raw).strip())
    except Exception:
        logger.debug("plasma: linuxcnc.ini could not read [%s] from %s", section, ini_path,
                     exc_info=True)

    missing = tuple(key for key in keys if key not in found)
    if not missing:
        return found

    try:
        in_section = False
        with open(ini_path, "r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                stripped = line.split("#", 1)[0].split(";", 1)[0].strip()
                if stripped.startswith("[") and stripped.endswith("]"):
                    in_section = stripped[1:-1].strip().upper() == section.upper()
                    continue
                if not in_section or "=" not in stripped:
                    continue
                key, _, value = stripped.partition("=")
                key = key.strip().upper()
                for wanted in missing:
                    if key == wanted.upper() and wanted not in found:
                        try:
                            found[wanted] = float(value.strip())
                        except ValueError:
                            pass
    except OSError:
        logger.debug("plasma: could not read %s", ini_path, exc_info=True)
    return found


def qtplasmac_startup_values() -> Dict[str, Any]:
    """The non-zero values QtPlasmaC's handler gives its own output pins at startup.

    ``gcode_scale`` is 1 while the G-code units and the machine units agree, which is the
    state a freshly started machine is in; QtPlasmaC re-scales it to 25.4 or 1/25.4 when a
    program switches units, and we do not track that yet.

    ``thc_feed_rate`` is QtPlasmaC's ``thcFeedRate``:
    ``[AXIS_Z] MAX_VELOCITY * [AXIS_Z] OFFSET_AV_RATIO * 60``. It is omitted when the INI does
    not say, rather than guessed.
    """
    values: Dict[str, Any] = {"gcode_scale": 1.0}

    ini_path = _ini_path()
    if ini_path:
        axis_z = _ini_reals(ini_path, "AXIS_Z", ("MAX_VELOCITY", "OFFSET_AV_RATIO"))
        if "MAX_VELOCITY" in axis_z and "OFFSET_AV_RATIO" in axis_z:
            values["thc_feed_rate"] = axis_z["MAX_VELOCITY"] * axis_z["OFFSET_AV_RATIO"] * 60.0
        else:
            logger.warning(
                "plasma: [AXIS_Z] MAX_VELOCITY/OFFSET_AV_RATIO missing from %s; "
                "leaving thc_feed_rate at zero",
                ini_path,
            )
    return values


def create_plasma_stack() -> Tuple[Optional[HalBridge], Optional[PlasmaService]]:
    """Export the ``qtplasmac`` component and return the bridge plus its service.

    Also recreates the HAL links QtPlasmaC makes at startup (``plasmac.axis-*-limit`` from
    the INI, plasmac outputs into our own pins), because a machine wired for QtPlasmaC
    expects them to exist, and initialises the output pins QtPlasmaC does not leave at zero.

    Returns ``(None, None)`` when the plasma layer is disabled or HAL is unavailable.
    Polling does **not** start here — :meth:`HalBridge.start` belongs in the lifespan, once
    there is an event loop to publish into.
    """
    if not config.PLASMA_ENABLED:
        logger.info("plasma: disabled via LCNCGUI_PLASMA_ENABLED")
        return None, None

    try:
        runtime = NativeHalRuntime()
    except ImportError:
        logger.info("plasma: no LinuxCNC hal module in this process; plasma layer inactive")
        return None, None

    bridge = HalBridge(runtime, poll_interval_s=config.PLASMA_POLL_INTERVAL_S)
    try:
        bridge.create_component()
        bridge.ready()
        bridge.apply_nets()
        bridge.apply_startup_values(qtplasmac_startup_values())
    except Exception:
        # A failure here is usually "component already exists" (a stale backend) or HAL not
        # running yet. Log it and carry on without the plasma layer rather than refusing to
        # serve the UI at all.
        logger.exception("plasma: could not export the qtplasmac HAL component")
        return None, None

    return bridge, PlasmaService(bridge)
