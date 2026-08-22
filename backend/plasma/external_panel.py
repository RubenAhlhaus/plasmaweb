"""External buttons: the ``qtplasmac.ext_*`` pins a machine's own panel drives.

A plasma table usually has physical controls — a pendant, an estop box, arrow buttons for cut
recovery — wired into HAL against the pins this component exports. QtPlasmaC acts on each pin's
edge as if the matching on-screen control had been used (``qtplasmac_handler.py:3027``), and so
does this: the panel is not a second UI, it is the same UI reached from a different button.

Three kinds of pin, and the difference matters:

* **toggles** — a press flips the enable, exactly as tapping the switch would. Following the
  pin's *level* instead would make a latching switch fight the on-screen control.
* **momentary** — the action follows the pin while it is held (a torch pulse, an ohmic test, a
  recovery nudge). Release matters as much as press.
* **program control** — run, pause, resume, abort, on the rising edge only.

Nothing here polls: the publisher already receives every pin diff, and this turns the ones it
recognises into service calls. What it does not recognise it says so about, once, rather than
silently doing nothing — a wired button that does nothing is worse than one that reports it.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Mapping, Optional, Tuple

from backend.plasma.hal_bridge import PinWriteRejected
from backend.plasma.pins import QTPLASMAC_COMPONENT

logger = logging.getLogger(__name__)

EXTERNAL_EVENT = "plasma.external.error"

#: ``ext_*`` pin → the toggle it flips on each press (``ENABLE_PINS`` keys in the service).
TOGGLES: Dict[str, str] = {
    "ext_torch_enable": "torch",
    "ext_thc_enable": "thc",
    "ext_cornerlock_enable": "cornerlock",
    "ext_voidlock_enable": "voidlock",
    "ext_auto_volts_enable": "autoVolts",
    "ext_mesh_mode": "mesh",
    "ext_ohmic_probe_enable": "ohmicProbe",
}

#: The eight recovery directions, in kerf widths, matching the on-screen pad.
CUT_RECOVERY_DIRECTIONS: Dict[str, Tuple[int, int]] = {
    "ext_cutrec_n": (0, 1),
    "ext_cutrec_ne": (1, 1),
    "ext_cutrec_e": (1, 0),
    "ext_cutrec_se": (1, -1),
    "ext_cutrec_s": (0, -1),
    "ext_cutrec_sw": (-1, -1),
    "ext_cutrec_w": (-1, 0),
    "ext_cutrec_nw": (-1, 1),
}

#: Height override buttons: volts added per press, or a reset.
HEIGHT_OVERRIDE_STEPS: Dict[str, Optional[float]] = {
    "ext_height_ovr_plus": 1.0,
    "ext_height_ovr_minus": -1.0,
    "ext_height_ovr_reset": None,
}

#: Pins this layer knows about but does not act on yet, so a wired button is not silently dead.
UNIMPLEMENTED = (
    "ext_touchoff",
    "ext_laser_touchoff",
    "ext_laser_toggle",
    "ext_frame_job",
    "ext_consumables",
    "ext_power",
    "ext_jog_slow",
    "ext_probe",
)

#: How long a default external probe test runs. Upstream takes it from the button's argument;
#: an external button has no argument, so it gets the same five seconds the screen's does.
PROBE_TEST_SECONDS = 5.0


class ExternalPanel:
    """Turns ``ext_*`` pin edges into the same service calls the screen makes."""

    def __init__(self, service: Any, gateway: Any = None, config: Any = None) -> None:
        self._service = service
        self._gateway = gateway
        self._config = config
        self._height_override = 0.0
        self._reported: set = set()

    # ---- the publisher's entry point ------------------------------------------------

    def observe(
        self, diff: Mapping[str, Mapping[str, Any]]
    ) -> List[Tuple[str, Dict[str, Any]]]:
        """React to our own pins changing. Returns ``(event, payload)`` pairs to publish."""
        own = diff.get(QTPLASMAC_COMPONENT, {})
        if not own:
            return []

        events: List[Tuple[str, Dict[str, Any]]] = []
        for name, value in own.items():
            try:
                events += self._handle(name, value)
            except PinWriteRejected as exc:
                # A refused write is worth saying out loud: someone pressed a real button.
                events.append(
                    (EXTERNAL_EVENT, {"code": exc.code, "message": exc.message, "pin": name})
                )
            except Exception:
                logger.exception("plasma: external pin %s failed", name)
        return events

    # ---- the three kinds of pin -----------------------------------------------------

    def _handle(self, name: str, value: Any) -> List[Tuple[str, Dict[str, Any]]]:
        pressed = bool(value)

        if name in TOGGLES:
            # Only the press does anything: the switch is the operator's, the state is HAL's.
            if pressed:
                self._toggle(TOGGLES[name])
            return []

        if name == "ext_ignore_arc_ok":
            if pressed:
                self._toggle_pin("ignore-arc-ok-1")
            return []

        if name == "ext_pulse":
            self._service.torch_pulse("press" if pressed else "release")
            return []

        if name == "ext_ohmic":
            self._service.ohmic_test(pressed)
            return []

        if name in CUT_RECOVERY_DIRECTIONS and pressed:
            x, y = CUT_RECOVERY_DIRECTIONS[name]
            self._service.cut_recovery_offset(x, y, self._kerf_width())
            return []

        if name == "ext_cutrec_fwd":
            self._service.cut_recovery_move(1 if pressed else 0, 100.0)
            return []

        if name == "ext_cutrec_rev":
            self._service.cut_recovery_move(-1 if pressed else 0, 100.0)
            return []

        if name == "ext_cutrec_cancel" and pressed:
            self._service.cut_recovery_cancel()
            return []

        if name in HEIGHT_OVERRIDE_STEPS and pressed:
            step = HEIGHT_OVERRIDE_STEPS[name]
            self._height_override = 0.0 if step is None else self._height_override + step
            self._service.height_override(self._height_override)
            return []

        if name in ("ext_run", "ext_pause", "ext_pause_only", "ext_resume", "ext_abort", "ext_run_pause"):
            return self._program_control(name) if pressed else []

        if name in UNIMPLEMENTED and pressed:
            return self._report_unimplemented(name)

        return []

    # ---- helpers --------------------------------------------------------------------

    def _toggle(self, key: str) -> None:
        from backend.plasma.service import ENABLE_PINS  # noqa: PLC0415 — avoids a cycle

        current = self._plasmac_value(ENABLE_PINS[key])
        self._service.set_enable(key, not bool(current))

    def _toggle_pin(self, pin: str) -> None:
        self._service.set_param(pin, not bool(self._plasmac_value(pin)))

    def _plasmac_value(self, name: str) -> Any:
        from backend.plasma.pins import PLASMAC_COMPONENT  # noqa: PLC0415

        return self._service.bridge.snapshot().get(PLASMAC_COMPONENT, {}).get(name)

    def _kerf_width(self) -> float:
        if self._config is None:
            return 1.0
        try:
            return float(self._config.conversational_defaults().get("kerfWidth", 1.0))
        except Exception:
            return 1.0

    def _program_control(self, name: str) -> List[Tuple[str, Dict[str, Any]]]:
        if self._gateway is None:
            return self._report_unimplemented(name)

        if name == "ext_abort":
            result = self._gateway.abort_program()
        elif name in ("ext_pause", "ext_pause_only"):
            result = self._gateway.program_auto("pause")
        elif name == "ext_resume":
            result = self._gateway.program_auto("resume")
        elif name == "ext_run":
            result = self._gateway.program_auto("run")
        else:  # ext_run_pause: one button for both, as upstream has it
            paused = bool(self._plasmac_value("program-is-paused"))
            running = bool(self._plasmac_value("program-is-running"))
            if running and not paused:
                result = self._gateway.program_auto("pause")
            elif paused:
                result = self._gateway.program_auto("resume")
            else:
                result = self._gateway.program_auto("run")

        if result is not None and not getattr(result, "ok", True):
            return [
                (
                    EXTERNAL_EVENT,
                    {
                        "code": getattr(result, "error_code", None) or "command_failed",
                        "message": getattr(result, "error_message", None) or "",
                        "pin": name,
                    },
                )
            ]
        return []

    def _report_unimplemented(self, name: str) -> List[Tuple[str, Dict[str, Any]]]:
        """Say it once per pin: a wired button that does nothing is worse than one that says so."""
        if name in self._reported:
            return []
        self._reported.add(name)
        logger.info("plasma: external pin qtplasmac.%s is not handled yet", name)
        return [
            (
                EXTERNAL_EVENT,
                {
                    "code": "external_pin_unsupported",
                    "message": f"The external button on qtplasmac.{name} is not supported yet.",
                    "pin": name,
                },
            )
        ]
