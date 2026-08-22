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


# ---- [ENABLE_OPTIONS] ---------------------------------------------------------------


def test_the_remembered_toggles_default_the_way_qtplasmac_does(files) -> None:
    from backend.plasma.parameters import read_enables

    enables = read_enables(files.prefs_path)

    assert enables["thc-enable"] is True
    assert enables["cornerlock-enable"] is True
    assert enables["voidlock-enable"] is False
    assert enables["thc-auto"] is False
    # Torch enable is not remembered: a machine must not come up with the torch armed.
    assert "torch-enable" not in enables


def test_a_toggle_round_trips_through_the_prefs_file(files) -> None:
    from backend.plasma.parameters import read_enables, write_enable

    write_enable(files.prefs_path, "thc-enable", False)

    assert "THC enable = False" in Path(files.prefs_path).read_text()
    assert read_enables(files.prefs_path)["thc-enable"] is False


def test_a_toggle_that_is_not_remembered_is_not_written(files) -> None:
    from backend.plasma.parameters import enable_for_pin, write_enable

    write_enable(files.prefs_path, "torch-enable", True)

    assert enable_for_pin("torch-enable") is None
    assert not Path(files.prefs_path).exists() or "Torch" not in Path(files.prefs_path).read_text()


def test_a_non_boolean_in_the_file_falls_back_with_a_warning(files, caplog) -> None:
    from backend.plasma.parameters import read_enables

    Path(files.prefs_path).write_text("[ENABLE_OPTIONS]\nTHC enable = sometimes\n")

    with caplog.at_level("WARNING"):
        enables = read_enables(files.prefs_path)

    assert enables["thc-enable"] is True
    assert "THC enable" in caplog.text


# ---- [CONVERSATIONAL] ---------------------------------------------------------------


def test_conversational_settings_default_the_way_qtplasmac_does(files) -> None:
    from backend.plasma.parameters import read_conversational_settings

    settings = read_conversational_settings(files.prefs_path)

    assert settings["Origin"] == 0
    assert settings["Leadin"] == 0.0
    assert settings["Hole diameter"] == 32.0
    assert settings["Hole speed"] == 60
    assert isinstance(settings["Hole speed"], int)


def test_an_imperial_machines_hole_diameter_is_in_inches(files) -> None:
    from backend.plasma.parameters import read_conversational_settings

    settings = read_conversational_settings(files.prefs_path, units_per_mm=0.03937)

    assert settings["Hole diameter"] == 1.26


def test_conversational_settings_round_trip(files) -> None:
    from backend.plasma.parameters import (
        read_conversational_settings,
        write_conversational_settings,
    )

    write_conversational_settings(
        files.prefs_path,
        {"Leadin": 4.5, "Hole speed": 55, "Preamble": "G21\\nG64P0.25"},
    )
    text = Path(files.prefs_path).read_text()

    assert "[CONVERSATIONAL]" in text
    assert "Leadin = 4.5" in text
    # int keys stay ints, so QtPlasmaC's getint still reads them.
    assert "Hole speed = 55" in text
    settings = read_conversational_settings(files.prefs_path)
    assert settings["Leadin"] == 4.5
    assert settings["Preamble"] == "G21\\nG64P0.25"


def test_an_unknown_conversational_setting_is_refused(files, caplog) -> None:
    from backend.plasma.parameters import write_conversational_settings

    with caplog.at_level("WARNING"):
        write_conversational_settings(files.prefs_path, {"Sparkle": 1})

    assert "Sparkle" not in Path(files.prefs_path).read_text()
    assert "Sparkle" in caplog.text


# ---- [OFFSET_PROBING] ---------------------------------------------------------------


def test_offset_probing_defaults_to_no_offset(files) -> None:
    from backend.plasma.parameters import read_offset_probing

    values = read_offset_probing(files.prefs_path)

    assert values == {"X axis": 0.0, "Y axis": 0.0, "Delay": 0.0}


def test_offset_probing_round_trips_and_maps_onto_its_pins(files) -> None:
    from backend.plasma.parameters import (
        offset_probing_pin_values,
        read_offset_probing,
        write_offset_probing,
    )

    write_offset_probing(files.prefs_path, {"X axis": 25.0, "Y axis": -10.0, "Delay": 0.5})
    values = read_offset_probing(files.prefs_path)

    assert values == {"X axis": 25.0, "Y axis": -10.0, "Delay": 0.5}
    assert offset_probing_pin_values(values) == {
        "offset-probe-x": 25.0,
        "offset-probe-y": -10.0,
        "offset-probe-delay": 0.5,
    }


def test_an_unknown_offset_probing_key_is_refused(files, caplog) -> None:
    from backend.plasma.parameters import write_offset_probing

    with caplog.at_level("WARNING"):
        write_offset_probing(files.prefs_path, {"Z axis": 5.0})

    assert "Z axis" not in Path(files.prefs_path).read_text()
    assert "Z axis" in caplog.text


def test_the_laser_and_camera_offsets_round_trip(tmp_path) -> None:
    """Where each peripheral sits vs the torch — the number every alignment depends on."""
    from backend.plasma.parameters import read_peripheral_offset, write_peripheral_offset

    path = tmp_path / "machine.prefs"
    path.write_text("[GUI_OPTIONS]\nMode = 0\n")

    assert read_peripheral_offset(str(path), "LASER_OFFSET") == {"X axis": 0.0, "Y axis": 0.0}

    write_peripheral_offset(str(path), "LASER_OFFSET", {"X axis": 12.5, "Y axis": -3.0})
    assert read_peripheral_offset(str(path), "LASER_OFFSET") == {"X axis": 12.5, "Y axis": -3.0}
    # The other section is untouched, and so is everything else in the file.
    assert read_peripheral_offset(str(path), "CAMERA_OFFSET") == {"X axis": 0.0, "Y axis": 0.0}
    assert "Mode = 0" in path.read_text()


def test_an_unknown_peripheral_section_is_refused(tmp_path) -> None:
    import pytest as _pytest

    from backend.plasma.parameters import read_peripheral_offset

    path = tmp_path / "machine.prefs"
    path.write_text("")
    with _pytest.raises(KeyError):
        read_peripheral_offset(str(path), "TORCH_OFFSET")
