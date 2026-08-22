"""Parameter bounds: what QtPlasmaC's spinboxes allow, enforced where the values arrive."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.plasma.machine_files import MachineFiles
from backend.plasma.parameters import (
    ParameterRejected,
    check_parameters,
    machine_bounds,
    parameter_limits,
)

INI = """\
[EMC]
MACHINE = metric
[TRAJ]
LINEAR_UNITS = mm
MAX_LINEAR_VELOCITY = 200
[AXIS_X]
MAX_VELOCITY = 100
[AXIS_Y]
MAX_VELOCITY = 80
[AXIS_Z]
MAX_VELOCITY = 40
OFFSET_AV_RATIO = 0.5
MIN_LIMIT = -10
MAX_LIMIT = 90
"""


def files(tmp_path: Path, units_per_mm: float = 1.0, ini: str = INI) -> MachineFiles:
    path = tmp_path / "machine.ini"
    path.write_text(ini)
    return MachineFiles(
        ini_path=str(path),
        machine="metric",
        prefs_path=str(tmp_path / "metric.prefs"),
        materials_path=str(tmp_path / "metric_material.cfg"),
        units_per_mm=units_per_mm,
    )


def test_the_three_ceilings_come_from_the_ini(tmp_path: Path) -> None:
    bounds = machine_bounds(files(tmp_path))

    assert bounds.thc_feed_rate == 40 * 0.5 * 60
    assert bounds.offset_feed_rate == 200  # the TRAJ limit beats 80 * 30
    assert bounds.max_height == 100


def test_a_missing_ini_value_means_no_ceiling_rather_than_a_guess(tmp_path: Path) -> None:
    """An invented ceiling silently refuses a setting a real machine allows."""
    bounds = machine_bounds(files(tmp_path, ini="[EMC]\nMACHINE = m\n"))

    assert bounds == (None, None, None)
    assert parameter_limits(files(tmp_path, ini="[EMC]\nMACHINE = m\n"))[
        "Safe Height"
    ].maximum == float("inf")


def test_spotting_time_is_milliseconds_because_the_component_divides_by_a_thousand(
    tmp_path: Path,
) -> None:
    """Labelling it seconds would make every spot 1000× too short."""
    limit = parameter_limits(files(tmp_path))["Spotting Time"]

    assert limit.unit == "mS"
    assert (limit.minimum, limit.maximum, limit.decimals) == (0.0, 9999.0, 0)


def test_void_sense_slope_carries_its_unit(tmp_path: Path) -> None:
    assert parameter_limits(files(tmp_path))["Void Sense Slope"].unit == "V/sec"


def test_heights_and_feed_rates_are_bounded_by_the_machine(tmp_path: Path) -> None:
    limits = parameter_limits(files(tmp_path))

    assert limits["Safe Height"].maximum == 100
    assert limits["Setup Feed Rate"].maximum == 1200
    assert limits["Offset Feed Rate"].maximum == 200


def test_the_probe_may_not_descend_faster_than_the_setup_rate(tmp_path: Path) -> None:
    """A probe faster than the setup rate is a torch into the slats."""
    limits = parameter_limits(files(tmp_path), {"Setup Feed Rate": 500.0})

    assert limits["Probe Feed Rate"].maximum == 500.0


def test_imperial_bounds_are_the_imperial_ones(tmp_path: Path) -> None:
    limits = parameter_limits(files(tmp_path, units_per_mm=1 / 25.4))

    assert limits["Height Per Volt"] == (0.001, 0.01, 3, "in")
    assert limits["X Pierce Offset"].minimum == -0.2


def test_a_value_past_its_bound_is_refused_rather_than_clamped(tmp_path: Path) -> None:
    """A clamped value looks accepted; the operator goes on believing the machine has it."""
    with pytest.raises(ParameterRejected) as excinfo:
        check_parameters(files(tmp_path), {"Height Per Volt": 10.0})

    assert excinfo.value.code == "out_of_range"
    assert excinfo.value.key == "Height Per Volt"
    assert "0.025 and 0.25 mm" in excinfo.value.message


def test_a_value_inside_its_bound_comes_back_in_its_stored_type(tmp_path: Path) -> None:
    checked = check_parameters(
        files(tmp_path), {"Arc Maximum Starts": 3.0, "THC Threshold": 1.5}
    )

    assert checked == {"Arc Maximum Starts": 3, "THC Threshold": 1.5}


def test_an_unknown_key_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ParameterRejected) as excinfo:
        check_parameters(files(tmp_path), {"Nonsense": 1})
    assert excinfo.value.code == "unknown_parameter"


def test_text_where_a_number_belongs_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ParameterRejected) as excinfo:
        check_parameters(files(tmp_path), {"Safe Height": "high"})
    assert excinfo.value.code == "not_a_number"


def test_every_parameter_has_bounds(tmp_path: Path) -> None:
    """A parameter without bounds is one that reaches a live setpoint unchecked."""
    from backend.plasma.parameters import PLASMA_PARAMETERS

    limits = parameter_limits(files(tmp_path))
    assert sorted(limits) == sorted(p.key for p in PLASMA_PARAMETERS)
