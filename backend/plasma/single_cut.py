"""Single cut: one straight cut from where the torch is, for testing consumables and settings.

QtPlasmaC's SINGLE CUT asks for an X and a Y length, writes a five-line program from the
machine's *current* position and runs it (``qtplasmac_handler.py:4660``). It is what an
operator reaches for after changing consumables — cut one line, look at the edge — so the
program is deliberately tiny and deliberately in machine coordinates.

``G53`` on both moves is the load-bearing detail: the cut is where the torch is standing, not
where a work offset says the origin is. The lengths are remembered in ``[SINGLE CUT]`` so the
next one defaults to the last.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Mapping, Optional, Tuple

from backend.plasma.machine_files import read_config, write_config

logger = logging.getLogger(__name__)

SECTION = "SINGLE CUT"
X_KEY = "X length"
Y_KEY = "Y length"

#: What QtPlasmaC's dialog allows, and a sane ceiling for a value arriving over a WebSocket.
MAX_LENGTH = 9999.0

OUTPUT_NAME = "single_cut.ngc"


class SingleCutError(ValueError):
    """A single cut that must not be generated, with a machine-readable ``code``."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def build_single_cut(
    start: Tuple[float, float],
    x_length: float,
    y_length: float,
    material: Tuple[int, str] = (0, "Default"),
) -> str:
    """The program QtPlasmaC writes: material change, pierce here, cut to there, torch off."""
    if not x_length and not y_length:
        raise SingleCutError("invalid_params", "a single cut needs a length on at least one axis")
    for name, length in (("X", x_length), ("Y", y_length)):
        if abs(length) > MAX_LENGTH:
            raise SingleCutError(
                "invalid_params", f"{name} length must be within ±{MAX_LENGTH:.0f}"
            )

    x_start, y_start = float(start[0]), float(start[1])
    x_end = x_start + float(x_length)
    y_end = y_start + float(y_length)
    return (
        "G90\n"
        f"M190 P{material[0]}\n"
        "F#<_hal[plasmac.cut-feed-rate]>\n"
        f"G53 G0 X{x_start:0.6f} Y{y_start:0.6f}\n"
        "M3 $0 S1\n"
        f"G53 G1 X{x_end:0.6f} Y{y_end:0.6f}\n"
        "M5 $0\n"
        "M2\n"
    )


def read_lengths(path: str) -> Dict[str, float]:
    """The last lengths used, so the next single cut defaults to them."""
    parser = read_config(path)
    lengths = {X_KEY: 0.0, Y_KEY: 0.0}
    for key in lengths:
        if parser.has_option(SECTION, key):
            try:
                lengths[key] = float(parser.get(SECTION, key))
            except (TypeError, ValueError):
                logger.warning("plasma: %s: [%s] %s is not a number", path, SECTION, key)
    return lengths


def write_lengths(path: str, x_length: float, y_length: float) -> None:
    parser = read_config(path)
    if not parser.has_section(SECTION):
        parser.add_section(SECTION)
    parser.set(SECTION, X_KEY, str(float(x_length)))
    parser.set(SECTION, Y_KEY, str(float(y_length)))
    write_config(path, parser)
