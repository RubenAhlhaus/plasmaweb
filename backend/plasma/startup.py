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
from typing import Optional, Tuple

from backend import config
from backend.plasma.hal_bridge import HalBridge, NativeHalRuntime
from backend.plasma.service import PlasmaService

logger = logging.getLogger(__name__)


def create_plasma_stack() -> Tuple[Optional[HalBridge], Optional[PlasmaService]]:
    """Export the ``qtplasmac`` component and return the bridge plus its service.

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
    except Exception:
        # A failure here is usually "component already exists" (a stale backend) or HAL not
        # running yet. Log it and carry on without the plasma layer rather than refusing to
        # serve the UI at all.
        logger.exception("plasma: could not export the qtplasmac HAL component")
        return None, None

    return bridge, PlasmaService(bridge)
