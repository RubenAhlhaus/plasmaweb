"""Resolve ``[DISPLAY] PROGRAM_PREFIX`` like LinuxCNC (paths relative to the INI directory)."""

from __future__ import annotations

import os


def program_prefix_directories_from_ini(raw: str, ini_path: str) -> list[str]:
    """
    Parse PROGRAM_PREFIX value: optional colon-separated list (LinuxCNC / SUBROUTINE_PATH style).

    Relative segments are resolved against the directory containing ``ini_path``, not the
    process current working directory — matching LinuxCNC INI behaviour.
    """
    text = (raw or "").strip()
    if not text:
        return []

    ini_abs = os.path.abspath(ini_path)
    ini_dir = os.path.dirname(ini_abs)

    out: list[str] = []
    seen: set[str] = set()
    # LinuxCNC uses ":" between multiple dirs (like SUBROUTINE_PATH). On Windows, ":" is
    # also the drive letter (C:\...), so never split there — multi-dir INI is Linux-only.
    if os.name == "nt" and len(text) >= 2 and text[1] == ":":
        segments = [text]
    else:
        segments = text.split(":")

    for segment in segments:
        seg = segment.strip()
        if not seg:
            continue
        p = os.path.expanduser(seg)
        if not os.path.isabs(p):
            p = os.path.join(ini_dir, p)
        ap = os.path.abspath(p)
        try:
            rp = os.path.realpath(ap)
        except OSError:
            rp = ap
        if rp and rp not in seen:
            seen.add(rp)
            out.append(rp)
    return out
