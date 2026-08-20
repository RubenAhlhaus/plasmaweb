"""The startup values our own HAL output pins need, read off the machine's INI."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.plasma.startup import qtplasmac_startup_values

INI = """\
[EMC]
MACHINE = qtplasmac

[AXIS_Z]
MAX_VELOCITY            = 120.0
MAX_ACCELERATION        = 600.0
OFFSET_AV_RATIO         = 0.5

[JOINT_2]
MAX_VELOCITY            = 60
"""


@pytest.fixture(autouse=True)
def _no_inherited_ini(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("INI_FILE_NAME", "LINUXCNC_INI", "INI_FILE"):
        monkeypatch.delenv(key, raising=False)


def test_gcode_scale_is_one_so_plasmac_can_divide_by_it() -> None:
    """Zero would make plasmac's requested feed rate infinite and stall the THC."""
    assert qtplasmac_startup_values()["gcode_scale"] == 1.0


def test_thc_feed_rate_comes_from_axis_z(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ini = tmp_path / "machine.ini"
    ini.write_text(INI)
    monkeypatch.setenv("INI_FILE_NAME", str(ini))

    # QtPlasmaC's thcFeedRate: MAX_VELOCITY * OFFSET_AV_RATIO * 60.
    assert qtplasmac_startup_values()["thc_feed_rate"] == pytest.approx(3600.0)


def test_thc_feed_rate_is_omitted_when_the_ini_does_not_say(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ini = tmp_path / "machine.ini"
    ini.write_text("[AXIS_Z]\nMAX_VELOCITY = 120.0\n")
    monkeypatch.setenv("INI_FILE_NAME", str(ini))

    assert "thc_feed_rate" not in qtplasmac_startup_values()


def test_a_missing_ini_file_is_not_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INI_FILE_NAME", "/nonexistent/machine.ini")

    assert qtplasmac_startup_values() == {"gcode_scale": 1.0}
