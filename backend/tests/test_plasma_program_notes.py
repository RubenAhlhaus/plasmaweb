"""Program notes: what a program asks for that the toolpath cannot show."""

from __future__ import annotations

from backend.plasma.capabilities import capabilities
from backend.plasma.program_notes import read_program_notes

NO_TUBE_CUT = capabilities(("plasmac.tube-cut",))
EVERYTHING = capabilities(())


def test_a_program_that_asks_nothing_special_has_nothing_to_report() -> None:
    notes = read_program_notes("G21\nG0 X0 Y0\nM3 $0 S1\nG1 X10\nM5 $0\nM2\n", EVERYTHING)

    assert notes == {"directives": {}, "warnings": []}


def test_the_directives_the_filter_acts_on_are_reported() -> None:
    notes = read_program_notes(
        "#<tube-cut>=1\n#<holes>=2\n#<h_velocity>=60\nG0 X0\n", EVERYTHING
    )

    assert notes["directives"] == {"tubeCut": 1.0, "holes": 2.0, "holeVelocity": 60.0}
    assert notes["warnings"] == []


def test_spaces_do_not_hide_a_directive() -> None:
    """The filter strips spaces before matching, so a spaced-out line is still a directive."""
    notes = read_program_notes("#< tube-cut > = 1\n", EVERYTHING)

    assert notes["directives"]["tubeCut"] == 1.0


def test_a_program_asking_for_what_this_linuxcnc_cannot_do_is_called_out() -> None:
    notes = read_program_notes("#<tube-cut>=1\nG0 X0\n", NO_TUBE_CUT)

    assert notes["directives"]["tubeCut"] == 1.0
    assert [w["code"] for w in notes["warnings"]] == ["feature_unavailable"]
    assert "tube cutting" in notes["warnings"][0]["message"]


def test_the_documented_spelling_the_filter_ignores_is_reported() -> None:
    """The manual writes `#<tube_cut>` and the filter matches `#<tube-cut>`; the program means
    it and nothing happens."""
    notes = read_program_notes("#<tube_cut>=1\nG0 X0\n", EVERYTHING)

    assert notes["directives"] == {}
    assert notes["warnings"][0]["code"] == "spelling_ignored"
    assert "#<tube-cut>" in notes["warnings"][0]["message"]


def test_the_same_trap_applies_to_keep_z_motion() -> None:
    notes = read_program_notes("#<keep_z_motion>=1\n", EVERYTHING)

    assert [w["directive"] for w in notes["warnings"]] == ["keepZMotion"]


def test_the_right_spelling_is_not_warned_about_even_when_both_appear() -> None:
    notes = read_program_notes("#<tube_cut>=1\n#<tube-cut>=1\n", EVERYTHING)

    assert notes["directives"]["tubeCut"] == 1.0
    assert notes["warnings"] == []


def test_capabilities_are_optional() -> None:
    """Off the machine there is nothing to check a directive against."""
    notes = read_program_notes("#<tube-cut>=1\n")

    assert notes["directives"]["tubeCut"] == 1.0
    assert notes["warnings"] == []
