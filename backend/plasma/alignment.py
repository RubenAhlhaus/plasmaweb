"""Sheet alignment: squaring the job to a plate that is not square to the table.

A plate never lands straight on the slats. QtPlasmaC's answer is a two-point routine driven
from the alignment laser (or a camera): put the laser on one point of the plate's edge, press,
drive along that edge to a second point, press again — and it sets the work origin *and*
rotates the work coordinate system to match the plate (``sheet_align``,
``qtplasmac_handler.py:5409``). Three MDI lines do the work: ``G10 L20 P0`` for the origin,
``G10 L2 P0 R`` for the rotation, then ``G0 X0 Y0`` to stand on the new origin.

Two details carry the whole thing and are ported rather than invented:

* The **offset** is where the laser sits relative to the torch (``[LASER_OFFSET]``), so the
  origin is set at the *laser's* position, not the torch's — otherwise every job is off by the
  distance between them.
* The **angle** comes from the delta between the two marks, by upstream's own arithmetic,
  quirks included (see :func:`sheet_angle`). Reimplementing it "more correctly" would put this
  UI's origin somewhere QtPlasmaC's is not, on the same plate.

Bounds are checked before anything moves: the laser hangs off the torch, so a mark near the
edge of the table can ask the machine for a position it does not have.
"""

from __future__ import annotations

import logging
import math
from typing import Any, Dict, NamedTuple, Optional, Tuple

logger = logging.getLogger(__name__)

#: The button's three states, in the order pressing it walks them.
IDLE = "idle"
MARK_EDGE = "markedge"
SET_ORIGIN = "setorigin"

#: Which prefs section holds each peripheral's offset.
SECTIONS = {"laser": "LASER_OFFSET", "camera": "CAMERA_OFFSET"}


class AlignmentError(RuntimeError):
    """Alignment could not proceed, with a machine-readable ``code``."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class MachineArea(NamedTuple):
    """The X/Y travel the machine has, from its INI."""

    x_min: float
    x_max: float
    y_min: float
    y_max: float

    def contains(self, x: float, y: float) -> bool:
        return self.x_min <= x <= self.x_max and self.y_min <= y <= self.y_max


def machine_area(ini_path: str) -> Optional[MachineArea]:
    """``[AXIS_X]``/``[AXIS_Y]`` limits, or ``None`` when the INI does not say.

    Without limits there is no bounds check — which is better than a made-up one that refuses
    a mark the machine could actually reach.
    """
    from backend.plasma.machine_files import ini_real  # noqa: PLC0415 — avoids a cycle

    values = [
        ini_real(ini_path, "AXIS_X", "MIN_LIMIT"),
        ini_real(ini_path, "AXIS_X", "MAX_LIMIT"),
        ini_real(ini_path, "AXIS_Y", "MIN_LIMIT"),
        ini_real(ini_path, "AXIS_Y", "MAX_LIMIT"),
    ]
    if any(value is None for value in values):
        return None
    return MachineArea(*values)  # type: ignore[arg-type]


def sheet_angle(x_diff: float, y_diff: float) -> float:
    """The rotation QtPlasmaC derives from two marks along a plate edge, in degrees.

    Ported from ``sheet_align`` (``qtplasmac_handler.py:5427``) branch for branch, including
    the parts that look wrong: ``atan`` (not ``atan2``) with quadrant corrections applied
    afterwards, the ``-90`` when the move is steeper than it is wide, and a single-axis move
    reading 180° for the positive direction. An operator marking the same two points in both
    GUIs has to get the same plate angle, and that matters more than the arithmetic being the
    way one would write it from scratch.
    """
    if x_diff and y_diff:
        angle = math.degrees(math.atan(y_diff / x_diff))
        if x_diff > 0:
            angle += 180
        elif y_diff > 0:
            angle += 360
        if abs(x_diff) < abs(y_diff):
            angle -= 90
        return angle
    if x_diff:
        return 180.0 if x_diff > 0 else 0.0
    if y_diff:
        return 180.0 if y_diff > 0 else 0.0
    return 0.0


class SheetAlignment:
    """The alignment button's state machine, one instance per machine.

    It holds only what a button press cannot recompute: which state the press is in, and where
    the first mark was. Everything else — position, offsets, limits — is read when needed, so a
    parameter saved between two presses takes effect.
    """

    def __init__(self, gateway: Any, config: Any, ini_path: str) -> None:
        self._gateway = gateway
        self._config = config
        self._ini_path = ini_path
        self._state = IDLE
        self._kind = "laser"
        self._first: Optional[Tuple[float, float]] = None

    # ---- what the UI needs to draw the button ---------------------------------------

    def status(self) -> Dict[str, Any]:
        """State, and whether this machine has each peripheral fitted at all."""
        return {
            "state": self._state,
            "kind": self._kind,
            "firstMark": list(self._first) if self._first else None,
            "fitted": {kind: self._fitted(kind) for kind in SECTIONS},
            "offsets": {kind: self._offset(kind) for kind in SECTIONS},
        }

    def _offset(self, kind: str) -> Dict[str, float]:
        return self._config.peripheral_offset(SECTIONS[kind])

    def _fitted(self, kind: str) -> bool:
        """Zero on both axes is how QtPlasmaC records "not fitted" and hides the button."""
        offset = self._offset(kind)
        return bool(offset.get("X axis") or offset.get("Y axis"))

    # ---- the button ------------------------------------------------------------------

    def press(self, kind: str) -> Dict[str, Any]:
        """One press of MARK EDGE / SET ORIGIN, returning the new state."""
        if kind not in SECTIONS:
            raise AlignmentError("unknown_peripheral", f"no peripheral named {kind!r}")
        if self._state != IDLE and kind != self._kind:
            raise AlignmentError(
                "alignment_in_progress",
                f"a {self._kind} alignment is part-way through; cancel it first",
            )
        if not self._fitted(kind):
            raise AlignmentError(
                "not_fitted",
                f"this machine has no {kind} offset configured, so there is nothing to align by",
            )

        self._kind = kind
        if self._state == IDLE:
            return self._begin(kind)
        if self._state == MARK_EDGE:
            return self._mark_edge()
        return self._set_origin(kind)

    def cancel(self) -> Dict[str, Any]:
        """Give up part-way through, leaving the work offsets exactly as they were."""
        self._state = IDLE
        self._first = None
        self._laser(False)
        return self.status()

    # ---- the three steps -------------------------------------------------------------

    def _begin(self, kind: str) -> Dict[str, Any]:
        offset = self._offset(kind)
        x, y = self._position()
        # The peripheral hangs off the torch: check where *it* is, not where the torch is.
        self._require_inside(x - offset["X axis"], y - offset["Y axis"], kind)
        if kind == "laser":
            self._laser(True)
        self._state = MARK_EDGE
        return self.status()

    def _mark_edge(self) -> Dict[str, Any]:
        # Clear any rotation first: the marks are read in unrotated machine coordinates, and a
        # leftover R from the last plate would twist this one.
        self._mdi("G10 L2 P0 R0")
        self._first = self._position()
        self._state = SET_ORIGIN
        return self.status()

    def _set_origin(self, kind: str) -> Dict[str, Any]:
        if self._first is None:  # defensive: SET_ORIGIN is only reachable through _mark_edge
            raise AlignmentError("no_first_mark", "the edge has not been marked yet")
        offset = self._offset(kind)
        x, y = self._position()
        angle = sheet_angle(x - self._first[0], y - self._first[1])

        self._laser(False)
        self._mdi(f"G10 L20 P0 X{offset['X axis']} Y{offset['Y axis']}")
        self._mdi(f"G10 L2 P0 R{angle}")
        self._mdi("G0 X0 Y0")

        self._state = IDLE
        self._first = None
        status = self.status()
        status["angle"] = angle
        return status

    # ---- machine access --------------------------------------------------------------

    def _position(self) -> Tuple[float, float]:
        position = self._gateway.machine_position() if self._gateway else None
        if position is None:
            raise AlignmentError("position_unavailable", "the machine did not report a position")
        return position[0], position[1]

    def _require_inside(self, x: float, y: float, kind: str) -> None:
        area = machine_area(self._ini_path)
        if area is None or area.contains(x, y):
            return
        raise AlignmentError(
            "outside_machine_boundary",
            f"the {kind} would be at {x:g}, {y:g}, outside the machine boundary",
        )

    def _mdi(self, text: str) -> None:
        if self._gateway is None:
            raise AlignmentError("linuxcnc_unavailable", "there is no machine to send MDI to")
        result = self._gateway.program_mdi(text)
        if result is not None and not getattr(result, "ok", True):
            code = getattr(result, "error_code", None) or "mdi_failed"
            message = getattr(result, "error_message", None) or f"{text} was refused"
            # Leave the state where it was: a half-applied alignment is worse than a stalled one.
            raise AlignmentError(code, message)

    def _laser(self, on: bool) -> None:
        """Our own ``qtplasmac.laser_on`` pin, which a machine wires to the laser."""
        try:
            self._config.set_laser(on)
        except Exception:
            logger.warning("plasma: could not switch the alignment laser %s", on, exc_info=True)
