"""Where QtPlasmaC keeps a machine's plasma files, and how to read and write them.

Both files sit beside the INI and are named from ``[EMC] MACHINE``: ``<machine>.prefs`` holds
the plasma parameters and GUI options, ``<machine>_material.cfg`` the cut materials.

They are written by qtvcp's ``Access`` — a ``RawConfigParser`` with ``optionxform = str``
(``lib/python/qtvcp/lib/preferences.py``) — so we read and write them with the same class
rather than hand-rolling a parser. Byte-for-byte parity matters: QtPlasmaC has to be able to
open a file the web UI saved, and a user may well run both against one config.

Key case is significant (``Pid P Gain``, not ``pid p gain``), which is what ``optionxform``
is for. Comments do not survive a write, in QtPlasmaC either — ``Access.putpref`` rewrites
the whole file through ``RawConfigParser.write`` on every single key it stores.
"""

from __future__ import annotations

import configparser
import logging
import os
import tempfile
from typing import NamedTuple, Optional

logger = logging.getLogger(__name__)

#: LinuxCNC hands the active INI path to the processes it launches under one of these.
_INI_ENV_KEYS = ("INI_FILE_NAME", "LINUXCNC_INI", "INI_FILE")

#: QtPlasmaC's ``unitsPerMm``: 1 for a metric machine, 0.03937 for an imperial one. The odd
#: constant is upstream's (``qtplasmac_handler.py:191``), not a rounding of 1/25.4 by us —
#: parameter defaults are derived from it, so ours have to match theirs exactly.
INCH_UNITS_PER_MM = 0.03937


class MachineFiles(NamedTuple):
    """The plasma files for one machine, and the unit scale their defaults are in."""

    ini_path: str
    machine: str
    prefs_path: str
    materials_path: str
    units_per_mm: float


def ini_path() -> Optional[str]:
    """The active LinuxCNC INI, from the environment LinuxCNC gave this process."""
    for key in _INI_ENV_KEYS:
        raw = os.environ.get(key)
        if not raw:
            continue
        path = os.path.expanduser(raw.strip())
        if os.path.isfile(path):
            return path
    return None


def ini_value(path: str, section: str, key: str) -> Optional[str]:
    """One raw INI value, preferring ``linuxcnc.ini`` over a line scan.

    ``linuxcnc.ini`` tolerates the duplicate keys a LinuxCNC INI is allowed to have; the line
    scan is what makes this work off the machine, where the module does not exist.
    """
    try:
        import linuxcnc  # type: ignore  # noqa: PLC0415 — only present on the machine

        found = linuxcnc.ini(path).find(section, key)
        if found is not None and str(found).strip():
            return str(found).strip()
    except Exception:
        logger.debug("plasma: linuxcnc.ini could not read [%s] %s", section, key, exc_info=True)

    try:
        in_section = False
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                stripped = line.split("#", 1)[0].split(";", 1)[0].strip()
                if stripped.startswith("[") and stripped.endswith("]"):
                    in_section = stripped[1:-1].strip().upper() == section.upper()
                    continue
                if not in_section or "=" not in stripped:
                    continue
                name, _, value = stripped.partition("=")
                if name.strip().upper() == key.upper() and value.strip():
                    return value.strip()
    except OSError:
        logger.debug("plasma: could not read %s", path, exc_info=True)
    return None


def ini_real(path: str, section: str, key: str) -> Optional[float]:
    raw = ini_value(path, section, key)
    if raw is None:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def machine_files(path: Optional[str] = None) -> Optional[MachineFiles]:
    """Resolve the plasma files for the running machine, or ``None`` without an INI.

    The files need not exist yet — QtPlasmaC creates them on first run, and so may we.
    """
    resolved = path or ini_path()
    if not resolved:
        return None

    machine = ini_value(resolved, "EMC", "MACHINE") or "<unknown>"
    directory = os.path.dirname(os.path.abspath(resolved))
    units = (ini_value(resolved, "TRAJ", "LINEAR_UNITS") or "mm").strip().lower()
    return MachineFiles(
        ini_path=resolved,
        machine=machine,
        prefs_path=os.path.join(directory, f"{machine}.prefs"),
        materials_path=os.path.join(directory, f"{machine}_material.cfg"),
        units_per_mm=INCH_UNITS_PER_MM if units in ("inch", "in", "imperial") else 1.0,
    )


def read_config(path: str) -> configparser.RawConfigParser:
    """Parse one of QtPlasmaC's files the way qtvcp does. A missing file reads as empty."""
    parser = configparser.RawConfigParser()
    parser.optionxform = str  # type: ignore[assignment,method-assign]
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            parser.read_file(handle)
    return parser


def render_config(parser: configparser.RawConfigParser) -> str:
    """The exact text ``RawConfigParser.write`` produces, which is what QtPlasmaC writes."""
    from io import StringIO  # noqa: PLC0415 — local to keep the module's imports honest

    buffer = StringIO()
    parser.write(buffer)
    return buffer.getvalue()


def write_config(path: str, parser: configparser.RawConfigParser) -> None:
    """Write via a temporary file in the same directory, so a crash cannot truncate a config."""
    content = render_config(parser)
    directory = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp_path = tempfile.mkstemp(prefix=".plasmaweb-plasma-", dir=directory, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as tmp:
            tmp.write(content)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
