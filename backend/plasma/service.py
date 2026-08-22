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

from backend.plasma.capabilities import capabilities
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

#: Longest probe test this layer will start. QtPlasmaC's own PROBE TEST button takes its time
#: from a user-button argument and shows a countdown; the point of a ceiling here is that the
#: value arrives over a WebSocket, and "probe for an hour" must not be expressible.
MAX_PROBE_TEST_SECONDS = 30.0

#: Cut recovery motion is a percentage of the cut feed rate — upstream's spinbox is 1…100, and
#: anything above 100 would run the recovery faster than the cut it is recovering.
MAX_RECOVERY_SPEED_PERCENT = 100.0

#: Kerf widths per press on the recovery pad. Upstream moves exactly one; a request for
#: hundreds is a bug or a stuck key, not an operator.
MAX_RECOVERY_STEPS = 10


class PlasmaService:
    """UI intents → plasmac setpoint writes, through :class:`HalBridge`'s policy check."""

    def __init__(self, bridge: HalBridge) -> None:
        self._bridge = bridge
        #: The countdown for a running probe test. It lives with the pin it lowers, so that
        #: whoever stops the test — the timer, a second press, or a probe error seen by the
        #: publisher — cancels the other two through one owner rather than racing them.
        self._probe_test_timer: Any = None

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
            # What this LinuxCNC can actually do, and which parameters reach no pin on it.
            "capabilities": capabilities(self._bridge.missing_pins),
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

        Written to **our own** ``qtplasmac.height_override`` output rather than to
        ``plasmac.height-override``. The two are netted together — that is one of the links
        QtPlasmaC makes and we recreate — which means the plasmac pin already has a writer and
        HAL refuses a second one. Writing our end is what actually moves the torch, and it is
        what upstream does (``heightOverridePin.set``).

        The UI owns the increment (QtPlasmaC's ±1 V buttons and reset) and sends the resulting
        value; keeping the arithmetic in one place avoids two sources of truth for what the
        current override is.
        """
        self._bridge.request_write(QTPLASMAC_COMPONENT, "height_override", float(volts))

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

    # ---- probing and cut recovery ---------------------------------------------------

    def probe_test(self, seconds: float) -> float:
        """Start a timed probe test: ``plasmac.probe-test`` for ``seconds``.

        The *backend* owns the timeout, not the browser. A probe test lowers the torch until it
        senses the material, and a page reload or a dropped WebSocket must not be able to leave
        it doing that — so the pin is raised here and lowered by the caller's timer, and the
        publisher drops it again the moment ``probe-test-error`` says the probe failed.
        """
        if seconds <= 0:
            raise PinWriteRejected(
                "invalid_params", "a probe test needs a time greater than zero"
            )
        if seconds > MAX_PROBE_TEST_SECONDS:
            raise PinWriteRejected(
                "invalid_params",
                f"a probe test may run for at most {MAX_PROBE_TEST_SECONDS:.0f} seconds",
            )
        if self._plasmac_value("torch-on"):
            raise PinWriteRejected(
                "torch_already_on", "the torch is on; probing now would fight the running cut"
            )
        self._bridge.request_write(PLASMAC_COMPONENT, "probe-test", True)
        return float(seconds)

    def probe_test_stop(self) -> None:
        """Lower ``probe-test`` again — on the timer, on a second press, or on a probe error.

        Cancels the countdown as well: leaving it running would let the *old* test's expiry
        arrive in the middle of a new one and lower the pin under it.
        """
        self.cancel_probe_test_timer()
        self._bridge.request_write(PLASMAC_COMPONENT, "probe-test", False)

    def set_probe_test_timer(self, timer: Any) -> None:
        """Hand the countdown to the service, which owns the pin it will lower."""
        self._probe_test_timer = timer

    def probe_test_running(self) -> bool:
        timer = self._probe_test_timer
        return timer is not None and not timer.done()

    def cancel_probe_test_timer(self) -> bool:
        """Stop the countdown if one is running. Returns whether there was one."""
        timer = self._probe_test_timer
        self._probe_test_timer = None
        if timer is None or timer.done():
            return False
        timer.cancel()
        return True

    def ohmic_test(self, enabled: bool) -> None:
        """``plasmac.ohmic-test`` while the operator holds the button, as QtPlasmaC does."""
        self._bridge.request_write(PLASMAC_COMPONENT, "ohmic-test", bool(enabled))

    def cut_recovery_move(self, direction: int, speed_percent: float) -> None:
        """Move along the paused toolpath: ``paused-motion-speed`` plus ``cut-recovery``.

        ``direction`` is +1 forwards, -1 back, 0 stop. Upstream leaves ``cut-recovery`` raised
        when the button is released — the recovery stays armed until it is cancelled or the
        offsets settle back to zero — so stopping means a speed of zero, not lowering the pin.
        """
        if direction not in (-1, 0, 1):
            raise PinWriteRejected(
                "invalid_params", "cut recovery direction must be -1, 0 or 1"
            )
        if not 0 <= speed_percent <= MAX_RECOVERY_SPEED_PERCENT:
            raise PinWriteRejected(
                "invalid_params",
                f"cut recovery speed must be between 0 and {MAX_RECOVERY_SPEED_PERCENT:.0f}%",
            )
        self._bridge.request_write(
            PLASMAC_COMPONENT, "paused-motion-speed", direction * speed_percent * 0.01
        )
        self._bridge.request_write(PLASMAC_COMPONENT, "cut-recovery", True)

    def cut_recovery_offset(self, x_steps: int, y_steps: int, kerf_width: float) -> Tuple[int, int]:
        """Move the torch sideways off the path, in whole kerf widths.

        QtPlasmaC's pad moves one kerf width per press and writes the result into
        ``plasmac.x-offset``/``y-offset``, which are *counts* of ``plasmac.offset-scale``. The
        realtime side owns the actual travel limit; what this refuses is a request it cannot
        express — an offset scale of zero, which would divide by nothing.

        Returns the counts written, for the caller to report.
        """
        if abs(x_steps) > MAX_RECOVERY_STEPS or abs(y_steps) > MAX_RECOVERY_STEPS:
            raise PinWriteRejected(
                "invalid_params",
                f"a recovery move is at most {MAX_RECOVERY_STEPS} kerf widths per press",
            )
        if kerf_width <= 0:
            raise PinWriteRejected(
                "invalid_params", "the material's kerf width must be greater than zero"
            )

        scale = self._plasmac_value("offset-scale")
        try:
            scale = float(scale)
        except (TypeError, ValueError):
            scale = 0.0
        if not scale:
            raise PinWriteRejected(
                "offset_scale_unavailable",
                "plasmac.offset-scale reads zero; the machine cannot offset the torch",
            )

        x_counts = int(kerf_width * x_steps / scale)
        y_counts = int(kerf_width * y_steps / scale)
        current_x = int(self._plasmac_value("x-offset") or 0)
        current_y = int(self._plasmac_value("y-offset") or 0)
        self._bridge.request_write(PLASMAC_COMPONENT, "x-offset", current_x + x_counts)
        self._bridge.request_write(PLASMAC_COMPONENT, "y-offset", current_y + y_counts)
        self._bridge.request_write(PLASMAC_COMPONENT, "cut-recovery", True)
        return x_counts, y_counts

    def laser_recovery(self, x_offset: float, y_offset: float) -> Tuple[int, int]:
        """Put the *alignment laser* where the torch stopped, so the operator can see the spot.

        Restarting a cut means finding exactly where it stopped, and the torch is in the way of
        looking at it. QtPlasmaC's answer (``laser_pressed``, ``qtplasmac_handler.py:5392``) is
        to offset the axes by the laser offset while paused, so the laser sits on the spot; the
        recovery pad then nudges from there, and plasmac reverses the laser offset on resume
        (``plasmac.comp:1122``).

        The offsets are *counts* of ``plasmac.offset-scale``, the same unit the recovery pad
        uses. Returns the counts written.
        """
        if not (x_offset or y_offset):
            raise PinWriteRejected(
                "no_laser_offset",
                "this machine has no laser offset configured, so there is nothing to offset by",
            )

        scale = self._plasmac_value("offset-scale")
        try:
            scale = float(scale)
        except (TypeError, ValueError):
            scale = 0.0
        if not scale:
            raise PinWriteRejected(
                "offset_scale_unavailable",
                "plasmac.offset-scale reads zero; the machine cannot offset the torch",
            )

        x_counts = int(x_offset / scale)
        y_counts = int(y_offset / scale)
        self._bridge.request_write(PLASMAC_COMPONENT, "laser-x-offset", x_counts)
        self._bridge.request_write(PLASMAC_COMPONENT, "laser-y-offset", y_counts)
        # Order matters: the offsets have to be readable when plasmac sees the start request.
        self._bridge.request_write(PLASMAC_COMPONENT, "laser-recovery-start", 1)
        self._bridge.request_write(PLASMAC_COMPONENT, "cut-recovery", True)
        return x_counts, y_counts

    def laser_recovery_started(self) -> None:
        """Drop the start request once plasmac has acted on it.

        Upstream clears it whenever ``laser-recovery-state`` changes
        (``laser_recovery_state_changed``): the pin is a request, not a state, and leaving it
        raised would re-arm the offset the next time the machine paused.
        """
        self._bridge.request_write(PLASMAC_COMPONENT, "laser-recovery-start", 0)

    def powermax_enable(
        self, enabled: bool, cut_mode: float = 0.0, cut_amps: float = 0.0, pressure: float = 0.0
    ) -> None:
        """Turn PowerMax comms on or off, and hand the supply its setpoints.

        Upstream refuses to connect while the cut mode or current is zero
        (``pmx485_enable_changed``): the supply would be commanded to nothing, which is worse
        than not being commanded at all. The setpoints go out before the enable, so the first
        thing the component reads is a valid one.
        """
        if enabled:
            if not cut_mode or not cut_amps:
                raise PinWriteRejected(
                    "invalid_setpoints",
                    "the material's cut mode and cut amps must both be set before "
                    "connecting to the Powermax",
                )
            self._bridge.request_write(QTPLASMAC_COMPONENT, "pmx485_mode_set", float(cut_mode))
            self._bridge.request_write(
                QTPLASMAC_COMPONENT, "pmx485_current_set", float(cut_amps)
            )
            self._bridge.request_write(
                QTPLASMAC_COMPONENT, "pmx485_pressure_set", float(pressure)
            )
        self._bridge.request_write(QTPLASMAC_COMPONENT, "pmx485_enable", bool(enabled))

    def powermax_status(self) -> Dict[str, Any]:
        """What the supply is reporting: connected, its readings, and any fault."""
        from backend.plasma.powermax import format_fault, pressure_unit  # noqa: PLC0415

        own = self._bridge.snapshot().get(QTPLASMAC_COMPONENT, {})

        def number(name: str) -> float:
            try:
                return float(own.get(name) or 0.0)
            except (TypeError, ValueError):
                return 0.0

        current_max = number("pmx485_current_max")
        pressure_max = number("pmx485_pressure_max")
        fault = format_fault(number("pmx485_fault"), current_max)
        return {
            "enabled": bool(own.get("pmx485_enable")),
            "connected": bool(own.get("pmx485_status")),
            "mode": number("pmx485_mode"),
            "current": number("pmx485_current"),
            "currentMin": number("pmx485_current_min"),
            "currentMax": current_max,
            "pressure": number("pmx485_pressure"),
            "pressureMin": number("pmx485_pressure_min"),
            "pressureMax": pressure_max,
            "pressureUnit": pressure_unit(pressure_max),
            "arcTime": number("pmx485_arc_time"),
            "fault": fault.as_dict() if fault else None,
        }

    def cut_recovery_cancel(self) -> None:
        """Give up the recovery: the torch returns to the path and the offsets are dropped."""
        self._bridge.request_write(PLASMAC_COMPONENT, "cut-recovery", False)
        self._bridge.request_write(PLASMAC_COMPONENT, "laser-recovery-start", 0)
        self._bridge.request_write(PLASMAC_COMPONENT, "x-offset", 0)
        self._bridge.request_write(PLASMAC_COMPONENT, "y-offset", 0)
        self._bridge.request_write(PLASMAC_COMPONENT, "paused-motion-speed", 0.0)

    def consumable_change(self, enabled: bool) -> None:
        """``plasmac.consumable-change``: park the torch so consumables can be swapped."""
        self._bridge.request_write(PLASMAC_COMPONENT, "consumable-change", bool(enabled))
