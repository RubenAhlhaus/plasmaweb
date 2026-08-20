"""Resolving a machine's plasma files, and reading/writing them the way qtvcp does."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.plasma.machine_files import (
    INCH_UNITS_PER_MM,
    ini_real,
    ini_value,
    machine_files,
    read_config,
    render_config,
    write_config,
)

INI = """\
[EMC]
MACHINE = my_plasma
VERSION = 1.0

[TRAJ]
LINEAR_UNITS = mm
MAX_LINEAR_VELOCITY = 250

[AXIS_Z]
MAX_VELOCITY = 120.0
OFFSET_AV_RATIO = 0.5
"""


@pytest.fixture(autouse=True)
def _no_inherited_ini(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("INI_FILE_NAME", "LINUXCNC_INI", "INI_FILE"):
        monkeypatch.delenv(key, raising=False)


def write_ini(tmp_path: Path, text: str = INI) -> Path:
    ini = tmp_path / "machine.ini"
    ini.write_text(text)
    return ini


def test_files_are_named_from_the_machine_and_sit_beside_the_ini(tmp_path: Path) -> None:
    files = machine_files(str(write_ini(tmp_path)))

    assert files is not None
    assert files.machine == "my_plasma"
    assert files.prefs_path == str(tmp_path / "my_plasma.prefs")
    assert files.materials_path == str(tmp_path / "my_plasma_material.cfg")
    assert files.units_per_mm == 1.0


def test_an_imperial_machine_uses_qtplasmacs_own_unit_scale(tmp_path: Path) -> None:
    ini = write_ini(tmp_path, INI.replace("LINEAR_UNITS = mm", "LINEAR_UNITS = inch"))

    files = machine_files(str(ini))

    assert files is not None
    assert files.units_per_mm == INCH_UNITS_PER_MM


def test_no_ini_anywhere_is_not_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    assert machine_files() is None


def test_the_ini_is_found_through_the_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("INI_FILE_NAME", str(write_ini(tmp_path)))

    files = machine_files()

    assert files is not None and files.machine == "my_plasma"


def test_ini_reads_tolerate_a_missing_key(tmp_path: Path) -> None:
    ini = write_ini(tmp_path)

    assert ini_value(str(ini), "EMC", "MACHINE") == "my_plasma"
    assert ini_real(str(ini), "AXIS_Z", "OFFSET_AV_RATIO") == 0.5
    assert ini_value(str(ini), "EMC", "NOPE") is None
    assert ini_real(str(ini), "AXIS_Z", "NOPE") is None


def test_config_keys_keep_their_case_and_round_trip_unchanged(tmp_path: Path) -> None:
    """qtvcp sets ``optionxform = str``; lower-casing 'Pid P Gain' would lose the key."""
    path = tmp_path / "my_plasma.prefs"
    path.write_text("[PLASMA_PARAMETERS]\nPid P Gain = 10.0\nTHC Delay = 0.5\n\n")

    parser = read_config(str(path))
    assert parser.get("PLASMA_PARAMETERS", "Pid P Gain") == "10.0"

    write_config(str(path), parser)
    assert path.read_text() == "[PLASMA_PARAMETERS]\nPid P Gain = 10.0\nTHC Delay = 0.5\n\n"


def test_a_missing_file_reads_as_empty(tmp_path: Path) -> None:
    parser = read_config(str(tmp_path / "nothing.prefs"))

    assert parser.sections() == []


def test_writes_are_atomic_and_leave_no_temporary_file(tmp_path: Path) -> None:
    path = tmp_path / "my_plasma.prefs"
    parser = read_config(str(path))
    parser.add_section("GUI_OPTIONS")
    parser.set("GUI_OPTIONS", "Show Materials", "True")

    write_config(str(path), parser)

    assert path.read_text() == render_config(parser)
    assert [p.name for p in tmp_path.iterdir()] == ["my_plasma.prefs"]
