"""User buttons: parsing the machine owner's `[BUTTONS]` and refusing what we cannot run."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from backend.plasma.user_buttons import (
    MAX_PULSE_SECONDS,
    UserButtonError,
    allow_configured_pins,
    latest_file,
    read_user_buttons,
    user_button,
)

PREFS = """\
[BUTTONS]
1 Name = Probe\\Test
2 Code = probe-test 6
3 Name = Ohmic
3 Code = ohmic-test
4 Name = Extractor
4 Code = toggle-halpin dust-extractor cutcritical
5 Name = Blowdown
5 Code = pulse-halpin air-blast 1.5
6 Name = Park
6 Code = G53 G0 X0 Y0
7 Name = Halshow
7 Code = %halshow
8 Name = Nest
8 Code = load nesting/sheet1.ngc
9 Name = Latest
9 Code = latest-file ~/linuxcnc/nc_files
10 Name = Frame
10 Code = framing
11 Name = Laser
11 Code = G0 X10 Y0 \\ toggle-laser
12 Name = Pulse
12 Code = torch-pulse 0.4
13 Name = Broken
13 Code = pulse-halpin
14 Name = Slow
14 Code = pulse-halpin air-blast 600
"""


@pytest.fixture()
def prefs(tmp_path: Path) -> str:
    path = tmp_path / "machine.prefs"
    path.write_text(PREFS)
    return str(path)


def by_number(prefs_path: str, number: int):
    return user_button(prefs_path, number)


def test_a_name_without_a_code_is_refused_as_upstream_refuses_it(prefs) -> None:
    """Half a definition is more likely a typo than an intention."""
    button = by_number(prefs, 1)

    assert button.supported is False
    assert "both a name and a code" in button.reason


def test_a_multi_line_name_keeps_its_line_break(prefs) -> None:
    assert by_number(prefs, 1).name == "Probe\nTest"


def test_a_code_without_a_name_is_refused_too(prefs) -> None:
    button = by_number(prefs, 2)

    assert button.supported is False


def test_a_probe_test_button_carries_its_own_time(tmp_path: Path) -> None:
    path = tmp_path / "p.prefs"
    path.write_text("[BUTTONS]\n1 Name = Probe\n1 Code = probe-test 6\n")

    button = by_number(str(path), 1)

    assert button.kind == "probe-test"
    assert button.params == {"seconds": 6.0}
    assert button.supported is True


def test_a_probe_test_without_a_time_gets_the_screens_default(tmp_path: Path) -> None:
    path = tmp_path / "p.prefs"
    path.write_text("[BUTTONS]\n1 Name = Probe\n1 Code = probe-test\n")

    assert by_number(str(path), 1).params == {"seconds": 5.0}


def test_a_hal_toggle_records_the_pin_and_its_cut_critical_flag(prefs) -> None:
    button = by_number(prefs, 4)

    assert button.kind == "toggle-halpin"
    assert button.params["pin"] == "dust-extractor"
    assert button.params["cutCritical"] is True


def test_a_hal_pulse_carries_its_duration(prefs) -> None:
    button = by_number(prefs, 5)

    assert button.kind == "pulse-halpin"
    assert button.params["pin"] == "air-blast"
    assert button.params["seconds"] == 1.5


def test_a_pulse_without_a_pin_is_refused(prefs) -> None:
    button = by_number(prefs, 13)

    assert button.supported is False
    assert "HAL pin" in button.reason


def test_an_absurd_pulse_time_is_refused(prefs) -> None:
    """The duration comes from the config, but 600 instead of 0.6 holds a solenoid on."""
    button = by_number(prefs, 14)

    assert button.supported is False
    assert f"{MAX_PULSE_SECONDS:.0f}" in button.reason


def test_anything_else_is_gcode_for_the_mdi(prefs) -> None:
    button = by_number(prefs, 6)

    assert button.kind == "gcode"
    assert button.params["gcode"] == "G53 G0 X0 Y0"


def test_a_percent_prefix_is_an_external_command(prefs) -> None:
    button = by_number(prefs, 7)

    assert button.kind == "external"
    assert button.params["command"] == "halshow"


def test_load_and_latest_file_expand_the_home_directory(prefs) -> None:
    load = by_number(prefs, 8)
    latest = by_number(prefs, 9)

    assert load.params["path"] == "nesting/sheet1.ngc"
    assert latest.params["path"] == os.path.expanduser("~/linuxcnc/nc_files")


def test_a_code_we_cannot_run_is_listed_with_a_reason(prefs) -> None:
    """A button that is defined but does nothing should say why, not look broken."""
    framing = by_number(prefs, 10)

    assert framing.kind == "framing"
    assert framing.supported is False
    assert "not implemented" in framing.reason


def test_toggle_laser_anywhere_in_the_code_marks_the_button(prefs) -> None:
    """Upstream allows it mid-code, so finding it only at the start would run the move alone."""
    button = by_number(prefs, 11)

    assert button.kind == "toggle-laser"
    assert button.supported is False


def test_a_torch_pulse_button_carries_its_time(prefs) -> None:
    button = by_number(prefs, 12)

    assert button.kind == "torch-pulse"
    assert button.params["seconds"] == 0.4


def test_a_machine_with_no_buttons_has_none(tmp_path: Path) -> None:
    path = tmp_path / "empty.prefs"
    path.write_text("[GUI_OPTIONS]\nMode = 0\n")

    assert read_user_buttons(str(path)) == []


def test_an_unknown_button_number_raises(prefs) -> None:
    with pytest.raises(KeyError):
        user_button(prefs, 19)


def test_only_the_pins_the_config_names_become_writable(prefs) -> None:
    """The permission comes from the machine's file, never from whoever presses the button."""

    class FakeBridge:
        def __init__(self) -> None:
            self.allowed: list = []

        def allow_external_pin(self, name: str) -> None:
            self.allowed.append(name)

    bridge = FakeBridge()
    allowed = allow_configured_pins(bridge, read_user_buttons(prefs))

    assert sorted(bridge.allowed) == ["air-blast", "dust-extractor"]
    assert sorted(allowed) == ["air-blast", "dust-extractor"]


def test_latest_file_picks_the_newest_program(tmp_path: Path) -> None:
    old = tmp_path / "old.ngc"
    new = tmp_path / "new.ngc"
    old.write_text("G0\n")
    new.write_text("G0\n")
    os.utime(old, (1, 1))
    os.utime(new, (2000, 2000))
    (tmp_path / "notes.txt").write_text("not a program\n")

    assert latest_file(str(tmp_path)) == str(new)


def test_latest_file_says_so_when_there_is_nothing_to_load(tmp_path: Path) -> None:
    with pytest.raises(UserButtonError) as excinfo:
        latest_file(str(tmp_path))
    assert excinfo.value.code == "no_programs"

    with pytest.raises(UserButtonError) as excinfo:
        latest_file(str(tmp_path / "nope"))
    assert excinfo.value.code == "directory_not_found"
