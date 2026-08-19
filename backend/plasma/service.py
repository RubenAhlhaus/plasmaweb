"""Plasma control operations, expressed as writes to plasmac setpoints.

This layer is deliberately thin and reactive-free: every method here turns a UI intent into
one or more pin writes and returns. Nothing polls, nothing waits for a pin to change, and
nothing reacts to a plasmac output — that logic lives in the realtime component (see the
safety boundary in BUILD_PLAN.md).

Kept free of asyncio and FastAPI so it can be unit-tested against a fake HAL runtime.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

from backend.plasma.hal_bridge import HalBridge, PinWriteRejected
from backend.plasma.pins import (
    PLASMAC_COMPONENT,
    QTPLASMAC_COMPONENT,
    SETPOINT,
    hal_name,
    plasmac_pin,
)
from backend.plasma.state import state_payload

logger = logging.getLogger(__name__)

#: Toggles the MAIN tab exposes. Anything else has to go through ``set_param``, so a typo in
#: the frontend cannot flip an unrelated pin.
ENABLE_PINS: Dict[str, str] = {
    "torch": "torch-enable",
    "thc": "thc-enable",
    "thcAuto": "thc-auto",
    "cornerlock": "cornerlock-enable",
    "voidlock": "voidlock-enable",
    "autoVolts": "use-auto-volts",
    "mesh": "mesh-enable",
    "ohmicProbe": "ohmic-probe-enable",
}

#: ``torch-pulse-hold`` and ``torch-pulse-abort`` only exist from LinuxCNC 2.10 on; on 2.9.x
#: the pulse still works, it just cannot be held or aborted early.
_OPTIONAL_PULSE_PINS = ("torch-pulse-hold", "torch-pulse-abort")


class PlasmaService:
    """UI intents → plasmac setpoint writes, through :class:`HalBridge`'s policy check."""

    def __init__(self, bridge: HalBridge) -> None:
        self._bridge = bridge

    # ---- reads ---------------------------------------------------------------------

    @property
    def bridge(self) -> HalBridge:
        return self._bridge

    def snapshot_payload(self) -> Dict[str, Any]:
        """Full snapshot plus decoded state — what a client gets on connect."""
        snapshot = self._bridge.snapshot()
        plasmac = snapshot.get(PLASMAC_COMPONENT, {})
        return {
            "pins": snapshot,
            "state": state_payload(plasmac.get("state-out"), plasmac.get("stop-type-out")),
            "missingPins": list(self._bridge.missing_pins),
        }

    # ---- writes --------------------------------------------------------------------

    def set_param(self, name: str, value: Any) -> None:
        """Write one ``plasmac.*`` setpoint. Rejects anything that is not a setpoint."""
        pin = plasmac_pin(name)  # KeyError → unknown pin, handled by the caller
        if pin.policy != SETPOINT:
            raise PinWriteRejected(
                "pin_not_writable",
                f"plasmac.{name} is {pin.policy}; set_param only writes setpoints",
            )
        self._bridge.request_write(PLASMAC_COMPONENT, name, value)

    def set_enable(self, key: str, enabled: bool) -> str:
        """Flip one of the named MAIN-tab toggles. Returns the pin it wrote."""
        try:
            name = ENABLE_PINS[key]
        except KeyError:
            raise PinWriteRejected(
                "unknown_enable",
                f"'{key}' is not a plasma toggle; expected one of {', '.join(sorted(ENABLE_PINS))}",
            )
        self._bridge.request_write(PLASMAC_COMPONENT, name, bool(enabled))
        return name

    def torch_enable(self, enabled: bool) -> None:
        self._bridge.request_write(PLASMAC_COMPONENT, "torch-enable", bool(enabled))

    def thc_enable(self, enabled: bool) -> None:
        self._bridge.request_write(PLASMAC_COMPONENT, "thc-enable", bool(enabled))

    def height_override(self, volts: float) -> None:
        """Absolute THC height override in volts.

        The UI owns the increment (QtPlasmaC's ±1 V buttons and reset) and sends the
        resulting value; keeping the arithmetic in one place avoids two sources of truth
        for what the current override is.
        """
        self._bridge.request_write(PLASMAC_COMPONENT, "height-override", float(volts))

    def torch_pulse(
        self, action: str, seconds: Optional[float] = None
    ) -> Tuple[str, List[str]]:
        """Momentary torch pulse, following QtPlasmaC's pin protocol exactly.

        ``press`` sets the pulse time and raises start+hold; ``release`` drops both;
        ``abort`` pulses ``torch-pulse-abort``. A press while the torch is already on is
        refused — the realtime component owns the torch, and pulsing over a live cut is
        exactly what its interlock is for.

        Returns the action taken and the names of pins skipped because this LinuxCNC build
        does not have them.
        """
        if action not in ("press", "release", "abort"):
            raise PinWriteRejected(
                "invalid_action", f"torch_pulse action must be press, release or abort; got {action!r}"
            )

        skipped: List[str] = []
        if action == "press":
            if self._plasmac_value("torch-on"):
                raise PinWriteRejected(
                    "torch_already_on", "the torch is on; a pulse would fight the running cut"
                )
            if seconds is not None:
                self._bridge.request_write(PLASMAC_COMPONENT, "torch-pulse-time", float(seconds))
            self._bridge.request_write(PLASMAC_COMPONENT, "torch-pulse-start", True)
            skipped += self._write_if_present("torch-pulse-hold", True)
        elif action == "release":
            self._bridge.request_write(PLASMAC_COMPONENT, "torch-pulse-start", False)
            skipped += self._write_if_present("torch-pulse-hold", False)
        else:
            skipped += self._write_if_present("torch-pulse-abort", True)
            self._bridge.request_write(PLASMAC_COMPONENT, "torch-pulse-start", False)
            skipped += self._write_if_present("torch-pulse-hold", False)
        return action, skipped

    def clear_torch_pulse_abort(self) -> List[str]:
        """Drop ``torch-pulse-abort`` again — QtPlasmaC does this 50 ms after raising it."""
        return self._write_if_present("torch-pulse-abort", False)

    # ---- helpers -------------------------------------------------------------------

    def _plasmac_value(self, name: str) -> Any:
        return self._bridge.snapshot().get(PLASMAC_COMPONENT, {}).get(name)

    def _write_if_present(self, name: str, value: Any) -> List[str]:
        """Write a pin that older LinuxCNC builds may not have; report it if absent."""
        full_name = hal_name(PLASMAC_COMPONENT, plasmac_pin(name))
        if full_name in self._bridge.missing_pins:
            if name not in _OPTIONAL_PULSE_PINS:
                logger.warning("plasma: skipped write to absent pin %s", full_name)
            return [full_name]
        self._bridge.request_write(PLASMAC_COMPONENT, name, value)
        return []

    def set_own_output(self, name: str, value: Any) -> None:
        """Write one of our own ``qtplasmac.*`` outputs (LEDs, laser-on, scale, …)."""
        self._bridge.request_write(QTPLASMAC_COMPONENT, name, value)
