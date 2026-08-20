"""Run From Line: restart a program mid-cut, using LinuxCNC's own ``plasmac`` helper.

``lib/python/plasmac/run_from_line.py`` is pure Python and already does the hard part — replay
the modal state from before the chosen line, and optionally build a lead-in into the cut. It is
imported rather than reimplemented; what lives here is the part QtPlasmaC's handler does around
it (``run_clicked()``, ``qtplasmac_handler.py:1857``):

* **HERE TO END** runs from the chosen line to the end of the program.
* **THIS CUTPATH** runs one cut: back up to the ``G00`` move that positioned it, and stop at the
  ``M05`` that ends it (or, inside a ``#<keep-z-motion>`` block, at the ``G53 G00 Z`` that does).

The result is a new program written next to the machine's other temporary files, which the UI
then loads like any other file — the same shape as upstream, where ``rfl.ngc`` is what actually
runs.

Two things it refuses, both from upstream's own checks: a start line inside a subroutine, and a
program using cutter compensation. In each case the modal replay cannot be trusted, and running
anyway would move the torch somewhere the operator did not ask for.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

HERE_TO_END = "here"
THIS_CUTPATH = "cut"

#: Where QtPlasmaC puts the generated program, so both GUIs behave the same way.
DEFAULT_OUTPUT_DIR = "/tmp/qtplasmac"
OUTPUT_NAME = "rfl.ngc"


class RunFromLineError(RuntimeError):
    """A run-from-line that must not proceed, with a machine-readable ``code``."""

    def __init__(self, code: str, message: str, detail: Optional[Any] = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail


def cutpath_bounds(path: str, start_line: int) -> Tuple[int, int]:
    """The line range of the cut containing ``start_line``, as QtPlasmaC scans for it.

    Returns ``(start, last)`` — ``start`` backed up to the ``G00`` that positioned the cut, and
    ``last`` the line that ends it. ``last`` is 0 when the scan found no end, which the helper
    reads as "to the end of the program".
    """
    count = 0
    start = 0
    start_found = False
    in_keep_z_motion = False
    last = 0

    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            stripped = line.replace(" ", "")
            if "#<keep-z-motion>=1" in stripped:
                in_keep_z_motion = True
            elif "#<keep-z-motion>=0" in stripped:
                in_keep_z_motion = False

            # The last G00 XY at or before the chosen line, else the first one after it.
            if line[:3] == "G00" and "G53" not in line and ("X" in line or "Y" in line):
                if count <= start_line or not start_found:
                    start = count
                    start_found = count >= start_line

            if count > max(start_line, start):
                ends_keep_z = "G53" in line and "G00" in line and "Z" in line
                if (in_keep_z_motion and (ends_keep_z or "#<keep-z-motion>=0" in stripped)) or (
                    not in_keep_z_motion and line[:3] == "M05"
                ):
                    last = count
                    break
            count += 1
        else:
            last = count

    return start, last


def _helper() -> Any:
    try:
        from plasmac import run_from_line as helper  # type: ignore  # noqa: PLC0415

        return helper
    except ImportError:
        raise RunFromLineError(
            "run_from_line_unavailable",
            "LinuxCNC's plasmac.run_from_line helper is not available in this process",
        ) from None


def _describe_refusal(data: Dict[str, Any]) -> RunFromLineError:
    if data.get("compError"):
        return RunFromLineError(
            "cutter_compensation_active",
            "Cannot run from line while cutter compensation is active",
        )
    subs = data.get("subError") or []
    return RunFromLineError(
        "inside_subroutine",
        "Cannot run from line inside subroutine" + ("".join(f" {sub}" for sub in subs)),
        detail=list(subs),
    )


def build_run_from_line(
    path: str,
    start_line: int,
    run_type: str = HERE_TO_END,
    units_per_mm: float = 1.0,
    leadin_length: float = 0.0,
    leadin_angle: float = 0.0,
    output_dir: str = DEFAULT_OUTPUT_DIR,
) -> Dict[str, Any]:
    """Write the run-from-line program for ``start_line`` and report where it went.

    ``leadin_length`` of 0 means no lead-in, which is what upstream sends for THIS CUTPATH and
    for a start that is not inside a cut. A lead-in that cannot be calculated is not fatal:
    upstream warns and runs the cut without one, and so do we — the returned ``leadinApplied``
    says which happened.
    """
    if run_type not in (HERE_TO_END, THIS_CUTPATH):
        raise RunFromLineError(
            "invalid_run_type", f"run type must be {HERE_TO_END!r} or {THIS_CUTPATH!r}"
        )
    if not os.path.isfile(path):
        raise RunFromLineError("file_not_found", f"no such program: {path}")
    if start_line < 0:
        raise RunFromLineError("invalid_start_line", "the start line cannot be negative")

    helper = _helper()

    resolved_start = start_line
    last_line = 0
    if run_type == THIS_CUTPATH:
        resolved_start, last_line = cutpath_bounds(path, start_line)

    data = helper.run_from_line_get(path, resolved_start, last_line)
    if data.get("error"):
        raise _describe_refusal(data)

    os.makedirs(output_dir, exist_ok=True)
    output = os.path.join(output_dir, OUTPUT_NAME)
    leadin = {
        "cancel": False,
        "do": bool(leadin_length) and run_type == HERE_TO_END,
        "length": leadin_length,
        "angle": leadin_angle,
    }
    result = helper.run_from_line_set(output, data, leadin, units_per_mm)
    failed = bool(result.get("error")) if isinstance(result, dict) else False

    return {
        "path": output,
        "startLine": resolved_start,
        "lastLine": last_line,
        "runType": run_type,
        # False when a lead-in was asked for and could not be calculated: upstream runs the
        # cut anyway, without one, rather than refusing to start.
        "leadinApplied": bool(leadin["do"]) and not failed,
    }


def cut_lines(path: str) -> List[int]:
    """Line numbers that start a cut (``M03 $0``), for the UI's run-from-line picker."""
    lines: List[int] = []
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        for index, line in enumerate(handle):
            stripped = line.replace(" ", "").upper()
            if stripped.startswith("M03$0") or stripped.startswith("M3$0"):
                lines.append(index)
    return lines
