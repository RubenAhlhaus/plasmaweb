"""Single cut: the program QtPlasmaC writes, and what it refuses to write."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.plasma.single_cut import (
    MAX_LENGTH,
    SingleCutError,
    build_single_cut,
    read_lengths,
    write_lengths,
)


def test_the_cut_starts_where_the_torch_is_standing() -> None:
    """G53 on both moves: the cut is at the machine position, not at a work offset."""
    gcode = build_single_cut((120.5, 60.25), 100.0, 0.0)

    assert "G53 G0 X120.500000 Y60.250000" in gcode
    assert "G53 G1 X220.500000 Y60.250000" in gcode


def test_it_changes_material_and_takes_the_feed_from_hal() -> None:
    gcode = build_single_cut((0.0, 0.0), 50.0, 0.0, material=(3, "5mm mild steel"))

    assert "M190 P3" in gcode
    assert "F#<_hal[plasmac.cut-feed-rate]>" in gcode
    assert gcode.count("M3 $0 S1") == 1
    assert gcode.count("M5 $0") == 1
    assert gcode.rstrip().endswith("M2")


def test_a_diagonal_cut_moves_both_axes() -> None:
    gcode = build_single_cut((10.0, 10.0), -20.0, 30.0)

    assert "G53 G1 X-10.000000 Y40.000000" in gcode


def test_a_cut_of_no_length_is_refused() -> None:
    with pytest.raises(SingleCutError) as excinfo:
        build_single_cut((0.0, 0.0), 0.0, 0.0)

    assert excinfo.value.code == "invalid_params"


def test_an_absurd_length_is_refused() -> None:
    with pytest.raises(SingleCutError) as excinfo:
        build_single_cut((0.0, 0.0), MAX_LENGTH + 1, 0.0)

    assert excinfo.value.code == "invalid_params"


def test_the_lengths_are_remembered_for_next_time(tmp_path: Path) -> None:
    prefs = tmp_path / "machine.prefs"

    assert read_lengths(str(prefs)) == {"X length": 0.0, "Y length": 0.0}

    write_lengths(str(prefs), 150.0, -25.5)

    assert read_lengths(str(prefs)) == {"X length": 150.0, "Y length": -25.5}
    assert "[SINGLE CUT]" in prefs.read_text()


def test_a_junk_length_in_the_file_reads_as_zero(tmp_path: Path, caplog) -> None:
    prefs = tmp_path / "machine.prefs"
    prefs.write_text("[SINGLE CUT]\nX length = quite long\n")

    with caplog.at_level("WARNING"):
        lengths = read_lengths(str(prefs))

    assert lengths["X length"] == 0.0
    assert "X length" in caplog.text
