"""Unit tests for coordinate system offset helpers / VAR hydration."""

from __future__ import annotations

from types import SimpleNamespace

from backend.coordinate_systems import (
    display_totals_to_g5x_offsets,
    ensure_stored_offsets_hydrated_from_ini,
    list_coordinate_systems,
    parse_parameter_file_g5x_offsets,
    reset_stored_offsets_state_for_tests,
    resolve_parameter_file_path,
    var_base_for_system_id,
)


def test_var_base_for_system_id() -> None:
    assert var_base_for_system_id("G54") == 5221
    assert var_base_for_system_id("G55") == 5241
    assert var_base_for_system_id("G59.3") == 5381
    assert var_base_for_system_id("0") is None


def test_parse_parameter_file_g5x_offsets(tmp_path) -> None:
    var = tmp_path / "machine.var"
    var.write_text(
        "\n".join(
            [
                "5221\t10.5",
                "5222\t-2.0",
                "5223\t3.25",
                "5241\t100.0",
                "5242\t200.0",
                "5243\t300.0",
                "5381\t1.0",
                "5382\t2.0",
                "5383\t3.0",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    parsed = parse_parameter_file_g5x_offsets(str(var))
    assert parsed["G54"]["x"] == 10.5
    assert parsed["G54"]["y"] == -2.0
    assert parsed["G54"]["z"] == 3.25
    assert parsed["G55"]["x"] == 100.0
    assert parsed["G55"]["y"] == 200.0
    assert parsed["G55"]["z"] == 300.0
    assert parsed["G56"]["x"] == 0.0
    assert parsed["G59.3"]["x"] == 1.0
    assert parsed["G59.3"]["y"] == 2.0
    assert parsed["G59.3"]["z"] == 3.0


def test_resolve_parameter_file_path_relative(tmp_path) -> None:
    var = tmp_path / "sim.var"
    var.write_text("5221\t1.0\n", encoding="utf-8")
    ini = tmp_path / "machine.ini"
    ini.write_text(
        "[RS274NGC]\nPARAMETER_FILE = sim.var\n",
        encoding="utf-8",
    )

    resolved = resolve_parameter_file_path(str(ini))
    assert resolved == str(var)


def test_resolve_parameter_file_path_with_duplicate_ini_keys(tmp_path) -> None:
    """Real LinuxCNC INIs often duplicate FILTER keys; ConfigParser alone fails."""
    var = tmp_path / "sim.var"
    var.write_text("5221\t1.0\n", encoding="utf-8")
    ini = tmp_path / "machine.ini"
    ini.write_text(
        "\n".join(
            [
                "[FILTER]",
                "PROGRAM_EXTENSION = .ngc",
                "PROGRAM_EXTENSION = .nc",
                "[RS274NGC]",
                "PARAMETER_FILE = sim.var",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    resolved = resolve_parameter_file_path(str(ini))
    assert resolved == str(var)


def test_resolve_parameter_file_path_strips_hash_comments(tmp_path) -> None:
    var = tmp_path / "sim.var"
    var.write_text("5221\t1.0\n", encoding="utf-8")
    ini = tmp_path / "machine.ini"
    ini.write_text(
        "[RS274NGC]\nPARAMETER_FILE = sim.var # work offsets\n",
        encoding="utf-8",
    )

    resolved = resolve_parameter_file_path(str(ini))
    assert resolved == str(var)


def test_ensure_stored_offsets_hydrated_retries_until_var_exists(tmp_path) -> None:
    reset_stored_offsets_state_for_tests()
    ini = tmp_path / "machine.ini"
    ini.write_text(
        "[RS274NGC]\nPARAMETER_FILE = offsets.var\n",
        encoding="utf-8",
    )

    assert ensure_stored_offsets_hydrated_from_ini(None) is False
    assert ensure_stored_offsets_hydrated_from_ini(str(ini)) is False

    var = tmp_path / "offsets.var"
    var.write_text("5241\t42.0\n5242\t43.0\n5243\t44.0\n", encoding="utf-8")
    assert ensure_stored_offsets_hydrated_from_ini(str(ini)) is True

    systems = list_coordinate_systems(
        SimpleNamespace(
            g5x_index=1,
            g5x_offset=(0.0,) * 9,
            g92_offset=(0.0,) * 9,
        )
    )
    by_id = {row["id"]: row for row in systems}
    assert by_id["G55"]["offsets"]["x"] == 42.0
    assert by_id["G55"]["offsets"]["y"] == 43.0
    assert by_id["G55"]["offsets"]["z"] == 44.0

    # Second call must not re-read after successful hydrate.
    var.write_text("5241\t999.0\n", encoding="utf-8")
    assert ensure_stored_offsets_hydrated_from_ini(str(ini)) is True
    systems2 = list_coordinate_systems(
        SimpleNamespace(
            g5x_index=1,
            g5x_offset=(0.0,) * 9,
            g92_offset=(0.0,) * 9,
        )
    )
    assert {row["id"]: row for row in systems2}["G55"]["offsets"]["x"] == 42.0


def test_display_totals_to_g5x_offsets_subtracts_g92() -> None:
    g5x = display_totals_to_g5x_offsets(
        {"x": 11.0, "y": 22.0, "z": 33.0},
        (1.0, 2.0, 3.0) + (0.0,) * 6,
    )
    assert g5x == {"x": 10.0, "y": 20.0, "z": 30.0}


def test_list_coordinate_systems_shows_g5x_plus_g92_for_inactive() -> None:
    reset_stored_offsets_state_for_tests()

    systems_active = list_coordinate_systems(
        SimpleNamespace(
            g5x_index=2,  # G55
            g5x_offset=(10.0, 20.0, 30.0) + (0.0,) * 6,
            g92_offset=(1.0, 2.0, 3.0) + (0.0,) * 6,
        )
    )
    g55_active = next(row for row in systems_active if row["id"] == "G55")
    assert g55_active["is_active"] is True
    assert g55_active["offsets"]["x"] == 11.0
    assert g55_active["offsets"]["y"] == 22.0
    assert g55_active["offsets"]["z"] == 33.0

    systems_other = list_coordinate_systems(
        SimpleNamespace(
            g5x_index=1,  # G54
            g5x_offset=(0.0,) * 9,
            g92_offset=(1.0, 2.0, 3.0) + (0.0,) * 6,
        )
    )
    g55_inactive = next(row for row in systems_other if row["id"] == "G55")
    assert g55_inactive["is_active"] is False
    # Cached pure G5x (10/20/30) plus live G92 — no jump vs active display.
    assert g55_inactive["offsets"]["x"] == 11.0
    assert g55_inactive["offsets"]["y"] == 22.0
    assert g55_inactive["offsets"]["z"] == 33.0
