"""``[PLASMA_PARAMETERS]``: defaults, round-trip through the prefs file, and pin values."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.plasma.machine_files import machine_files
from backend.plasma.parameters import (
    PLASMA_PARAMETERS,
    SECTION,
    default_parameters,
    parameter,
    parameter_pin_values,
    read_parameters,
    write_parameters,
)

INI = """\
[EMC]
MACHINE = my_plasma

[TRAJ]
LINEAR_UNITS = mm
MAX_LINEAR_VELOCITY = 250

[AXIS_X]
MAX_VELOCITY = 500.0

[AXIS_Y]
MAX_VELOCITY = 500.0

[AXIS_Z]
MAX_VELOCITY = 120.0
OFFSET_AV_RATIO = 0.5
"""


@pytest.fixture(autouse=True)
def _no_inherited_ini(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("INI_FILE_NAME", "LINUXCNC_INI", "INI_FILE"):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture()
def files(tmp_path: Path):
    ini = tmp_path / "machine.ini"
    ini.write_text(INI)
    resolved = machine_files(str(ini))
    assert resolved is not None
    return resolved


def test_every_parameter_that_drives_a_pin_names_a_real_writable_setpoint() -> None:
    from backend.plasma.pins import PLASMAC_PINS, is_writable, plasmac_pin

    known = {pin.name for pin in PLASMAC_PINS}
    for param in PLASMA_PARAMETERS:
        if param.pin is None:
            continue
        assert param.pin in known, param.key
        assert is_writable(plasmac_pin(param.pin)), param.key


def test_defaults_match_qtplasmacs_own(files) -> None:
    defaults = default_parameters(files)

    assert defaults["Arc Maximum Starts"] == 3
    assert defaults["Pid P Gain"] == 10.0
    assert defaults["THC Delay"] == 0.5
    assert defaults["Height Per Volt"] == 0.1
    # thcFeedRate * 0.8, where thcFeedRate is 120 * 0.5 * 60.
    assert defaults["Setup Feed Rate"] == pytest.approx(2880.0)
    # min(500 * 30, 500 * 30, [TRAJ] MAX_LINEAR_VELOCITY) * 0.8.
    assert defaults["Offset Feed Rate"] == pytest.approx(200.0)


def test_imperial_defaults_are_scaled_the_way_qtplasmac_scales_them(tmp_path: Path) -> None:
    ini = tmp_path / "machine.ini"
    ini.write_text(INI.replace("LINEAR_UNITS = mm", "LINEAR_UNITS = inch"))
    resolved = machine_files(str(ini))
    assert resolved is not None

    defaults = default_parameters(resolved)

    assert defaults["Float Switch Travel"] == pytest.approx(0.06, abs=0.005)
    assert defaults["Probe Start Height"] == pytest.approx(1.0)


def test_reading_falls_back_per_key_rather_than_all_or_nothing(files) -> None:
    Path(files.prefs_path).write_text(f"[{SECTION}]\nPid P Gain = 22.5\n")

    values = read_parameters(files.prefs_path, default_parameters(files))

    assert values["Pid P Gain"] == 22.5
    assert values["THC Delay"] == 0.5


def test_a_value_that_is_not_a_number_falls_back_with_a_warning(files, caplog) -> None:
    Path(files.prefs_path).write_text(f"[{SECTION}]\nPid P Gain = fast\n")

    with caplog.at_level("WARNING"):
        values = read_parameters(files.prefs_path, default_parameters(files))

    assert values["Pid P Gain"] == 10.0
    assert "Pid P Gain" in caplog.text


def test_parameters_round_trip_and_keep_their_stored_type(files) -> None:
    values = default_parameters(files)
    values["Pid P Gain"] = 12.5
    values["Arc Maximum Starts"] = 4

    write_parameters(files.prefs_path, values)
    text = Path(files.prefs_path).read_text()

    # int keys must not gain a decimal point: QtPlasmaC reads them with getint.
    assert "Arc Maximum Starts = 4\n" in text
    assert "Pid P Gain = 12.5\n" in text
    assert read_parameters(files.prefs_path) == values


def test_writing_leaves_other_sections_alone(files) -> None:
    Path(files.prefs_path).write_text("[GUI_OPTIONS]\nShow Materials = True\n\n")

    write_parameters(files.prefs_path, {"Pid P Gain": 10.0})
    text = Path(files.prefs_path).read_text()

    assert "[GUI_OPTIONS]\nShow Materials = True\n" in text
    assert "[PLASMA_PARAMETERS]\nPid P Gain = 10.0\n" in text


def test_an_unknown_key_is_refused_rather_than_written(files, caplog) -> None:
    with caplog.at_level("WARNING"):
        write_parameters(files.prefs_path, {"Not A Parameter": 1.0})

    assert "Not A Parameter" not in Path(files.prefs_path).read_text()
    assert "Not A Parameter" in caplog.text


def test_pin_values_skip_the_gui_only_parameters(files) -> None:
    pins = parameter_pin_values(default_parameters(files))

    assert pins["pid-p-gain"] == 10.0
    assert pins["arc-max-starts"] == 3
    assert isinstance(pins["arc-max-starts"], int)
    assert parameter("X Pierce Offset").pin is None
    assert "x-pierce-offset" not in pins
