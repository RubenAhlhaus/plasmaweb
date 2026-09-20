"""``<machine>_material.cfg``: parsing, saving, temporary materials, and selection."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.plasma.machine_files import INCH_UNITS_PER_MM
from backend.plasma.materials import (
    TEMPORARY_FROM,
    MaterialError,
    default_material,
    make_material,
    material_number,
    material_pin_values,
    read_materials,
    STARTER_CUT_AMPS,
    read_temporary_material,
    starter_materials,
    write_materials,
)

CFG = """\
[MATERIAL_NUMBER_2]
NAME = 5mm mild steel
KERF_WIDTH = 1.5
PIERCE_HEIGHT = 3.6
PIERCE_DELAY = 0.1
PUDDLE_JUMP_HEIGHT = 0.0
PUDDLE_JUMP_DELAY = 0.0
CUT_HEIGHT = 1.4
CUT_SPEED = 4100.0
CUT_AMPS = 45.0
CUT_VOLTS = 122.0
PAUSE_AT_END = 0.0
GAS_PRESSURE = 0.0
CUT_MODE = 1.0
THICKNESS = 5.0

[MATERIAL_NUMBER_0]
NAME = Default material
KERF_WIDTH = 1.0
PIERCE_HEIGHT = 3.0
PIERCE_DELAY = 0.2
PUDDLE_JUMP_HEIGHT = 0.0
PUDDLE_JUMP_DELAY = 0.0
CUT_HEIGHT = 1.0
CUT_SPEED = 2000.0
CUT_AMPS = 45.0
CUT_VOLTS = 100.0
PAUSE_AT_END = 0.0
GAS_PRESSURE = 0.0
CUT_MODE = 1.0
THICKNESS = 0.0

"""


def write_cfg(tmp_path: Path, text: str = CFG) -> str:
    path = tmp_path / "my_plasma_material.cfg"
    path.write_text(text)
    return str(path)


def test_materials_are_read_lowest_number_first(tmp_path: Path) -> None:
    materials = read_materials(write_cfg(tmp_path))

    assert [m.number for m in materials] == [0, 2]
    assert materials[1].name == "5mm mild steel"
    assert materials[1].values["cutSpeed"] == 4100.0
    assert materials[1].values["thickness"] == 5.0


def test_an_existing_file_round_trips_byte_for_byte(tmp_path: Path) -> None:
    """The milestone's exit criterion: QtPlasmaC has to be able to open what we save."""
    path = write_cfg(tmp_path)

    write_materials(path, read_materials(path))

    # Sections come back lowest-first, which is the order QtPlasmaC displays and rewrites in.
    blocks = [block for block in CFG.split("\n\n") if block.strip()]
    assert Path(path).read_text().strip() == "\n\n".join(reversed(blocks)).strip()


def test_a_missing_key_falls_back_to_qtplasmacs_default(tmp_path: Path) -> None:
    path = write_cfg(tmp_path, "[MATERIAL_NUMBER_1]\nNAME = sparse\nCUT_VOLTS = 133.0\n")

    material = read_materials(path)[0]

    assert material.values["cutVolts"] == 133.0
    assert material.values["pierceDelay"] == 0.2
    assert material.values["cutSpeed"] == 2000.0


def test_imperial_defaults_scale_down_rather_than_up(tmp_path: Path) -> None:
    """Upstream divides by unitsPerMm here, which would default a kerf to 25.4 inches."""
    path = write_cfg(tmp_path, "[MATERIAL_NUMBER_1]\nNAME = sparse\n")

    material = read_materials(path, units_per_mm=INCH_UNITS_PER_MM)[0]

    assert material.values["kerfWidth"] == pytest.approx(0.03937)


def test_a_section_with_an_unreadable_number_is_skipped(tmp_path: Path, caplog) -> None:
    path = write_cfg(tmp_path, "[MATERIAL_NUMBER_x]\nNAME = broken\n\n" + CFG)

    with caplog.at_level("WARNING"):
        materials = read_materials(path)

    assert [m.number for m in materials] == [0, 2]
    assert "MATERIAL_NUMBER_x" in caplog.text


def test_editing_a_material_leaves_the_others_alone(tmp_path: Path) -> None:
    path = write_cfg(tmp_path)
    materials = read_materials(path)
    edited = materials[1]._replace(values={**materials[1].values, "cutVolts": 118.0})

    write_materials(path, [materials[0], edited])
    reread = read_materials(path)

    assert reread[0].values["cutVolts"] == 100.0
    assert reread[1].values["cutVolts"] == 118.0


def test_a_removed_material_is_gone_from_the_file(tmp_path: Path) -> None:
    path = write_cfg(tmp_path)
    materials = read_materials(path)

    write_materials(path, [m for m in materials if m.number != 2])

    assert [m.number for m in read_materials(path)] == [0]
    assert "MATERIAL_NUMBER_2" not in Path(path).read_text()


def test_temporary_materials_never_reach_the_file(tmp_path: Path) -> None:
    path = write_cfg(tmp_path)
    temp = make_material(TEMPORARY_FROM, "Temporary 1000000", {"cutVolts": 99.0})
    assert temp.temporary

    write_materials(path, read_materials(path) + [temp])

    assert str(TEMPORARY_FROM) not in Path(path).read_text()


def test_a_negative_material_number_is_refused(tmp_path: Path) -> None:
    with pytest.raises(MaterialError) as excinfo:
        make_material(-1, "nope", {})

    assert excinfo.value.code == "invalid_material_number"


def test_a_non_numeric_value_is_refused(tmp_path: Path) -> None:
    with pytest.raises(MaterialError) as excinfo:
        make_material(1, "nope", {"cutVolts": "fast"})

    assert excinfo.value.code == "invalid_material_value"


def test_selecting_a_material_writes_the_plasmac_setpoints_change_material_writes(
    tmp_path: Path,
) -> None:
    material = read_materials(write_cfg(tmp_path))[1]

    pins = material_pin_values(material)

    assert pins["cut-feed-rate"] == 4100.0
    assert pins["pierce-height"] == 3.6
    assert pins["cut-volts"] == 122.0
    assert pins["material-thickness"] == 5.0
    # Amps, gas pressure and cut mode belong to the PowerMax, not plasmac.
    assert "cut-amps" not in pins
    assert "gas-pressure" not in pins
    assert "cut-mode" not in pins


def test_a_program_declared_material_is_read_from_the_flat_gcode_file(tmp_path: Path) -> None:
    path = tmp_path / "my_plasma_material.gcode"
    path.write_text(
        "NAME = from the program\n"
        "KERF_WIDTH = 1.1\n"
        "CUT_SPEED = 3000\n"
        "CUT_VOLTS = 111\n"
    )

    material = read_temporary_material(str(path), TEMPORARY_FROM + 1)

    assert material.temporary
    assert material.name == "from the program"
    assert material.values["kerfWidth"] == 1.1
    assert material.values["cutSpeed"] == 3000.0
    assert material.values["pierceDelay"] == 0.2


def test_material_number_parsing() -> None:
    assert material_number("MATERIAL_NUMBER_12") == 12
    assert material_number("GUI_OPTIONS") is None


def test_qtplasmacs_default_material_is_not_a_material_of_zeros() -> None:
    material = default_material()

    assert material.number == 0
    assert material.name == "Default"
    assert material.values["cutSpeed"] == 4000.0
    assert material.values["cutVolts"] == 99.0
    assert material.values["pierceHeight"] == 3.0


def test_the_starter_chart_covers_1_to_10_mm_in_half_millimetre_steps() -> None:
    materials = starter_materials()

    assert [m.number for m in materials] == list(range(1, 20))
    assert [m.values["thickness"] for m in materials] == [
        round(1.0 + 0.5 * step, 1) for step in range(19)
    ]
    assert materials[0].name == "1 mm mild steel"
    assert materials[-1].name == "10 mm mild steel"


def test_the_starter_chart_gets_slower_and_hotter_as_the_plate_thickens() -> None:
    """Material number is thickness order, so every per-thickness value must be monotonic."""
    materials = starter_materials()
    speeds = [m.values["cutSpeed"] for m in materials]
    volts = [m.values["cutVolts"] for m in materials]
    delays = [m.values["pierceDelay"] for m in materials]

    assert speeds == sorted(speeds, reverse=True)
    assert volts == sorted(volts)
    assert delays == sorted(delays)
    # Amps ride up with thickness and top out at the source's rating, never above it.
    amps = [m.values["cutAmps"] for m in materials]
    assert amps == sorted(amps)
    assert max(amps) == STARTER_CUT_AMPS
    assert min(amps) > 0
    assert all(m.values["pierceHeight"] > m.values["cutHeight"] > 0 for m in materials)


def test_the_starter_chart_is_scaled_for_an_imperial_machine() -> None:
    materials = starter_materials(INCH_UNITS_PER_MM)

    ten_mm = materials[-1]
    assert ten_mm.values["thickness"] == pytest.approx(10.0 / 25.4, abs=0.001)
    assert ten_mm.values["cutSpeed"] == pytest.approx(1150.0 / 25.4, abs=0.1)
    # Volts, amps and delays are not lengths.
    assert ten_mm.values["cutVolts"] == 122.0
    assert ten_mm.values["cutAmps"] == STARTER_CUT_AMPS
