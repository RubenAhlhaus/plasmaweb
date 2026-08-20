"""Toolpath preview: LinuxCNC's own interpreter, collecting polylines instead of drawing.

The preview must agree with what the machine will actually do, so it is not a G-code parser of
ours — it is ``gcode.parse``, the same entry point AXIS and QtPlasmaC preview through
(``rs274/glcanon.py:1454``), given a canon that appends points to lists. Subroutines, named
parameters, G-code offsets, ``[RS274NGC]`` settings and QtPlasmaC's own filter output are
therefore all handled by the interpreter rather than reimplemented here.

Three details are load-bearing:

* the parameter file is **copied to a temporary directory** before parsing, because the
  interpreter writes parameters back and a preview must not touch the machine's ``VAR`` file
  (gremlin does the same — ``qt5_graphics.py:480``);
* ``use_move_batches`` is declared explicitly. ``gcode.parse`` probes the canon for it, and a
  catch-all ``__getattr__`` would answer with a callable and silently opt us into a protocol
  this canon does not implement (the trap upstream's own test canon documents,
  ``tests/interp_initcode/test-ui.py:13``);
* the unit and init codes come from ``preview_helpers``, so the preview starts in the machine's
  current modal state and units rather than in a guessed one.

Everything LinuxCNC-specific is imported inside the functions, so this module imports on macOS
and in CI, where the preview is simply unavailable.
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

#: Above this, a preview is not useful and the JSON would be the real cost. QtPlasmaC has its
#: own file-size limit for the same reason; ours counts points, which is what the browser pays.
MAX_POINTS = 400_000

RAPID = "rapid"
FEED = "feed"


class ToolpathError(RuntimeError):
    """A preview that could not be produced, with a machine-readable ``code``."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _segment_canon_class() -> type:
    """Build the canon class against the real ``rs274`` bases, on the machine only."""
    from rs274.interpret import ArcsToSegmentsMixin, Translated  # noqa: PLC0415

    class SegmentCanon(Translated, ArcsToSegmentsMixin):
        """Collects the interpreter's moves as polylines, grouped by kind and source line.

        One polyline per run of same-kind moves from the same G-code line: an arc arrives as
        64 straight segments from one line and collapses back into one polyline, while a
        rapid followed by a feed always breaks. That is the granularity the UI needs to
        colour rapids differently and to map a click back to a line number.
        """

        #: See the module docstring — must not be answered by ``__getattr__``.
        use_move_batches = False

        def __init__(self, parameter_file: str, max_points: int = MAX_POINTS) -> None:
            self.parameter_file = parameter_file
            self.max_points = max_points
            self.segments: List[Dict[str, Any]] = []
            self.truncated = False
            self.points = 0
            self.line = 0
            self._current: Optional[Dict[str, Any]] = None
            self._position: Tuple[float, float, float] = (0.0, 0.0, 0.0)
            # Tool table entries are only needed so change_tool/get_tool do not fail; a
            # preview of a plasma program never depends on tool geometry.
            self.tools: List[Any] = []

        # ---- the canon protocol ----------------------------------------------------

        def __getattr__(self, name: str):
            if name.startswith("_"):
                raise AttributeError(name)
            logger.debug("plasma: toolpath canon ignoring %s()", name)
            return lambda *args, **kwargs: None

        def next_line(self, state: Any) -> None:
            self.line = int(getattr(state, "sequence_number", self.line))

        def straight_traverse_translated(self, x, y, z, *rest) -> None:
            self._add(RAPID, x, y, z)

        def straight_feed_translated(self, x, y, z, *rest) -> None:
            self._add(FEED, x, y, z)

        def straight_probe_translated(self, x, y, z, *rest) -> None:
            self._add(FEED, x, y, z)

        def straight_arcsegments(self, segments) -> None:
            for segment in segments:
                self._add(FEED, segment[0], segment[1], segment[2])

        def rigid_tap(self, x, y, z, *rest) -> None:
            self._add(FEED, x, y, z)

        def set_origin_offsets(self, *args) -> None:
            # Translated handles g5x/g92; nothing to record.
            pass

        def get_external_length_units(self) -> float:
            return 1.0

        def get_external_angular_units(self) -> float:
            return 1.0

        def get_axis_mask(self) -> int:
            return 7  # XYZ; a plasma table has no rotary axes to preview

        def get_block_delete(self) -> bool:
            return False

        def get_tool(self, index: int):
            return (index, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0)

        def change_tool(self, pocket: int) -> None:
            pass

        # ---- collection ------------------------------------------------------------

        def _add(self, kind: str, x: Any, y: Any, z: Any) -> None:
            if self.truncated:
                return
            point = (float(x), float(y), float(z))
            current = self._current
            if current is None or current["kind"] != kind or current["line"] != self.line:
                # Start the new polyline where the last move ended, so a colour change does
                # not leave a gap in the drawing.
                start = self._position
                current = {"kind": kind, "line": self.line, "pts": [list(start)]}
                self.segments.append(current)
                self._current = current
                self.points += 1
            current["pts"].append(list(point))
            self._position = point
            self.points += 1
            if self.points >= self.max_points:
                self.truncated = True
                logger.warning(
                    "plasma: toolpath preview truncated at %d points", self.max_points
                )

        def extents(self) -> Optional[Dict[str, List[float]]]:
            lows = [float("inf")] * 3
            highs = [float("-inf")] * 3
            for segment in self.segments:
                for point in segment["pts"]:
                    for axis in range(3):
                        lows[axis] = min(lows[axis], point[axis])
                        highs[axis] = max(highs[axis], point[axis])
            if lows[0] == float("inf"):
                return None
            return {"min": lows, "max": highs}

    return SegmentCanon


def _init_codes(ini_path: Optional[str]) -> Tuple[str, str]:
    """``(unitcode, initcode)`` for the machine's current modal state, or a neutral default."""
    try:
        import linuxcnc  # noqa: PLC0415
        import preview_helpers  # noqa: PLC0415

        stat = linuxcnc.stat()
        stat.poll()
        inifile = linuxcnc.ini(ini_path) if ini_path else None
        if inifile is not None:
            return preview_helpers.create_unitcode_and_initcode(stat, inifile)
    except Exception:
        logger.debug("plasma: falling back to a neutral preview init state", exc_info=True)
    return "G21", "G53 G0 X0 Y0 Z0"


def _parameter_copy(ini_path: Optional[str], directory: str) -> str:
    """A throwaway copy of the machine's parameter file: the interpreter writes to it."""
    source = None
    if ini_path:
        from backend.plasma.machine_files import ini_value  # noqa: PLC0415

        raw = ini_value(ini_path, "RS274NGC", "PARAMETER_FILE") or "linuxcnc.var"
        candidate = raw if os.path.isabs(raw) else os.path.join(os.path.dirname(ini_path), raw)
        if os.path.isfile(candidate):
            source = candidate

    target = os.path.join(directory, "preview.var")
    if source:
        shutil.copy(source, target)
    else:
        open(target, "a", encoding="utf-8").close()
    return target


def parse_toolpath(
    path: str,
    ini_path: Optional[str] = None,
    max_points: int = MAX_POINTS,
) -> Dict[str, Any]:
    """Interpret ``path`` and return its polylines, extents and a truncation flag.

    Raises :class:`ToolpathError` when there is no interpreter to run (off the machine) or when
    the interpreter reports a G-code error, in which case the message is the interpreter's own —
    the same text the machine would refuse the program with.
    """
    if not os.path.isfile(path):
        raise ToolpathError("file_not_found", f"no such program: {path}")

    try:
        import gcode  # noqa: PLC0415
    except ImportError:
        raise ToolpathError(
            "interpreter_unavailable",
            "the LinuxCNC gcode module is not available in this process",
        ) from None

    canon_class = _segment_canon_class()
    unitcode, initcode = _init_codes(ini_path)

    directory = tempfile.mkdtemp(prefix="lcncgui-preview-")
    try:
        canon = canon_class(_parameter_copy(ini_path, directory), max_points)
        result, sequence = gcode.parse(path, canon, unitcode, initcode)
        if result > gcode.MIN_ERROR:
            message = gcode.strerror(result)
            raise ToolpathError(
                "gcode_error", f"{os.path.basename(path)}:{sequence}: {message}"
            )
        return {
            "path": path,
            "segments": canon.segments,
            "extents": canon.extents(),
            "points": canon.points,
            "truncated": canon.truncated,
            "units": "mm" if unitcode == "G21" else "inch",
        }
    finally:
        shutil.rmtree(directory, ignore_errors=True)
