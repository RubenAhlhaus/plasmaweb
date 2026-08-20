"""The toolpath preview: what the canon collects, and what it refuses.

There is no LinuxCNC interpreter on a dev machine, so ``rs274.interpret`` and ``gcode`` are
stubbed with the same shapes the real ones have. That still exercises everything this module
owns — polyline grouping, extents, truncation, the parameter-file copy and the error mapping —
because the interpreter's job is to *call* the canon, and here the stub does the calling.
"""

from __future__ import annotations

import os
import sys
import types
from pathlib import Path
from typing import Any, Dict, List

import pytest

from backend.plasma import toolpath
from backend.plasma.toolpath import ToolpathError, parse_toolpath


class FakeTranslated:
    """``rs274.interpret.Translated``: identity transform, and the offsets it declares."""

    g92_offset_x = g92_offset_y = g92_offset_z = 0
    g92_offset_a = g92_offset_b = g92_offset_c = 0
    g92_offset_u = g92_offset_v = g92_offset_w = 0
    g5x_offset_x = g5x_offset_y = g5x_offset_z = 0
    g5x_offset_a = g5x_offset_b = g5x_offset_c = 0
    g5x_offset_u = g5x_offset_v = g5x_offset_w = 0
    rotation_xy = 0

    def rotate_and_translate(self, *args):
        return args

    def straight_traverse(self, *args):
        self.straight_traverse_translated(*args)

    def straight_feed(self, *args):
        self.straight_feed_translated(*args)


class FakeArcsToSegmentsMixin:
    """Mirrors the real mixin, including the ``plane`` the arc converter reads."""

    plane = 1
    arcdivision = 64

    def set_plane(self, plane):
        self.plane = plane


class FakeState:
    def __init__(self, sequence_number: int) -> None:
        self.sequence_number = sequence_number


#: What the stub interpreter does to the canon. Real ``gcode.parse`` calls exactly these.
Script = List[Any]


def install_stubs(monkeypatch: pytest.MonkeyPatch, script: Script, result: int = 0) -> Dict[str, Any]:
    """Put fake ``rs274.interpret`` and ``gcode`` modules in place; return a call record."""
    record: Dict[str, Any] = {}

    interpret = types.ModuleType("rs274.interpret")
    interpret.Translated = FakeTranslated  # type: ignore[attr-defined]
    interpret.ArcsToSegmentsMixin = FakeArcsToSegmentsMixin  # type: ignore[attr-defined]
    rs274 = types.ModuleType("rs274")
    rs274.interpret = interpret  # type: ignore[attr-defined]

    gcode = types.ModuleType("gcode")
    gcode.MIN_ERROR = 0  # type: ignore[attr-defined]

    def parse(path: str, canon: Any, unitcode: str, initcode: str):
        record["path"] = path
        record["unitcode"] = unitcode
        record["initcode"] = initcode
        record["parameter_file"] = canon.parameter_file
        record["parameter_exists"] = Path(canon.parameter_file).is_file()
        record["use_move_batches"] = canon.use_move_batches
        for step in script:
            name, args = step[0], step[1:]
            getattr(canon, name)(*args)
        return result, 42

    gcode.parse = parse  # type: ignore[attr-defined]
    gcode.strerror = lambda code: f"gcode error {code}"  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "rs274", rs274)
    monkeypatch.setitem(sys.modules, "rs274.interpret", interpret)
    monkeypatch.setitem(sys.modules, "gcode", gcode)
    return record


@pytest.fixture()
def program(tmp_path: Path) -> str:
    path = tmp_path / "cut.ngc"
    path.write_text("G21\nG0 X0 Y0\nM3 $0 S1\nG1 X10\nM5 $0\nM2\n")
    return str(path)


def test_a_rapid_then_a_cut_are_separate_polylines(program, monkeypatch) -> None:
    install_stubs(
        monkeypatch,
        [
            ("next_line", FakeState(2)),
            ("straight_traverse", 10.0, 10.0, 5.0, 0, 0, 0, 0, 0, 0),
            ("next_line", FakeState(4)),
            ("straight_feed", 20.0, 10.0, 1.0, 0, 0, 0, 0, 0, 0),
        ],
    )

    result = parse_toolpath(program)

    kinds = [segment["kind"] for segment in result["segments"]]
    assert kinds == ["rapid", "feed"]
    assert result["segments"][0]["line"] == 2
    assert result["segments"][1]["line"] == 4
    # The feed starts where the rapid ended, so the drawing has no gap in it. Values are the
    # interpreter's inches scaled to the machine's millimetres.
    assert result["segments"][1]["pts"][0] == [
        pytest.approx(v) for v in (10.0 * 25.4, 10.0 * 25.4, 5.0 * 25.4)
    ]
    assert result["segments"][1]["pts"][-1] == [
        pytest.approx(v) for v in (20.0 * 25.4, 10.0 * 25.4, 1.0 * 25.4)
    ]


def test_moves_from_one_line_collapse_into_one_polyline(program, monkeypatch) -> None:
    """An arc arrives as 64 straight segments from a single line; the UI wants one polyline."""
    install_stubs(
        monkeypatch,
        [("next_line", FakeState(7))]
        + [("straight_feed", float(i), 0.0, 1.0, 0, 0, 0, 0, 0, 0) for i in range(1, 65)],
    )

    result = parse_toolpath(program)

    assert len(result["segments"]) == 1
    assert result["segments"][0]["line"] == 7
    assert len(result["segments"][0]["pts"]) == 65  # 64 moves plus the starting point


def test_arc_segments_are_recorded_as_feed(program, monkeypatch) -> None:
    install_stubs(
        monkeypatch,
        [
            ("next_line", FakeState(3)),
            ("straight_arcsegments", [(1.0, 0.0, 0.0), (2.0, 1.0, 0.0)]),
        ],
    )

    result = parse_toolpath(program)

    assert result["segments"][0]["kind"] == "feed"
    # Interpreter inches × 25.4: with no INI to say otherwise the machine is assumed metric.
    assert result["segments"][0]["pts"][-1] == [pytest.approx(50.8), pytest.approx(25.4), 0.0]


def test_extents_cover_every_point(program, monkeypatch) -> None:
    install_stubs(
        monkeypatch,
        [
            ("next_line", FakeState(1)),
            ("straight_traverse", 5.0, -2.0, 10.0, 0, 0, 0, 0, 0, 0),
            ("next_line", FakeState(2)),
            ("straight_feed", 30.0, 40.0, 1.0, 0, 0, 0, 0, 0, 0),
        ],
    )

    result = parse_toolpath(program)

    assert result["extents"]["min"] == [pytest.approx(v) for v in (0.0, -2.0 * 25.4, 0.0)]
    assert result["extents"]["max"] == [
        pytest.approx(v) for v in (30.0 * 25.4, 40.0 * 25.4, 10.0 * 25.4)
    ]


def test_a_program_with_no_moves_has_no_extents(program, monkeypatch) -> None:
    install_stubs(monkeypatch, [("next_line", FakeState(1))])

    result = parse_toolpath(program)

    assert result["segments"] == []
    assert result["extents"] is None


def test_a_huge_program_is_truncated_rather_than_serialised(program, monkeypatch) -> None:
    install_stubs(
        monkeypatch,
        [("next_line", FakeState(1))]
        + [("straight_feed", float(i), 0.0, 0.0, 0, 0, 0, 0, 0, 0) for i in range(50)],
    )

    result = parse_toolpath(program, max_points=10)

    assert result["truncated"] is True
    assert result["points"] <= 11


def test_the_canon_does_not_answer_the_move_batch_probe(program, monkeypatch) -> None:
    """A catch-all __getattr__ would opt into a protocol this canon does not implement."""
    record = install_stubs(monkeypatch, [])

    parse_toolpath(program)

    assert record["use_move_batches"] is False


def test_unknown_canon_callbacks_are_ignored(program, monkeypatch) -> None:
    install_stubs(
        monkeypatch,
        [
            ("comment", "a comment"),
            ("set_feed_rate", 4000.0),
            ("dwell", 0.5),
            ("message", "hello"),
            ("next_line", FakeState(1)),
            ("straight_feed", 1.0, 1.0, 1.0, 0, 0, 0, 0, 0, 0),
        ],
    )

    result = parse_toolpath(program)

    assert len(result["segments"]) == 1


def test_the_machines_parameter_file_is_copied_not_written(
    tmp_path: Path, program, monkeypatch
) -> None:
    """The interpreter writes parameters back; a preview must not touch the machine's VAR."""
    var = tmp_path / "machine.var"
    var.write_text("5220\t1.000000\n")
    ini = tmp_path / "machine.ini"
    ini.write_text("[RS274NGC]\nPARAMETER_FILE = machine.var\n")
    record = install_stubs(monkeypatch, [])

    parse_toolpath(program, ini_path=str(ini))

    assert record["parameter_exists"] is True
    assert Path(record["parameter_file"]).name == "preview.var"
    assert Path(record["parameter_file"]).parent != tmp_path
    assert var.read_text() == "5220\t1.000000\n"


def test_a_gcode_error_carries_the_interpreters_own_message(program, monkeypatch) -> None:
    install_stubs(monkeypatch, [], result=5)

    with pytest.raises(ToolpathError) as excinfo:
        parse_toolpath(program)

    assert excinfo.value.code == "gcode_error"
    assert "gcode error 5" in excinfo.value.message
    assert "cut.ngc:42" in excinfo.value.message


def test_a_missing_program_is_reported_before_anything_is_parsed(tmp_path: Path) -> None:
    with pytest.raises(ToolpathError) as excinfo:
        parse_toolpath(str(tmp_path / "nope.ngc"))

    assert excinfo.value.code == "file_not_found"


def test_without_the_interpreter_the_preview_says_so(program, monkeypatch) -> None:
    monkeypatch.setitem(sys.modules, "gcode", None)

    with pytest.raises(ToolpathError) as excinfo:
        parse_toolpath(program)

    assert excinfo.value.code == "interpreter_unavailable"


def test_the_preview_starts_in_the_machines_units(program, monkeypatch) -> None:
    record = install_stubs(monkeypatch, [])

    result = parse_toolpath(program)

    assert record["unitcode"] == "G21"
    assert result["units"] == "mm"


def test_max_points_default_is_a_browser_sized_limit() -> None:
    assert toolpath.MAX_POINTS == 400_000


def test_the_canon_exposes_what_the_arc_converter_reads(program, monkeypatch) -> None:
    """`gcode.arc_to_segments` reads these off the canon; a no-op lambda there fails the parse."""
    seen: dict = {}

    def script_reader(canon):
        seen["lo"] = canon.lo
        seen["plane"] = canon.plane
        seen["rotation_cos"] = canon.rotation_cos
        seen["rotation_sin"] = canon.rotation_sin
        seen["g5x_offset_x"] = canon.g5x_offset_x
        seen["g92_offset_w"] = canon.g92_offset_w

    interpret = types.ModuleType("rs274.interpret")
    interpret.Translated = FakeTranslated  # type: ignore[attr-defined]
    interpret.ArcsToSegmentsMixin = FakeArcsToSegmentsMixin  # type: ignore[attr-defined]
    rs274 = types.ModuleType("rs274")
    rs274.interpret = interpret  # type: ignore[attr-defined]
    gcode = types.ModuleType("gcode")
    gcode.MIN_ERROR = 0  # type: ignore[attr-defined]

    def parse(path, canon, unitcode, initcode):
        canon.next_line(FakeState(4))
        canon.straight_feed(7.0, 8.0, 9.0, 0, 0, 0, 0, 0, 0)
        script_reader(canon)
        return 0, 0

    gcode.parse = parse  # type: ignore[attr-defined]
    gcode.strerror = lambda code: "" # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "rs274", rs274)
    monkeypatch.setitem(sys.modules, "rs274.interpret", interpret)
    monkeypatch.setitem(sys.modules, "gcode", gcode)

    parse_toolpath(program)

    # Nine doubles, ending at the last move — that is how the arc converter starts an arc.
    assert len(seen["lo"]) == 9
    assert seen["lo"][:3] == (7.0, 8.0, 9.0)
    assert all(isinstance(value, float) for value in seen["lo"])
    assert seen["plane"] == 1
    assert (seen["rotation_cos"], seen["rotation_sin"]) == (1.0, 0.0)
    assert seen["g5x_offset_x"] == 0
    assert seen["g92_offset_w"] == 0


def test_an_interpreter_that_gives_up_is_reported_as_such(program, monkeypatch) -> None:
    interpret = types.ModuleType("rs274.interpret")
    interpret.Translated = FakeTranslated  # type: ignore[attr-defined]
    interpret.ArcsToSegmentsMixin = FakeArcsToSegmentsMixin  # type: ignore[attr-defined]
    rs274 = types.ModuleType("rs274")
    rs274.interpret = interpret  # type: ignore[attr-defined]
    gcode = types.ModuleType("gcode")
    gcode.MIN_ERROR = 0  # type: ignore[attr-defined]

    def parse(path, canon, unitcode, initcode):
        raise RuntimeError("parse_file interp_error")

    gcode.parse = parse  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "rs274", rs274)
    monkeypatch.setitem(sys.modules, "rs274.interpret", interpret)
    monkeypatch.setitem(sys.modules, "gcode", gcode)

    with pytest.raises(ToolpathError) as excinfo:
        parse_toolpath(program)

    assert excinfo.value.code == "interpreter_failed"
    assert "interp_error" in excinfo.value.message


def test_the_ini_is_put_in_the_environment_for_the_interpreter(
    tmp_path: Path, program, monkeypatch
) -> None:
    """[RS274NGC] FEATURES decides whether `#<_hal[...]>` resolves, and it is read from there."""
    ini = tmp_path / "machine.ini"
    ini.write_text("[RS274NGC]\nFEATURES = 12\n")
    monkeypatch.delenv("INI_FILE_NAME", raising=False)
    seen: dict = {}

    interpret = types.ModuleType("rs274.interpret")
    interpret.Translated = FakeTranslated  # type: ignore[attr-defined]
    interpret.ArcsToSegmentsMixin = FakeArcsToSegmentsMixin  # type: ignore[attr-defined]
    rs274 = types.ModuleType("rs274")
    rs274.interpret = interpret  # type: ignore[attr-defined]
    gcode = types.ModuleType("gcode")
    gcode.MIN_ERROR = 0  # type: ignore[attr-defined]

    def parse(path, canon, unitcode, initcode):
        import os as _os

        seen["ini"] = _os.environ.get("INI_FILE_NAME")
        return 0, 0

    gcode.parse = parse  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "rs274", rs274)
    monkeypatch.setitem(sys.modules, "rs274.interpret", interpret)
    monkeypatch.setitem(sys.modules, "gcode", gcode)

    parse_toolpath(program, ini_path=str(ini))

    assert seen["ini"] == str(ini)
    # …and put back afterwards, because this process shares its environment with the backend.
    assert "INI_FILE_NAME" not in os.environ


def test_points_come_back_in_machine_units_not_interpreter_inches(
    tmp_path: Path, program, monkeypatch
) -> None:
    """The interpreter's canonical unit is the inch; a metric machine must not read 23 for 590."""
    ini = tmp_path / "machine.ini"
    ini.write_text("[TRAJ]\nLINEAR_UNITS = mm\n")
    install_stubs(
        monkeypatch,
        [
            ("next_line", FakeState(2)),
            # 590 mm as the interpreter reports it.
            ("straight_feed", 590.0 / 25.4, 0.0, 0.0, 0, 0, 0, 0, 0, 0),
        ],
    )

    result = parse_toolpath(program, ini_path=str(ini))

    assert result["units"] == "mm"
    assert result["segments"][0]["pts"][-1][0] == pytest.approx(590.0)
    assert result["extents"]["max"][0] == pytest.approx(590.0)


def test_an_imperial_machine_keeps_the_interpreters_inches(
    tmp_path: Path, program, monkeypatch
) -> None:
    ini = tmp_path / "machine.ini"
    ini.write_text("[TRAJ]\nLINEAR_UNITS = inch\n")
    install_stubs(
        monkeypatch,
        [("next_line", FakeState(2)), ("straight_feed", 12.5, 0.0, 0.0, 0, 0, 0, 0, 0, 0)],
    )

    result = parse_toolpath(program, ini_path=str(ini))

    assert result["units"] == "inch"
    assert result["segments"][0]["pts"][-1][0] == pytest.approx(12.5)


def test_the_arc_converter_still_sees_interpreter_units(program, monkeypatch) -> None:
    """`lo` feeds the arc converter, so it must not be scaled with the points we keep."""
    seen: dict = {}

    interpret = types.ModuleType("rs274.interpret")
    interpret.Translated = FakeTranslated  # type: ignore[attr-defined]
    interpret.ArcsToSegmentsMixin = FakeArcsToSegmentsMixin  # type: ignore[attr-defined]
    rs274 = types.ModuleType("rs274")
    rs274.interpret = interpret  # type: ignore[attr-defined]
    gcode = types.ModuleType("gcode")
    gcode.MIN_ERROR = 0  # type: ignore[attr-defined]

    def parse(path, canon, unitcode, initcode):
        canon.next_line(FakeState(1))
        canon.straight_feed(2.0, 0.0, 0.0, 0, 0, 0, 0, 0, 0)
        seen["lo"] = canon.lo
        seen["point"] = canon.segments[-1]["pts"][-1]
        return 0, 0

    gcode.parse = parse  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "rs274", rs274)
    monkeypatch.setitem(sys.modules, "rs274.interpret", interpret)
    monkeypatch.setitem(sys.modules, "gcode", gcode)

    parse_toolpath(program)

    assert seen["lo"][0] == 2.0
    assert seen["point"][0] == pytest.approx(2.0 * 25.4)
