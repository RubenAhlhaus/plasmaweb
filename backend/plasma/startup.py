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
from typing import Any, Dict, NamedTuple, Optional

from backend import config
from backend.plasma.config_service import PlasmaConfigService
from backend.plasma.hal_bridge import HalBridge, NativeHalRuntime
from backend.plasma.machine_files import ini_path, ini_real, machine_files
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


class PlasmaStack(NamedTuple):
    """What the app needs from the plasma layer, or all-``None`` when there is no HAL."""

    bridge: Optional[HalBridge] = None
    service: Optional[PlasmaService] = None
    config: Optional[PlasmaConfigService] = None


def create_plasma_stack() -> PlasmaStack:
    """Export the ``qtplasmac`` component and return the bridge plus its service.

    Also recreates the HAL links QtPlasmaC makes at startup (``plasmac.axis-*-limit`` from
    the INI, plasmac outputs into our own pins), because a machine wired for QtPlasmaC
    expects them to exist, and initialises the output pins QtPlasmaC does not leave at zero.

Then it loads the machine's materials and plasma parameters and writes them to their
    setpoints, because a plasmac with parameters at zero cannot cut: ``arc-max-starts`` at 0
    pauses the program on the first pierce, ``pid-p-gain`` at 0 freezes the THC.

    Returns an all-``None`` stack when the plasma layer is disabled or HAL is unavailable.
    Polling does **not** start here — :meth:`HalBridge.start` belongs in the lifespan, once
    there is an event loop to publish into. The parameter writes queued here are applied on
    the bridge thread's first pass.
    """
    if not config.PLASMA_ENABLED:
        logger.info("plasma: disabled via LCNCGUI_PLASMA_ENABLED")
        return PlasmaStack()

    try:
        runtime = NativeHalRuntime()
    except ImportError:
        logger.info("plasma: no LinuxCNC hal module in this process; plasma layer inactive")
        return PlasmaStack()

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
        return PlasmaStack()

    return PlasmaStack(bridge, PlasmaService(bridge), create_plasma_config(bridge))


def create_plasma_config(bridge: HalBridge) -> Optional[PlasmaConfigService]:
    """Load the machine's materials and parameters and put them on their setpoints.

    A machine with no ``<machine>.prefs`` yet still gets QtPlasmaC's defaults on the pins —
    that is better than zeros, and it is what QtPlasmaC would write into the file on its own
    first run.
    """
    files = machine_files()
    if files is None:
        logger.info("plasma: no INI in the environment; materials and parameters unavailable")
        return None

    service = PlasmaConfigService(bridge, files)
    try:
        service.load()
        service.apply_parameters()
        service.apply_enables()
        service.apply_selected_material()
    except Exception:
        logger.exception("plasma: could not apply the machine's materials and parameters")
    return service
