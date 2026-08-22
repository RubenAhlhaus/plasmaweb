"""``[COLOR_OPTIONS]``: the nine colours a QtPlasmaC machine is themed with.

QtPlasmaC's look is one Qt stylesheet (``qtplasmac.style``, 21 KB) with nine placeholder tokens
— ``foregnd``, ``backgnd``, ``backalt``, ``highlight``, ``frames``, ``inactive``, ``e-stop``,
``l-e-d``, ``prevu`` — string-replaced with the colours from the machine's prefs file
(``standard_stylesheet``, ``qtplasmac_handler.py:6027``). Change one in its colour dialog and
the whole screen follows.

Porting the *stylesheet* would mean porting Qt's widget selectors, which say nothing about a web
UI. Porting the *nine colours* is the part that matters: they are the machine owner's choice,
they live in the same file both GUIs read, and a shop that themed its table yellow-on-black in
QtPlasmaC should not find this screen blue.

So this module owns the colours and nothing else. What each one drives on the web side is a
front-end decision, kept there.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, Mapping, NamedTuple, Tuple

logger = logging.getLogger(__name__)

SECTION = "COLOR_OPTIONS"


class PlasmaColor(NamedTuple):
    """One colour: its prefs key, the name we report it under, and QtPlasmaC's default."""

    key: str
    name: str
    default: str
    #: The placeholder this colour replaces in ``qtplasmac.style``, for anyone comparing.
    token: str


#: All nine, in the order QtPlasmaC's own settings screen lists them.
PLASMA_COLORS: Tuple[PlasmaColor, ...] = (
    PlasmaColor("Foreground", "foreground", "#ffee06", "foregnd"),
    PlasmaColor("Highlight", "highlight", "#ffee06", "highlight"),
    PlasmaColor("LED", "led", "#ffee06", "l-e-d"),
    PlasmaColor("Background", "background", "#16160e", "backgnd"),
    PlasmaColor("Background Alt", "backgroundAlt", "#36362e", "backalt"),
    PlasmaColor("Frames", "frames", "#ffee06", "frames"),
    PlasmaColor("Estop", "estop", "#ff0000", "e-stop"),
    PlasmaColor("Disabled", "disabled", "#b0b0b0", "inactive"),
    PlasmaColor("Preview", "preview", "#000000", "prevu"),
)

_BY_NAME: Dict[str, PlasmaColor] = {colour.name: colour for colour in PLASMA_COLORS}

#: ``#rgb``, ``#rrggbb`` or ``#rrggbbaa`` — Qt writes the middle one, and accepts the others.
_HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


class ColorRejected(ValueError):
    """A colour that is not a colour, with the name that was wrong."""

    def __init__(self, code: str, message: str, name: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.name = name


def normalise(value: str) -> str:
    """A hex colour in the form Qt writes, or raise.

    Anything the file cannot express as a colour is rejected rather than passed through: it
    would reach a stylesheet on both GUIs, and a broken colour there takes the screen with it.
    """
    text = (value or "").strip().lower()
    if not _HEX.match(text):
        raise ColorRejected("not_a_colour", f"{value!r} is not a hex colour", "")
    if len(text) == 4:  # #rgb → #rrggbb, so both GUIs store the same string
        return "#" + "".join(character * 2 for character in text[1:])
    return text


def read_colors(path: str) -> Dict[str, str]:
    """The machine's nine colours, QtPlasmaC's defaults where the file is silent or wrong."""
    from backend.plasma.machine_files import read_config  # noqa: PLC0415 — avoids a cycle

    parser = read_config(path)
    values: Dict[str, str] = {}
    for colour in PLASMA_COLORS:
        value = colour.default
        if parser.has_option(SECTION, colour.key):
            raw = parser.get(SECTION, colour.key)
            try:
                value = normalise(raw)
            except ColorRejected:
                logger.warning(
                    "plasma: %s: [%s] %s is not a colour (%r); using %s",
                    path,
                    SECTION,
                    colour.key,
                    raw,
                    colour.default,
                )
        values[colour.name] = value
    return values


def write_colors(path: str, values: Mapping[str, Any]) -> None:
    """Store colours, spelled as QtPlasmaC spells their keys so it reads them back.

    Every value is validated first and the whole write refused if one is wrong — a file with
    eight good colours and one broken one is harder to recover from than a rejected change.
    """
    from backend.plasma.machine_files import read_config, write_config  # noqa: PLC0415

    checked: Dict[str, str] = {}
    for name, value in values.items():
        colour = _BY_NAME.get(name)
        if colour is None:
            raise ColorRejected("unknown_colour", f"no colour named {name!r}", name)
        try:
            checked[colour.key] = normalise(str(value))
        except ColorRejected as exc:
            raise ColorRejected(exc.code, f"{name}: {exc.message}", name) from None

    parser = read_config(path)
    if not parser.has_section(SECTION):
        parser.add_section(SECTION)
    for key, value in checked.items():
        parser.set(SECTION, key, value)
    write_config(path, parser)
