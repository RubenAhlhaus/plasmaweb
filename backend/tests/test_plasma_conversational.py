"""Conversational shapes, checked against the reference modules themselves.

The exit criterion for this milestone is byte-identity: what our façade produces must be what
calling ``plasmac.<shape>.preview`` directly produces for the same inputs. That is testable off
the machine because the reference tree ships those modules and they are pure Python — so these
tests import them from ``reference/linuxcnc/lib/python`` and compare, rather than asserting
against G-code pasted into a test file, which would only ever prove we can copy.
"""

from __future__ import annotations

import builtins
import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict

import pytest

REFERENCE_PYTHON = Path(__file__).resolve().parents[2] / "reference" / "linuxcnc" / "lib" / "python"

pytestmark = pytest.mark.skipif(
    not (REFERENCE_PYTHON / "plasmac" / "circle.py").exists(),
    reason="reference tree not checked out",
)


@pytest.fixture(autouse=True)
def reference_on_path(monkeypatch: pytest.MonkeyPatch):
    """Make the reference ``plasmac`` package importable, exactly once per test."""
    monkeypatch.syspath_prepend(str(REFERENCE_PYTHON))
    for name in [key for key in sys.modules if key.startswith("plasmac")]:
        monkeypatch.delitem(sys.modules, name, raising=False)
    if not hasattr(builtins, "_"):
        monkeypatch.setattr(builtins, "_", lambda text: text, raising=False)
    yield


from backend.plasma.conversational import (  # noqa: E402 — after the path fixture is defined
    NEW_JOB,
    SHAPES,
    ConversationalError,
    ConvShim,
    default_ambles,
    generate,
    shape_parameters,
    shapes,
)

CIRCLE = {
    "leadinLength": 5.0,
    "leadoutLength": 5.0,
    "isCenter": True,
    "xOffset": 50.0,
    "yOffset": 40.0,
    "kerfWidth": 1.5,
    "isExternal": False,
    "isOvercut": False,
    "overCut": 0.0,
    "smallHoleDia": 32.0,
    "smallHoleSpeed": 60,
    "diameter": 30.0,
    "invalidLeads": 0,
}

RECTANGLE = {
    "leadinLength": 4.0,
    "leadoutLength": 4.0,
    "isCenter": False,
    "xOffset": 0.0,
    "yOffset": 0.0,
    "kerfWidth": 1.5,
    "isExternal": True,
    "width": 60.0,
    "height": 40.0,
    "angle": 0.0,
    # Per-corner radius: style is radius/chamfer, the text fields are what the GUI shows.
    "styleR1": "radius",
    "styleR2": "radius",
    "styleR3": "radius",
    "styleR4": "radius",
    "radiusR1": 2.0,
    "radiusR2": 2.0,
    "radiusR3": 2.0,
    "radiusR4": 2.0,
    "textR1": "2.0",
    "textR2": "2.0",
    "textR3": "2.0",
    "textR4": "2.0",
}


def reference_gcode(shape: str, params: Dict[str, Any], job: str = NEW_JOB) -> str:
    """What upstream produces, called the way QtPlasmaC calls it."""
    module = __import__(f"plasmac.{shape}", fromlist=[shape])
    directory = tempfile.mkdtemp(prefix="reference-conv-")
    try:
        tmp = os.path.join(directory, "tmp.ngc")
        ngc = os.path.join(directory, "out.ngc")
        bkp = os.path.join(directory, "bkp.ngc")
        Path(bkp).write_text(job)
        Path(tmp).write_text("")
        amble = default_ambles("mm")
        error = module.preview(
            ConvShim(),
            tmp,
            ngc,
            bkp,
            0,
            "Default",
            amble,
            amble,
            **params,
        )
        assert not error, error
        return Path(ngc).read_text()
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def test_a_circle_is_byte_identical_to_calling_upstream_directly() -> None:
    result = generate("circle", CIRCLE)

    assert result["error"] is None
    assert result["gcode"] == reference_gcode("circle", CIRCLE)


def test_a_rectangle_is_byte_identical_to_calling_upstream_directly() -> None:
    result = generate("rectangle", RECTANGLE)

    assert result["error"] is None
    assert result["gcode"] == reference_gcode("rectangle", RECTANGLE)


@pytest.mark.parametrize(
    "shape,params",
    [
        (
            "polygon",
            {
                "leadinLength": 3.0,
                "leadoutLength": 3.0,
                "isCenter": True,
                "xOffset": 40.0,
                "yOffset": 40.0,
                "kerfWidth": 1.5,
                "isExternal": True,
                "sides": 6,
                "diameter": 50.0,
                "sAngle": 0.0,
                "inStyle": True,
                "diaOrLen": True,
            },
        ),
        (
            "star",
            {
                "leadinLength": 3.0,
                "leadoutLength": 3.0,
                "isCenter": True,
                "xOffset": 50.0,
                "yOffset": 50.0,
                "kerfWidth": 1.5,
                "isExternal": True,
                "points": 5,
                "extDia": 60.0,
                "intDia": 30.0,
                "angle": 0.0,
            },
        ),
        (
            "slot",
            {
                "leadinLength": 3.0,
                "leadoutLength": 3.0,
                "isCenter": True,
                "xOffset": 40.0,
                "yOffset": 40.0,
                "kerfWidth": 1.5,
                "isExternal": False,
                "length": 60.0,
                "width": 20.0,
                "angle": 30.0,
            },
        ),
        (
            "bolt_circle",
            {
                "leadinLength": 3.0,
                "leadoutLength": 3.0,
                "shapeAng": 0.0,
                "isCenter": True,
                "xOffset": 60.0,
                "yOffset": 60.0,
                "kerfWidth": 1.5,
                "isOvercut": False,
                "overCut": 0.0,
                "smallHoleDia": 32.0,
                "smallHoleSpeed": 60,
                "circleDia": 80.0,
                "holeDia": 10.0,
                "holeNum": 6,
                "circleAng": 360.0,
                "invalidLeads": 0,
            },
        ),
        (
            "sector",
            {
                "leadinLength": 3.0,
                "leadoutLength": 3.0,
                "xOffset": 20.0,
                "yOffset": 20.0,
                "kerfWidth": 1.5,
                "isExternal": True,
                "radius": 40.0,
                # sAngle is the sector's own angle; `angle` rotates the whole shape.
                "sAngle": 90.0,
                "angle": 0.0,
            },
        ),
    ],
)
def test_every_shape_matches_upstream(shape: str, params: Dict[str, Any]) -> None:
    """One case per shape family: arcs, straight sides, and a repeated feature."""
    available = {entry["name"] for entry in shape_parameters(shape)}
    assert set(params) <= available, sorted(set(params) - available)

    result = generate(shape, params)

    assert result["error"] is None, result["error"]
    assert result["gcode"] == reference_gcode(shape, params)


def test_a_second_shape_is_added_to_the_job_rather_than_replacing_it() -> None:
    """The job round-trips: upstream's temp-file protocol is what makes multi-shape jobs work."""
    first = generate("circle", CIRCLE)

    second = generate("rectangle", RECTANGLE, job=first["gcode"])

    assert second["error"] is None
    assert "(conversational circle)" in second["gcode"]
    assert "(conversational rectangle)" in second["gcode"]
    # One preamble and one postamble for the whole job, not one per shape.
    assert second["gcode"].count("(preamble)") == 1
    assert second["gcode"].count("(postamble)") == 1
    assert second["gcode"].rstrip().endswith("M02")


def test_the_shape_on_its_own_is_returned_too() -> None:
    """The UI previews the added shape; the job is what gets saved."""
    result = generate("circle", CIRCLE)

    assert result["shape"].lstrip().startswith("(conversational circle)")
    assert "M190 P0" in result["shape"]
    assert result["shape"] in result["gcode"]


def test_the_material_reaches_the_generated_code() -> None:
    result = generate("circle", CIRCLE, material=(3, "5mm mild steel"))

    assert ";using material #3: 5mm mild steel" in result["gcode"]
    assert "M190 P3" in result["gcode"]


def test_the_ambles_are_qtplasmacs_own_defaults() -> None:
    metric = generate("circle", CIRCLE)

    assert "G21" in metric["gcode"]
    assert "G64P0.25" in metric["gcode"]
    assert default_ambles("inch").startswith("G20")


def test_a_shape_rejecting_its_input_is_a_message_not_a_crash() -> None:
    result = generate("circle", {**CIRCLE, "diameter": 0.0})

    assert result["gcode"] is None
    assert "DIAMETER" in result["error"]


def test_a_non_numeric_entry_is_reported_the_way_upstream_reports_it() -> None:
    result = generate("circle", {**CIRCLE, "xOffset": "over there"})

    assert result["gcode"] is None
    assert "X ORIGIN" in result["error"]


def test_an_unknown_parameter_is_refused_rather_than_ignored() -> None:
    with pytest.raises(ConversationalError) as excinfo:
        generate("circle", {**CIRCLE, "diamter": 30.0})

    assert excinfo.value.code == "unknown_parameters"
    assert "diamter" in excinfo.value.message


def test_a_missing_parameter_names_what_is_missing() -> None:
    incomplete = {key: value for key, value in CIRCLE.items() if key != "diameter"}

    with pytest.raises(ConversationalError) as excinfo:
        generate("circle", incomplete)

    assert excinfo.value.code == "missing_parameters"
    assert "diameter" in excinfo.value.message


def test_an_unknown_shape_is_refused() -> None:
    with pytest.raises(ConversationalError) as excinfo:
        generate("dodecahedron", {})

    assert excinfo.value.code == "unknown_shape"


def test_the_shape_list_is_read_off_the_installed_modules() -> None:
    available = shapes()

    # A shape whose own dependency is missing (ellipse needs numpy) drops out rather than
    # taking the rest of them down with it.
    assert set(available) <= set(SHAPES)
    assert {"circle", "rectangle", "slot", "star"} <= set(available)
    names = [entry["name"] for entry in available["circle"]]
    assert names[:4] == ["matNumber", "matName", "preAmble", "postAmble"]
    assert "diameter" in names
    # The four arguments this layer supplies are not part of a shape's schema.
    assert not {"Conv", "fTmp", "fNgc", "fNgcBkp"} & set(names)


def test_the_validators_keep_upstreams_empty_versus_nonsense_distinction() -> None:
    assert ConvShim.conv_is_float("2.5") == (True, 2.5)
    assert ConvShim.conv_is_float("") == (False, 0)
    assert ConvShim.conv_is_float("nope") == (False, -1)
    assert ConvShim.conv_is_int("4") == (True, 4)
    assert ConvShim.conv_is_int("") == (False, 0)


def test_machine_defaults_are_filtered_to_what_the_shape_takes() -> None:
    """The machine cannot know which shape it is: a rectangle has no small-hole diameter."""
    geometry = {key: value for key, value in RECTANGLE.items() if key not in ("kerfWidth",)}

    result = generate(
        "rectangle",
        geometry,
        defaults={"kerfWidth": 1.5, "smallHoleDia": 32.0, "smallHoleSpeed": 60},
    )

    assert result["error"] is None
    assert result["gcode"] == reference_gcode("rectangle", RECTANGLE)


def test_what_the_form_sends_wins_over_the_machine_default() -> None:
    result = generate("circle", CIRCLE, defaults={"kerfWidth": 9.9})

    assert result["gcode"] == reference_gcode("circle", CIRCLE)


# ---- lines and arcs -----------------------------------------------------------------


from backend.plasma.conversational import (  # noqa: E402 — same reason as the import above
    LINE_SEGMENTS,
    generate_line,
    line_segment_kinds,
)

#: The line module needs numpy for its three-point arc, as `ellipse` does for its own maths.
numpy_required = pytest.mark.skipif(
    __import__("importlib").util.find_spec("numpy") is None,
    reason="the reference line module needs numpy",
)

SQUARE = [
    {"kind": "point", "xEnd": 100.0, "yEnd": 0.0},
    {"kind": "angle", "length": 50.0, "angle": 90.0},
    {"kind": "arcRadius", "xEnd": 0.0, "yEnd": 50.0, "radius": 80.0, "arcType": "02"},
    {"kind": "point", "xEnd": 0.0, "yEnd": 0.0},
]


def reference_line(segments, start=(0.0, 0.0), job: str = NEW_JOB) -> str:
    """Upstream's own sequence: first_segment, then a last_segment/next_segment per press."""
    from plasmac import line  # type: ignore

    directory = tempfile.mkdtemp(prefix="reference-line-")
    try:
        tmp = os.path.join(directory, "tmp.ngc")
        ngc = os.path.join(directory, "out.ngc")
        bkp = os.path.join(directory, "bkp.ngc")
        Path(bkp).write_text(job)
        amble = default_ambles("mm")
        line.first_segment(tmp, ngc, bkp, amble, start[0], start[1], 0, "Default")
        x, y = start
        for index, segment in enumerate(segments):
            function, names = LINE_SEGMENTS[segment["kind"]]
            result = getattr(line, function)(
                ConvShim(), x, y, *(segment[name] for name in names)
            )
            assert not result[0], result[1]
            _failed, x, y, code = result
            line.last_segment(tmp, ngc, code, amble)
            if index < len(segments) - 1:
                line.next_segment(tmp, ngc)
        return Path(ngc).read_text()
    finally:
        shutil.rmtree(directory, ignore_errors=True)


@numpy_required
def test_a_multi_segment_cut_matches_upstreams_own_sequence() -> None:
    result = generate_line(SQUARE)

    assert result["error"] is None, result["error"]
    assert result["gcode"] == reference_line(SQUARE)


@numpy_required
def test_the_cut_is_one_pierce_with_the_segments_between() -> None:
    gcode = generate_line(SQUARE)["gcode"]

    assert gcode.count("M03 $0 S1") == 1
    assert gcode.count("M05 $0") == 1
    assert "(conversational line/arc)" in gcode
    assert gcode.rstrip().endswith("M02")


@numpy_required
def test_each_segment_starts_where_the_last_one_ended() -> None:
    result = generate_line(
        [
            {"kind": "point", "xEnd": 10.0, "yEnd": 0.0},
            {"kind": "angle", "length": 10.0, "angle": 90.0},
        ]
    )

    assert result["end"] == [10.0, 10.0]
    assert "G01 X10.000000 Y0.000000" in result["gcode"]
    assert "G01 X10.000000 Y10.000000" in result["gcode"]


@numpy_required
def test_an_arc_uses_the_direction_it_was_given() -> None:
    clockwise = generate_line(
        [{"kind": "arcRadius", "xEnd": 50.0, "yEnd": 0.0, "radius": 40.0, "arcType": "02"}]
    )
    anticlockwise = generate_line(
        [{"kind": "arcRadius", "xEnd": 50.0, "yEnd": 0.0, "radius": 40.0, "arcType": "03"}]
    )

    assert "G02 X50.000000" in clockwise["gcode"]
    assert "G03 X50.000000" in anticlockwise["gcode"]


@numpy_required
def test_a_segment_the_builder_rejects_says_which_segment(caplog) -> None:
    result = generate_line(
        [
            {"kind": "point", "xEnd": 10.0, "yEnd": 0.0},
            # A radius smaller than half the chord cannot be drawn.
            {"kind": "arcRadius", "xEnd": 100.0, "yEnd": 0.0, "radius": 1.0, "arcType": "02"},
        ]
    )

    assert result["gcode"] is None
    assert result["error"].startswith("segment 2:")
    assert "Radius" in result["error"]


@numpy_required
def test_a_zero_length_line_is_upstreams_complaint_not_ours() -> None:
    result = generate_line([{"kind": "point", "xEnd": 0.0, "yEnd": 0.0}])

    assert result["gcode"] is None
    assert "zero" in result["error"].lower()


@numpy_required
def test_a_line_is_added_to_an_existing_job() -> None:
    first = generate("circle", CIRCLE)

    second = generate_line(SQUARE, job=first["gcode"])

    assert "(conversational circle)" in second["gcode"]
    assert "(conversational line/arc)" in second["gcode"]
    assert second["gcode"].count("(preamble)") == 1


@numpy_required
def test_an_unknown_segment_kind_is_refused() -> None:
    with pytest.raises(ConversationalError) as excinfo:
        generate_line([{"kind": "spiral", "xEnd": 1.0}])

    assert excinfo.value.code == "unknown_segment"


@numpy_required
def test_a_segment_missing_a_parameter_names_it() -> None:
    with pytest.raises(ConversationalError) as excinfo:
        generate_line([{"kind": "point", "xEnd": 10.0}])

    assert excinfo.value.code == "missing_parameters"
    assert "yEnd" in excinfo.value.message


@numpy_required
def test_no_segments_at_all_is_refused() -> None:
    with pytest.raises(ConversationalError) as excinfo:
        generate_line([])

    assert excinfo.value.code == "no_segments"


@numpy_required
def test_the_segment_kinds_come_from_the_installed_module() -> None:
    kinds = line_segment_kinds()

    assert set(kinds) == set(LINE_SEGMENTS)
    assert kinds["arcRadius"] == ["xEnd", "yEnd", "radius", "arcType"]
