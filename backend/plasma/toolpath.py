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
  current modal state and units rather than in a guessed one;
* the interpreter's canonical length unit is the **inch**, whatever the program says. AXIS
  divides machine values by ``linear_units * 25.4`` to get there (``glcanon.py:1086``); we
  multiply the other way, so the payload is in the machine's own units and the browser never
  has to know about this.

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

        #: ``gcode.arc_to_segments`` reads ``lo``, ``plane``, ``rotation_cos``,
        #: ``rotation_sin`` and the nine g5x/g92 offsets straight off the canon
        #: (``gcodemodule.cc:1457``). They must be real numbers: the catch-all
        #: ``__getattr__`` below would hand the C code a function instead, which is a failed
        #: parse of any program containing an arc. ``plane`` and the offsets come from the
        #: rs274 bases; the rotation is the identity until a program rotates the XY plane.
        plane = 1
        rotation_cos = 1.0
        rotation_sin = 0.0

        def __init__(
            self,
            parameter_file: str,
            max_points: int = MAX_POINTS,
            scale: float = 1.0,
        ) -> None:
            self.parameter_file = parameter_file
            #: Internal-inches → machine units. Applied to the points we keep and *not* to
            #: ``lo``, which the arc converter reads back in internal units.
            self.scale = scale
            #: Last position, all nine axes, the way GLCanon keeps it: the arc converter
            #: starts each arc from here.
            self.lo = (0.0,) * 9
            self.first_move = True
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

        def straight_traverse_translated(self, *args) -> None:
            self._move(RAPID, args)

        def straight_feed_translated(self, *args) -> None:
            self._move(FEED, args)

        def straight_probe_translated(self, *args) -> None:
            self._move(FEED, args)

        def straight_arcsegments(self, segments) -> None:
            for segment in segments:
                self._move(FEED, segment)

        def rigid_tap(self, x, y, z, *rest) -> None:
            self._move(FEED, (x, y, z))

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

        def _move(self, kind: str, position: Any) -> None:
            """Record a move and remember where it left the tool.

            ``lo`` has to keep all nine axes because the arc converter reads it as nine
            doubles; the preview itself only ever draws the first three.
            """
            values = [float(value) for value in position[:9]]
            values += [0.0] * (9 - len(values))
            self.lo = tuple(values)
            self.first_move = False
            self._add(kind, values[0], values[1], values[2])

        def _add(self, kind: str, x: Any, y: Any, z: Any) -> None:
            if self.truncated:
                return
            point = (float(x) * self.scale, float(y) * self.scale, float(z) * self.scale)
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


def _machine_scale(ini_path: Optional[str]) -> Tuple[float, str]:
    """``(internal inches → machine units, unit name)`` for this machine.

    ``linear_units * 25.4`` is the factor AXIS uses (1 mm/unit → 25.4, inches → 1.0); the INI's
    ``[TRAJ] LINEAR_UNITS`` is the fallback for a process with no ``linuxcnc`` module.
    """
    linear_units: Optional[float] = None
    try:
        import linuxcnc  # noqa: PLC0415

        stat = linuxcnc.stat()
        stat.poll()
        value = float(getattr(stat, "linear_units", 0) or 0)
        if value:
            linear_units = value
    except Exception:
        logger.debug("plasma: no linuxcnc.stat for the preview unit scale", exc_info=True)

    if linear_units is None and ini_path:
        from backend.plasma.machine_files import INCH_UNITS_PER_MM, ini_value  # noqa: PLC0415

        raw = (ini_value(ini_path, "TRAJ", "LINEAR_UNITS") or "mm").strip().lower()
        linear_units = INCH_UNITS_PER_MM if raw in ("inch", "in", "imperial") else 1.0

    if linear_units is None:
        linear_units = 1.0
    scale = linear_units * 25.4
    # An imperial machine's linear_units is the rounded 0.03937, so the factor comes out at
    # 0.999998 rather than 1. Snapping avoids a preview whose coordinates drift from the
    # program's own numbers in the last decimal.
    if abs(scale - 1.0) < 1e-3:
        return 1.0, "inch"
    return scale, "mm"


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
    previous_ini = os.environ.get("INI_FILE_NAME")
    try:
        # The interpreter reads [RS274NGC] FEATURES from the INI named in the environment, and
        # that bitmask is what decides whether `#<_hal[plasmac.cut-feed-rate]>` resolves at
        # all — every QtPlasmaC program has that line, so without it a preview is one error.
        if ini_path:
            os.environ["INI_FILE_NAME"] = ini_path
        scale, units = _machine_scale(ini_path)
        canon = canon_class(_parameter_copy(ini_path, directory), max_points, scale)
        try:
            result, sequence = gcode.parse(path, canon, unitcode, initcode)
        except RuntimeError as exc:
            # gcodemodule raises this when a canon callback failed or the interpreter gave
            # up mid-file; there is no error code to translate, only the message.
            raise ToolpathError(
                "interpreter_failed", f"{os.path.basename(path)}: {exc}"
            ) from exc
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
            "units": units,
        }
    finally:
        if previous_ini is None:
            os.environ.pop("INI_FILE_NAME", None)
        else:
            os.environ["INI_FILE_NAME"] = previous_ini
        shutil.rmtree(directory, ignore_errors=True)
