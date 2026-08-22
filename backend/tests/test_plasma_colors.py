"""``[COLOR_OPTIONS]``: the machine owner's theme, shared with QtPlasmaC."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.plasma.colors import (
    PLASMA_COLORS,
    ColorRejected,
    normalise,
    read_colors,
    write_colors,
)


def test_a_machine_with_no_colours_gets_qtplasmacs_own(tmp_path: Path) -> None:
    path = tmp_path / "machine.prefs"
    path.write_text("[GUI_OPTIONS]\nMode = 0\n")

    colors = read_colors(str(path))

    assert colors["foreground"] == "#ffee06"
    assert colors["background"] == "#16160e"
    assert colors["estop"] == "#ff0000"
    assert len(colors) == len(PLASMA_COLORS) == 9


def test_the_machines_own_colours_win(tmp_path: Path) -> None:
    """A shop that themed its table in QtPlasmaC must not find this screen blue."""
    path = tmp_path / "machine.prefs"
    path.write_text("[COLOR_OPTIONS]\nForeground = #00ff88\nPreview = #101010\n")

    colors = read_colors(str(path))

    assert colors["foreground"] == "#00ff88"
    assert colors["preview"] == "#101010"
    # The rest still come from upstream's defaults.
    assert colors["estop"] == "#ff0000"


def test_colours_round_trip_under_qtplasmacs_own_keys(tmp_path: Path) -> None:
    path = tmp_path / "machine.prefs"
    path.write_text("[GUI_OPTIONS]\nMode = 0\n")

    write_colors(str(path), {"foreground": "#123456", "estop": "#FF0000"})

    text = path.read_text()
    assert "Foreground = #123456" in text
    assert "Estop = #ff0000" in text  # normalised, so both GUIs store one spelling
    assert "Mode = 0" in text
    assert read_colors(str(path))["foreground"] == "#123456"


def test_a_short_hex_becomes_the_long_one_both_guis_store(tmp_path: Path) -> None:
    assert normalise("#abc") == "#aabbcc"


def test_a_colour_that_is_not_a_colour_is_refused(tmp_path: Path) -> None:
    """It would reach a stylesheet in both GUIs, and a broken colour takes the screen with it."""
    path = tmp_path / "machine.prefs"
    path.write_text("")

    with pytest.raises(ColorRejected) as excinfo:
        write_colors(str(path), {"foreground": "yellow"})
    assert excinfo.value.code == "not_a_colour"
    assert excinfo.value.name == "foreground"


def test_one_bad_colour_refuses_the_whole_write(tmp_path: Path) -> None:
    """Eight good colours and one broken one is harder to recover from than a refusal."""
    path = tmp_path / "machine.prefs"
    path.write_text("[COLOR_OPTIONS]\nForeground = #ffee06\n")

    with pytest.raises(ColorRejected):
        write_colors(str(path), {"background": "#000000", "estop": "nope"})

    assert "#000000" not in path.read_text()


def test_an_unknown_colour_name_is_refused(tmp_path: Path) -> None:
    path = tmp_path / "machine.prefs"
    path.write_text("")

    with pytest.raises(ColorRejected) as excinfo:
        write_colors(str(path), {"sparkle": "#ffffff"})
    assert excinfo.value.code == "unknown_colour"


def test_a_garbled_colour_in_the_file_falls_back_rather_than_breaking_startup(
    tmp_path: Path,
) -> None:
    path = tmp_path / "machine.prefs"
    path.write_text("[COLOR_OPTIONS]\nForeground = not a colour\n")

    assert read_colors(str(path))["foreground"] == "#ffee06"


def test_every_colour_names_the_stylesheet_token_it_replaces() -> None:
    """So anyone comparing this with qtplasmac.style can see which is which."""
    tokens = {colour.token for colour in PLASMA_COLORS}

    assert tokens == {
        "foregnd",
        "highlight",
        "l-e-d",
        "backgnd",
        "backalt",
        "frames",
        "e-stop",
        "inactive",
        "prevu",
    }
