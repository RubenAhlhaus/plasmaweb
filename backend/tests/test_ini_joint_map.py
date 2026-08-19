"""[KINS] coordinates and per-joint HOME_SEQUENCE, as needed for axis→joint mapping.

QtPlasmaC configs put [KINS]/[JOINT_n] behind an ``#INCLUDE``, so the fallback scanner has
to follow includes — ``configparser`` and a flat line scan both miss them.
"""
from pathlib import Path

from backend.adapters.linuxcnc_gateway import (
    LinuxCncGateway,
    _read_traj_coordinates_line_scan,
    _scan_ini_options,
)


def _write_qtplasmac_style_config(tmp_path: Path) -> Path:
    """Mirrors configs/sim/qtplasmac: a thin INI that #INCLUDEs the real content."""
    inc = tmp_path / "machine_ini.inc"
    inc.write_text(
        "[KINS]\n"
        "KINEMATICS = trivkins coordinates=xyyz\n"
        "JOINTS = 4\n"
        "[TRAJ]\n"
        "COORDINATES = XYYZ\n"
        "LINEAR_UNITS = mm\n"
        "[JOINT_0]\n"
        "HOME_SEQUENCE = 1\n"
        "[JOINT_1]\n"
        "HOME_SEQUENCE = -2\n"
        "[JOINT_2]\n"
        "HOME_SEQUENCE = -2\n"
        "[JOINT_3]\n"
        "HOME_SEQUENCE = 0\n",
        encoding="utf-8",
    )
    ini = tmp_path / "machine.ini"
    ini.write_text(
        "[DISPLAY]\nDISPLAY = plasmacweb\n\n#INCLUDE machine_ini.inc\n", encoding="utf-8"
    )
    return ini


def test_scan_ini_options_follows_include(tmp_path) -> None:
    ini = _write_qtplasmac_style_config(tmp_path)

    found = _scan_ini_options(str(ini), {"KINS": {"KINEMATICS"}, "JOINT_1": {"HOME_SEQUENCE"}})

    assert found["KINS"]["KINEMATICS"] == ["trivkins coordinates=xyyz"]
    assert found["JOINT_1"]["HOME_SEQUENCE"] == ["-2"]


def test_scan_ini_options_keeps_duplicate_values_in_order(tmp_path) -> None:
    ini = tmp_path / "machine.ini"
    ini.write_text(
        "[HAL]\nHALFILE = one.hal\nHALFILE = two.hal\n", encoding="utf-8"
    )

    found = _scan_ini_options(str(ini), {"HAL": {"HALFILE"}})

    assert found["HAL"]["HALFILE"] == ["one.hal", "two.hal"]


def test_scan_ini_options_ignores_comments_and_missing_include(tmp_path) -> None:
    ini = tmp_path / "machine.ini"
    ini.write_text(
        "[KINS]\n"
        "; KINEMATICS = commented out\n"
        "KINEMATICS = trivkins coordinates=xz  ; trailing comment\n"
        "#INCLUDE does_not_exist.inc\n",
        encoding="utf-8",
    )

    found = _scan_ini_options(str(ini), {"KINS": {"KINEMATICS"}})

    assert found["KINS"]["KINEMATICS"] == ["trivkins coordinates=xz"]


def test_traj_coordinates_line_scan_still_works_through_include(tmp_path) -> None:
    ini = _write_qtplasmac_style_config(tmp_path)

    assert _read_traj_coordinates_line_scan(str(ini)) == "XYYZ"


def test_ini_runtime_config_exposes_kins_and_home_sequences(tmp_path, monkeypatch) -> None:
    ini = _write_qtplasmac_style_config(tmp_path)
    monkeypatch.setenv("INI_FILE_NAME", str(ini))
    gateway = LinuxCncGateway()
    gateway._stat = None

    result = gateway.get_ini_runtime_config(force_reload=True)

    assert result["kins_kinematics"] == "trivkins coordinates=xyyz"
    assert result["joint_home_sequences"] == ["1", "-2", "-2", "0"]
    assert result["traj_coordinates"] == "XYYZ"


def test_ini_runtime_config_kins_coordinates_without_kinematics_token(
    tmp_path, monkeypatch
) -> None:
    ini = tmp_path / "machine.ini"
    ini.write_text(
        "[KINS]\nKINEMATICS = genhexkins\nCOORDINATES = X Y Z\n"
        "[JOINT_0]\nHOME_SEQUENCE = 0\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("INI_FILE_NAME", str(ini))
    gateway = LinuxCncGateway()
    gateway._stat = None

    result = gateway.get_ini_runtime_config(force_reload=True)

    assert result["kins_kinematics"] == "genhexkins"
    assert result["kins_coordinates"] == "X Y Z"
    assert result["joint_home_sequences"] == ["0"]


def test_ini_runtime_config_defaults_without_ini(monkeypatch) -> None:
    for var in ("INI_FILE_NAME", "LINUXCNC_INI", "INI_FILE"):
        monkeypatch.delenv(var, raising=False)
    gateway = LinuxCncGateway()
    gateway._stat = None

    result = gateway.get_ini_runtime_config(force_reload=True)

    assert result["kins_kinematics"] is None
    assert result["kins_coordinates"] is None
    assert result["joint_home_sequences"] == []
