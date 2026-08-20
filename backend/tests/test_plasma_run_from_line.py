"""Run From Line: the cutpath scan, and what we hand LinuxCNC's helper.

The helper itself (``plasmac.run_from_line``) is upstream's and only exists on the machine, so
it is stubbed here. What is tested is the part that is ours: finding the cut around a line, and
turning the helper's answers into something a UI can act on.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path
from typing import Any, Dict, List

import pytest

from backend.plasma.run_from_line import (
    HERE_TO_END,
    THIS_CUTPATH,
    RunFromLineError,
    build_run_from_line,
    cut_lines,
    cutpath_bounds,
)

# Two cuts, the way QtPlasmaC's filter writes them: a G00 positions, M03 $0 fires, M05 $0 ends.
PROGRAM = """\
G21
G64 P0.1
F#<_hal[plasmac.cut-feed-rate]>
G00 X10 Y10
M03 $0 S1
G01 X50
G01 Y50
M05 $0
G00 X100 Y100
M03 $0 S1
G01 X150
M05 $0
G00 X0 Y0
M02
"""


def write_program(tmp_path: Path, text: str = PROGRAM) -> str:
    path = tmp_path / "two_cuts.ngc"
    path.write_text(text)
    return str(path)


def install_helper(
    monkeypatch: pytest.MonkeyPatch,
    get_result: Dict[str, Any] | None = None,
    set_result: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    record: Dict[str, Any] = {}

    module = types.ModuleType("plasmac.run_from_line")

    def run_from_line_get(file: str, start_line: int, last_line: int = 0):
        record["get"] = (file, start_line, last_line)
        return get_result if get_result is not None else {"error": False, "newData": []}

    def run_from_line_set(rfl_file: str, data: Any, leadin: Any, units_per_mm: float):
        record["set"] = (rfl_file, leadin, units_per_mm)
        Path(rfl_file).write_text("G21\n")
        return set_result if set_result is not None else {"error": False}

    module.run_from_line_get = run_from_line_get  # type: ignore[attr-defined]
    module.run_from_line_set = run_from_line_set  # type: ignore[attr-defined]
    package = types.ModuleType("plasmac")
    package.run_from_line = module  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "plasmac", package)
    monkeypatch.setitem(sys.modules, "plasmac.run_from_line", module)
    return record


def test_this_cutpath_backs_up_to_the_move_that_positioned_the_cut(tmp_path: Path) -> None:
    start, last = cutpath_bounds(write_program(tmp_path), 6)  # inside the first cut

    assert start == 3  # the G00 X10 Y10 line
    assert last == 7  # its M05 $0


def test_this_cutpath_finds_the_second_cut_too(tmp_path: Path) -> None:
    start, last = cutpath_bounds(write_program(tmp_path), 10)

    assert start == 8
    assert last == 11


def test_a_line_before_any_cut_takes_the_first_one(tmp_path: Path) -> None:
    start, last = cutpath_bounds(write_program(tmp_path), 1)

    assert start == 3
    assert last == 7


def test_a_keep_z_motion_block_ends_at_the_z_retract(tmp_path: Path) -> None:
    """Inside `#<keep-z-motion>` there is no M05 to stop at, so the G53 G00 Z does."""
    program = """\
G00 X10 Y10
#<keep-z-motion>=1
M03 $0 S1
G01 X50
G53 G00 Z10
#<keep-z-motion>=0
M05 $0
"""
    start, last = cutpath_bounds(write_program(tmp_path, program), 3)

    assert start == 0
    assert last == 4


def test_here_to_end_hands_the_line_straight_to_the_helper(tmp_path: Path, monkeypatch) -> None:
    record = install_helper(monkeypatch)
    path = write_program(tmp_path)

    result = build_run_from_line(
        path, 6, HERE_TO_END, units_per_mm=1.0, output_dir=str(tmp_path / "out")
    )

    assert record["get"] == (path, 6, 0)  # last line 0: run to the end
    assert result["startLine"] == 6
    assert result["runType"] == HERE_TO_END
    assert Path(result["path"]).name == "rfl.ngc"
    assert Path(result["path"]).is_file()


def test_this_cutpath_bounds_the_helper_to_one_cut(tmp_path: Path, monkeypatch) -> None:
    record = install_helper(monkeypatch)
    path = write_program(tmp_path)

    result = build_run_from_line(
        path, 6, THIS_CUTPATH, units_per_mm=1.0, output_dir=str(tmp_path / "out")
    )

    assert record["get"] == (path, 3, 7)
    assert result["startLine"] == 3
    assert result["lastLine"] == 7


def test_a_leadin_is_only_asked_for_when_running_to_the_end(tmp_path: Path, monkeypatch) -> None:
    record = install_helper(monkeypatch)
    path = write_program(tmp_path)

    build_run_from_line(
        path, 6, HERE_TO_END, leadin_length=5.0, leadin_angle=90.0, output_dir=str(tmp_path / "o")
    )
    here = record["set"][1]
    build_run_from_line(
        path, 6, THIS_CUTPATH, leadin_length=5.0, output_dir=str(tmp_path / "o")
    )
    cutpath = record["set"][1]

    assert here == {"cancel": False, "do": True, "length": 5.0, "angle": 90.0}
    # Upstream sends a "fake user input" with no lead-in for this cutpath.
    assert cutpath["do"] is False


def test_a_leadin_that_cannot_be_calculated_still_runs_the_cut(tmp_path: Path, monkeypatch) -> None:
    install_helper(monkeypatch, set_result={"error": True})
    path = write_program(tmp_path)

    result = build_run_from_line(
        path, 6, HERE_TO_END, leadin_length=5.0, output_dir=str(tmp_path / "out")
    )

    assert result["leadinApplied"] is False
    assert Path(result["path"]).is_file()


def test_a_start_line_inside_a_subroutine_is_refused(tmp_path: Path, monkeypatch) -> None:
    install_helper(
        monkeypatch,
        get_result={"error": True, "compError": False, "subError": ["O100", "O101"]},
    )

    with pytest.raises(RunFromLineError) as excinfo:
        build_run_from_line(write_program(tmp_path), 6, output_dir=str(tmp_path / "out"))

    assert excinfo.value.code == "inside_subroutine"
    assert excinfo.value.detail == ["O100", "O101"]


def test_cutter_compensation_is_refused(tmp_path: Path, monkeypatch) -> None:
    install_helper(monkeypatch, get_result={"error": True, "compError": True, "subError": []})

    with pytest.raises(RunFromLineError) as excinfo:
        build_run_from_line(write_program(tmp_path), 6, output_dir=str(tmp_path / "out"))

    assert excinfo.value.code == "cutter_compensation_active"


def test_a_bad_request_is_refused_before_the_helper_is_asked(tmp_path: Path, monkeypatch) -> None:
    install_helper(monkeypatch)
    path = write_program(tmp_path)

    with pytest.raises(RunFromLineError) as excinfo:
        build_run_from_line(path, 6, "sideways", output_dir=str(tmp_path / "out"))
    assert excinfo.value.code == "invalid_run_type"

    with pytest.raises(RunFromLineError) as excinfo:
        build_run_from_line(path, -1, output_dir=str(tmp_path / "out"))
    assert excinfo.value.code == "invalid_start_line"

    with pytest.raises(RunFromLineError) as excinfo:
        build_run_from_line(str(tmp_path / "nope.ngc"), 1, output_dir=str(tmp_path / "out"))
    assert excinfo.value.code == "file_not_found"


def test_without_the_helper_run_from_line_says_so(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setitem(sys.modules, "plasmac.run_from_line", None)
    monkeypatch.setitem(sys.modules, "plasmac", None)

    with pytest.raises(RunFromLineError) as excinfo:
        build_run_from_line(write_program(tmp_path), 6, output_dir=str(tmp_path / "out"))

    assert excinfo.value.code == "run_from_line_unavailable"


def test_cut_lines_lists_where_the_torch_fires(tmp_path: Path) -> None:
    lines: List[int] = cut_lines(write_program(tmp_path))

    assert lines == [4, 9]
