"""Discover user `.ngc` macros listed in ``[MACROS]`` for the Macros UI."""

from __future__ import annotations

import configparser
import os
import re
from typing import Any

from backend.program_prefix_ini import program_prefix_directories_from_ini

# LinuxCNC named O-word: letter, then letters/digits/underscore.
_O_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
# Built-in lcncgui queue subroutines shipped with the install.
_LCNCGUI_PREFIX = "lcncgui_"


def _read_subroutine_path_raw(ini_path: str) -> str | None:
    """Return raw ``SUBROUTINE_PATH`` from the INI, or ``None`` if unset/unreadable."""
    try:
        import linuxcnc  # type: ignore

        try:
            inifile = linuxcnc.ini(ini_path)
        except Exception:
            inifile = None
        if inifile is not None:
            try:
                raw = inifile.find("RS274NGC", "SUBROUTINE_PATH")
            except Exception:
                raw = None
            if raw is not None and str(raw).strip():
                return str(raw).strip()
    except ImportError:
        pass

    parser = configparser.ConfigParser(interpolation=None)
    parser.optionxform = str.lower
    try:
        parser.read(ini_path, encoding="utf-8")
    except Exception:
        return None
    if not parser.has_option("RS274NGC", "SUBROUTINE_PATH"):
        return None
    raw = parser.get("RS274NGC", "SUBROUTINE_PATH", fallback="").strip()
    return raw or None


def _parse_macro_ini_line(raw: str) -> str | None:
    """
    Parse a gmoccapy-style ``MACRO =`` value.

    ``go_home`` or ``increment xinc yinc`` → first token is the O-word / file stem.
    Call arguments after the name are ignored (no param dialog yet).
    """
    text = (raw or "").strip()
    if not text:
        return None
    # Strip inline comments that survived a line scan.
    text = text.split(";", 1)[0].strip()
    if not text:
        return None
    name = text.split(None, 1)[0].strip()
    if not name or not _O_NAME_RE.match(name):
        return None
    if name.lower().startswith(_LCNCGUI_PREFIX):
        return None
    return name


def _read_macros_section_names(ini_path: str) -> list[str]:
    """
    Return O-word names from ``[MACROS] MACRO=…`` in declaration order.

    Prefers ``linuxcnc.ini().findall`` (duplicate keys); falls back to a line scan
    because ConfigParser cannot represent repeated ``MACRO`` options.
    """
    names: list[str] = []
    seen: set[str] = set()

    def _add(raw: str) -> None:
        parsed = _parse_macro_ini_line(raw)
        if not parsed:
            return
        key = parsed.lower()
        if key in seen:
            return
        seen.add(key)
        names.append(parsed)

    try:
        import linuxcnc  # type: ignore

        try:
            inifile = linuxcnc.ini(ini_path)
        except Exception:
            inifile = None
        if inifile is not None:
            try:
                values = inifile.findall("MACROS", "MACRO")
            except Exception:
                values = None
            if values:
                for raw in values:
                    _add(str(raw))
                if names:
                    return names
    except ImportError:
        pass

    try:
        with open(ini_path, encoding="utf-8", errors="replace") as f:
            in_macros = False
            for line in f:
                main = line.split(";", 1)[0].strip()
                if not main:
                    continue
                if main.startswith("[") and main.endswith("]"):
                    sec = main[1:-1].strip().lower()
                    in_macros = sec == "macros"
                    continue
                if not in_macros or "=" not in main:
                    continue
                key, val = main.split("=", 1)
                if key.strip().lower() != "macro":
                    continue
                _add(val)
    except OSError:
        return names

    return names


def _resolve_ngc_in_subroutine_path(name: str, search_dirs: list[str]) -> dict[str, Any] | None:
    """Find ``name.ngc`` (case-insensitive match on basename) in SUBROUTINE_PATH dirs."""
    want = f"{name}.ngc".lower()
    for directory in search_dirs:
        try:
            entries = os.listdir(directory)
        except OSError:
            continue
        for entry in entries:
            if entry.lower() != want:
                continue
            full = os.path.join(directory, entry)
            if not os.path.isfile(full):
                continue
            try:
                path = os.path.realpath(full)
            except OSError:
                path = os.path.abspath(full)
            return {
                "name": name,
                "fileName": entry,
                "path": path,
            }
    return None


def list_user_subroutine_macros_from_ini(ini_path: str | None) -> list[dict[str, Any]]:
    """
    List user macros for the Macros screen from ``[MACROS]``.

    Only names declared as ``MACRO = …`` are considered. Each name must resolve to a
    ``.ngc`` file under ``[RS274NGC] SUBROUTINE_PATH`` (INI-relative path rules). Entries
    without a matching file are omitted. Order follows the INI ``MACRO`` lines.
    """
    if not ini_path or not os.path.isfile(ini_path):
        return []

    declared = _read_macros_section_names(ini_path)
    if not declared:
        return []

    raw_path = _read_subroutine_path_raw(ini_path)
    if not raw_path:
        return []

    dirs = program_prefix_directories_from_ini(raw_path, ini_path)
    if not dirs:
        return []

    out: list[dict[str, Any]] = []
    for name in declared:
        resolved = _resolve_ngc_in_subroutine_path(name, dirs)
        if resolved:
            out.append(resolved)
    return out
