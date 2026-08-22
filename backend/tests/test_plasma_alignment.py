"""Sheet alignment: the two-point routine that squares a job to a crooked plate."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pytest

from backend.plasma.alignment import (
    IDLE,
    MARK_EDGE,
    SET_ORIGIN,
    AlignmentError,
    SheetAlignment,
    machine_area,
    sheet_angle,
)

INI = """\
[EMC]
MACHINE = metric
[TRAJ]
LINEAR_UNITS = mm
[AXIS_X]
MIN_LIMIT = 0
MAX_LIMIT = 1200
[AXIS_Y]
MIN_LIMIT = 0
MAX_LIMIT = 1200
"""


class FakeResult:
    def __init__(self, ok: bool = True, code: str = "", message: str = "") -> None:
        self.ok = ok
        self.error_code = code
        self.error_message = message


class FakeGateway:
    def __init__(self, position: Optional[Tuple[float, float, float]] = (100.0, 100.0, 0.0)) -> None:
        self.position = position
        self.mdi: List[str] = []
        self.ok = True

    def machine_position(self):
        return self.position

    def program_mdi(self, text: str) -> FakeResult:
        self.mdi.append(text)
        return FakeResult(self.ok, "not_idle", "the interpreter is busy")


class FakeConfig:
    def __init__(self, laser=(10.0, 20.0), camera=(0.0, 0.0)) -> None:
        self.offsets = {
            "LASER_OFFSET": {"X axis": laser[0], "Y axis": laser[1]},
            "CAMERA_OFFSET": {"X axis": camera[0], "Y axis": camera[1]},
        }
        self.laser_states: List[bool] = []

    def peripheral_offset(self, section: str) -> Dict[str, float]:
        return dict(self.offsets[section])

    def set_laser(self, on: bool) -> None:
        self.laser_states.append(on)


@pytest.fixture()
def ini(tmp_path: Path) -> str:
    path = tmp_path / "machine.ini"
    path.write_text(INI)
    return str(path)


def build(ini_path: str, **kwargs: Any):
    gateway = FakeGateway(kwargs.pop("position", (100.0, 100.0, 0.0)))
    config = FakeConfig(**kwargs)
    return SheetAlignment(gateway, config, ini_path), gateway, config


# ---- the angle -----------------------------------------------------------------------


def test_the_angle_is_upstreams_own_arithmetic_quirks_included() -> None:
    """Marking the same two points in both GUIs has to give the same plate angle."""
    # A shallow move to the right: atan gives ~26.6°, and upstream's +180 puts it there.
    assert sheet_angle(100.0, 50.0) == pytest.approx(math.degrees(math.atan(0.5)) + 180)
    # Steeper than it is wide, so upstream subtracts 90 after the quadrant correction.
    assert sheet_angle(50.0, 100.0) == pytest.approx(
        math.degrees(math.atan(2.0)) + 180 - 90
    )
    # Leftwards and up lands in the +360 branch.
    assert sheet_angle(-100.0, 50.0) == pytest.approx(
        math.degrees(math.atan(-0.5)) + 360
    )


def test_a_single_axis_move_reads_180_in_the_positive_direction() -> None:
    """Also upstream's: a plate edge along +X is 180, along -X is 0."""
    assert sheet_angle(100.0, 0.0) == 180.0
    assert sheet_angle(-100.0, 0.0) == 0.0
    assert sheet_angle(0.0, 100.0) == 180.0
    assert sheet_angle(0.0, -100.0) == 0.0


def test_two_marks_in_the_same_place_are_not_a_rotation() -> None:
    assert sheet_angle(0.0, 0.0) == 0.0


# ---- the button ----------------------------------------------------------------------


def test_the_three_presses_walk_the_three_states(ini: str) -> None:
    alignment, gateway, config = build(ini)

    assert alignment.press("laser")["state"] == MARK_EDGE
    assert alignment.press("laser")["state"] == SET_ORIGIN
    assert alignment.press("laser")["state"] == IDLE


def test_marking_the_edge_clears_the_rotation_first(ini: str) -> None:
    """A leftover R from the last plate would twist this one's marks."""
    alignment, gateway, _config = build(ini)

    alignment.press("laser")
    alignment.press("laser")

    assert gateway.mdi == ["G10 L2 P0 R0"]


def test_setting_the_origin_puts_it_where_the_laser_is(ini: str) -> None:
    """The laser hangs off the torch; an origin at the torch is off by that distance."""
    alignment, gateway, _config = build(ini, laser=(10.0, 20.0))

    alignment.press("laser")
    alignment.press("laser")  # first mark at 100, 100
    gateway.position = (300.0, 100.0, 0.0)
    status = alignment.press("laser")

    assert gateway.mdi == [
        "G10 L2 P0 R0",
        "G10 L20 P0 X10.0 Y20.0",
        "G10 L2 P0 R180.0",
        "G0 X0 Y0",
    ]
    assert status["angle"] == 180.0


def test_the_laser_is_on_for_the_marking_and_off_afterwards(ini: str) -> None:
    alignment, gateway, config = build(ini)

    alignment.press("laser")
    assert config.laser_states == [True]

    alignment.press("laser")
    gateway.position = (300.0, 100.0, 0.0)
    alignment.press("laser")
    assert config.laser_states == [True, False]


def test_cancelling_leaves_the_work_offsets_alone(ini: str) -> None:
    alignment, gateway, config = build(ini)

    alignment.press("laser")
    alignment.press("laser")
    status = alignment.cancel()

    assert status["state"] == IDLE
    assert gateway.mdi == ["G10 L2 P0 R0"]  # nothing was set
    assert config.laser_states[-1] is False


def test_a_mark_outside_the_travel_is_refused_before_anything_moves(ini: str) -> None:
    """The laser is offset from the torch, so a mark near the edge can be off the table."""
    alignment, _gateway, config = build(ini, position=(5.0, 5.0, 0.0), laser=(10.0, 20.0))

    with pytest.raises(AlignmentError) as excinfo:
        alignment.press("laser")

    assert excinfo.value.code == "outside_machine_boundary"
    assert config.laser_states == []


def test_a_machine_without_limits_is_not_given_invented_ones(tmp_path: Path) -> None:
    path = tmp_path / "bare.ini"
    path.write_text("[EMC]\nMACHINE = m\n")
    assert machine_area(str(path)) is None

    alignment, _gateway, _config = build(str(path), position=(5.0, 5.0, 0.0))
    assert alignment.press("laser")["state"] == MARK_EDGE


def test_a_peripheral_the_machine_does_not_have_is_refused(ini: str) -> None:
    """Zero on both axes is how QtPlasmaC records "not fitted" and hides the button."""
    alignment, _gateway, _config = build(ini, camera=(0.0, 0.0))

    with pytest.raises(AlignmentError) as excinfo:
        alignment.press("camera")

    assert excinfo.value.code == "not_fitted"
    assert alignment.status()["fitted"] == {"laser": True, "camera": False}


def test_switching_peripheral_part_way_through_is_refused(ini: str) -> None:
    alignment, _gateway, _config = build(ini, camera=(5.0, 5.0))

    alignment.press("laser")
    with pytest.raises(AlignmentError) as excinfo:
        alignment.press("camera")

    assert excinfo.value.code == "alignment_in_progress"


def test_a_refused_mdi_line_stops_the_routine_where_it_was(ini: str) -> None:
    """A half-applied alignment — origin set, rotation not — is worse than a stalled one."""
    alignment, gateway, _config = build(ini)

    alignment.press("laser")
    gateway.ok = False
    with pytest.raises(AlignmentError) as excinfo:
        alignment.press("laser")

    assert excinfo.value.code == "not_idle"
    assert alignment.status()["state"] == MARK_EDGE


def test_alignment_needs_a_position(ini: str) -> None:
    alignment, gateway, _config = build(ini)
    gateway.position = None

    with pytest.raises(AlignmentError) as excinfo:
        alignment.press("laser")
    assert excinfo.value.code == "position_unavailable"


def test_an_unknown_peripheral_is_refused(ini: str) -> None:
    alignment, _gateway, _config = build(ini)

    with pytest.raises(AlignmentError) as excinfo:
        alignment.press("plasma cutter")
    assert excinfo.value.code == "unknown_peripheral"
