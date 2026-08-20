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
from typing import Any, Dict, Optional, Tuple

from backend import config
from backend.plasma.hal_bridge import HalBridge, NativeHalRuntime
from backend.plasma.machine_files import ini_path, ini_real
from backend.plasma.service import PlasmaService

logger = logging.getLogger(__name__)


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

    path = ini_path()
    if path:
        velocity = ini_real(path, "AXIS_Z", "MAX_VELOCITY")
        ratio = ini_real(path, "AXIS_Z", "OFFSET_AV_RATIO")
        if velocity is not None and ratio is not None:
            values["thc_feed_rate"] = velocity * ratio * 60.0
        else:
            logger.warning(
                "plasma: [AXIS_Z] MAX_VELOCITY/OFFSET_AV_RATIO missing from %s; "
                "leaving thc_feed_rate at zero",
                path,
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
