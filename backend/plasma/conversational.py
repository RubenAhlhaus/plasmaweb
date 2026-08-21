"""Conversational shapes: LinuxCNC's own ``plasmac`` shape modules, driven from JSON.

``lib/python/plasmac/{circle,rectangle,…}.py`` already generate QtPlasmaC's G-code — leadins,
kerf compensation, small-hole feed reduction, overcut, the ``M190`` material change, the
``M67``/``M68`` feed overrides. They are pure Python with one entry point each::

    preview(Conv, fTmp, fNgc, fNgcBkp, matNumber, matName, preAmble, postAmble, …)

so this module supplies the four file-and-callback arguments and passes the rest through by
name. **The signature is the schema**: a shape's parameters are read off the function with
``inspect``, which means a LinuxCNC that gained or lost one says so instead of silently
producing a different cut.

``Conv`` is the caller — upstream passes its own conversational module, and the shapes only ever
use it for two validators, which :class:`ConvShim` provides.

The temp-file protocol is upstream's: ``fNgcBkp`` holds the job so far, ``fTmp`` is the shape on
its own, and ``fNgc`` is the result — job with the new shape spliced in before the postamble.
That is why adding a second shape to a job is just another call with the previous output as the
job text.
"""

from __future__ import annotations

import builtins
import importlib
import inspect
import logging
import os
import sys
import tempfile
import threading
from typing import Any, Dict, List, Mapping, Optional, Tuple

logger = logging.getLogger(__name__)

#: The shapes whose modules expose ``preview()``. ``line`` is a multi-segment builder with a
#: different API and ``block`` operates on an existing job; both are their own feature.
SHAPES: Tuple[str, ...] = (
    "circle",
    "ellipse",
    "triangle",
    "rectangle",
    "polygon",
    "bolt_circle",
    "slot",
    "star",
    "gusset",
    "sector",
)

#: Arguments this module supplies rather than the caller.
_SUPPLIED = ("Conv", "fTmp", "fNgc", "fNgcBkp")

#: What an empty job looks like to the shape modules; they splice before the ``M2``.
NEW_JOB = "(new conversational file)\nM2\n"

#: QtPlasmaC's default pre/postamble (``conversational.py:86``), per unit system.
_AMBLES = {
    "mm": "G21\nG64P0.25\nG40\nG49\nM52P1\nG80\nG90\nG92.1\nG94\nG97",
    "inch": "G20\nG64P0.004\nG40\nG49\nM52P1\nG80\nG90\nG92.1\nG94\nG97",
}


class ConversationalError(RuntimeError):
    """A shape that cannot be generated, with a machine-readable ``code``."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class ConvShim:
    """The two validators the shape modules call on their caller.

    Copied semantics, not copied text: ``(True, value)`` when it parses, and otherwise
    ``(False, -1)`` for a non-empty entry and ``(False, 0)`` for an empty one — the shapes rely
    on that difference to tell "you typed nonsense" from "you left it blank"
    (``conversational.py:531``).
    """

    @staticmethod
    def conv_is_float(entry: Any) -> Tuple[bool, Any]:
        try:
            return True, float(entry)
        except (TypeError, ValueError):
            return False, -1 if entry else 0

    @staticmethod
    def conv_is_int(entry: Any) -> Tuple[bool, Any]:
        try:
            return True, int(entry)
        except (TypeError, ValueError):
            return False, -1 if entry else 0


def default_ambles(units: str = "mm") -> str:
    return _AMBLES["inch" if units == "inch" else "mm"]


def _shape_module(shape: str) -> Any:
    """Import one shape module, working around its import-time ``gettext`` scan.

    Every shape module runs ``gettext.install`` at import, deriving the locale directory by
    scanning ``sys.path`` for an entry containing ``/lib/python``. On a LinuxCNC install one
    exists; anywhere else the module raises ``NameError`` before it ever defines ``preview``.
    A throwaway path entry is enough, and ``_`` is pre-installed in case the install itself
    fails — the shapes call ``_()`` for their error messages.
    """
    if shape not in SHAPES:
        raise ConversationalError(
            "unknown_shape", f"{shape!r} is not one of {', '.join(SHAPES)}"
        )

    if not hasattr(builtins, "_"):
        builtins._ = lambda text: text  # type: ignore[attr-defined]

    padded = not any("/lib/python" in entry for entry in sys.path)
    if padded:
        sys.path.append(os.path.join(tempfile.gettempdir(), "lib", "python"))
    try:
        return importlib.import_module(f"plasmac.{shape}")
    except ImportError as exc:
        try:
            importlib.import_module("plasmac")
        except ImportError:
            raise ConversationalError(
                "shapes_unavailable",
                "LinuxCNC's plasmac shape modules are not available in this process",
            ) from None
        # The package is there and this one shape is not: `ellipse` needs numpy, for example.
        # Reported per shape so the rest of them stay usable.
        raise ConversationalError(
            "shape_unavailable", f"this LinuxCNC cannot generate a {shape}: {exc}"
        ) from exc
    finally:
        if padded:
            sys.path.pop()


def shape_parameters(shape: str) -> Tuple[Dict[str, Any], ...]:
    """The parameters one shape takes, in call order, with their defaults where they have one.

    Read off ``preview()`` itself, so this is the contract with the installed LinuxCNC rather
    than a copy of it that can drift.
    """
    module = _shape_module(shape)
    preview = getattr(module, "preview", None)
    if preview is None:
        raise ConversationalError(
            "shape_unsupported", f"this LinuxCNC's {shape} module has no preview()"
        )

    parameters = []
    for name, parameter in inspect.signature(preview).parameters.items():
        if name in _SUPPLIED:
            continue
        parameters.append(
            {
                "name": name,
                "required": parameter.default is inspect.Parameter.empty,
                "default": None
                if parameter.default is inspect.Parameter.empty
                else parameter.default,
            }
        )
    return tuple(parameters)


def shapes() -> Dict[str, Any]:
    """Every shape this LinuxCNC can generate, and what each one needs."""
    available: Dict[str, Any] = {}
    for shape in SHAPES:
        try:
            available[shape] = list(shape_parameters(shape))
        except ConversationalError as exc:
            logger.info("plasma: conversational %s unavailable: %s", shape, exc.message)
    return available


def generate(
    shape: str,
    params: Mapping[str, Any],
    job: Optional[str] = None,
    material: Tuple[int, str] = (0, "Default"),
    preamble: Optional[str] = None,
    postamble: Optional[str] = None,
    units: str = "mm",
    defaults: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Generate ``shape`` and return the whole job's G-code.

    ``defaults`` are machine-supplied values (kerf width from the material, leadin from the
    prefs); unlike ``params`` they are filtered to what the shape actually takes, because the
    machine has no way of knowing which shape is being asked for and a rectangle has no
    small-hole diameter.

    ``job`` is the program the shape is added to; ``None`` starts a new one. The returned
    ``gcode`` is the complete program, which is also what to pass back as ``job`` to add the
    next shape — that is how upstream builds a multi-shape job.

    A shape's own validation failure comes back as ``error`` rather than an exception: it is a
    message for the operator ("DIAMETER cannot be zero"), not a fault.
    """
    module = _shape_module(shape)
    preview = getattr(module, "preview", None)
    if preview is None:
        raise ConversationalError(
            "shape_unsupported", f"this LinuxCNC's {shape} module has no preview()"
        )

    expected = {entry["name"]: entry for entry in shape_parameters(shape)}
    unknown = [name for name in params if name not in expected]
    if unknown:
        raise ConversationalError(
            "unknown_parameters",
            f"{shape} does not take {', '.join(sorted(unknown))}; "
            f"expected {', '.join(expected)}",
        )

    amble = default_ambles(units)
    values: Dict[str, Any] = {
        "matNumber": material[0],
        "matName": material[1],
        "preAmble": preamble if preamble is not None else amble,
        "postAmble": postamble if postamble is not None else amble,
    }
    values.update(
        {name: value for name, value in (defaults or {}).items() if name in expected}
    )
    values.update(params)

    missing = [
        name
        for name, entry in expected.items()
        if entry["required"] and name not in values
    ]
    if missing:
        raise ConversationalError(
            "missing_parameters", f"{shape} needs {', '.join(missing)}"
        )

    call = {name: values[name] for name in expected if name in values}

    directory = tempfile.mkdtemp(prefix="lcncgui-conv-")
    try:
        paths = {name: os.path.join(directory, f"{name}.ngc") for name in ("tmp", "ngc", "bkp")}
        with open(paths["bkp"], "w", encoding="utf-8") as handle:
            handle.write(job if job else NEW_JOB)
        open(paths["tmp"], "w", encoding="utf-8").close()

        error = preview(ConvShim(), paths["tmp"], paths["ngc"], paths["bkp"], **call)
        if error:
            # The shapes return their message; `False` means it worked.
            return {"gcode": None, "error": str(error).strip()}

        with open(paths["ngc"], "r", encoding="utf-8", errors="replace") as handle:
            gcode = handle.read()
        with open(paths["tmp"], "r", encoding="utf-8", errors="replace") as handle:
            shape_only = handle.read()
        return {"gcode": gcode, "shape": shape_only, "error": None}
    finally:
        for name in ("tmp", "ngc", "bkp"):
            try:
                os.unlink(os.path.join(directory, f"{name}.ngc"))
            except OSError:
                pass
        try:
            os.rmdir(directory)
        except OSError:
            pass


#: The line module's segment builders, keyed by the name a client uses. Each value is the
#: upstream function and the parameters it takes beyond the running start point, which the
#: builder threads through rather than making a client repeat.
LINE_SEGMENTS: Dict[str, Tuple[str, Tuple[str, ...]]] = {
    "point": ("do_line_point_to_point", ("xEnd", "yEnd")),
    "angle": ("do_line_by_angle", ("length", "angle")),
    "arc3": ("do_arc_3_points", ("xNext", "yNext", "xEnd", "yEnd")),
    "arcRadius": ("do_arc_2_points_radius", ("xEnd", "yEnd", "radius", "arcType")),
    "arcAngleRadius": ("do_arc_by_angle_radius", ("length", "angle", "radius", "arcType")),
}


def line_segment_kinds() -> Dict[str, Any]:
    """The segment kinds this LinuxCNC's line module supports, and what each one needs."""
    module = _shape_module_named("line")
    kinds: Dict[str, Any] = {}
    for kind, (function, parameters) in LINE_SEGMENTS.items():
        if hasattr(module, function):
            kinds[kind] = list(parameters)
    return kinds


def _shape_module_named(name: str) -> Any:
    """``_shape_module`` for the modules that are not in :data:`SHAPES` (``line``, ``block``)."""
    global SHAPES
    original = SHAPES
    SHAPES = SHAPES + (name,)
    try:
        return _shape_module(name)
    finally:
        SHAPES = original


def generate_line(
    segments: Any,
    start: Tuple[float, float] = (0.0, 0.0),
    job: Optional[str] = None,
    material: Tuple[int, str] = (0, "Default"),
    preamble: Optional[str] = None,
    postamble: Optional[str] = None,
    units: str = "mm",
) -> Dict[str, Any]:
    """Build one multi-segment cut — lines and arcs — from a list of segments.

    Upstream's line tab is a state machine driven a button at a time: ``first_segment`` opens the
    cut, each segment is computed from where the last one ended, and ``last_segment`` closes the
    file so the job on disk is always runnable after every press. Here the whole list is known
    up front, so the segments' G-code — upstream's own strings, computed by upstream's own
    builders — is closed once. ``next_segment`` is deliberately not used: it reopens a file by
    truncating it at the first ``M05 $0``, which on a job that already contains a shape would
    throw that shape's cut away.

    Returns the job plus the point the cut ended at, so a client can carry on from there.
    """
    module = _shape_module_named("line")
    if not hasattr(module, "first_segment"):
        raise ConversationalError(
            "shape_unsupported", "this LinuxCNC's line module has no segment builder"
        )
    if not segments:
        raise ConversationalError("no_segments", "a line needs at least one segment")

    amble = default_ambles(units)
    pre = preamble if preamble is not None else amble
    post = postamble if postamble is not None else amble
    shim = ConvShim()

    directory = tempfile.mkdtemp(prefix="lcncgui-conv-")
    paths = {name: os.path.join(directory, f"{name}.ngc") for name in ("tmp", "ngc", "bkp")}
    try:
        with open(paths["bkp"], "w", encoding="utf-8") as handle:
            handle.write(job if job else NEW_JOB)
        # 2.9.4's first_segment takes an extra `lineType` that its body ignores (upstream
        # passes the GUI's line-type combo text); 2.10's does not. Called by keyword so the
        # difference is a missing key rather than a shifted argument list.
        opening = {
            "fTmp": paths["tmp"],
            "fNgc": paths["ngc"],
            "fNgcBkp": paths["bkp"],
            "preAmble": pre,
            "xStart": float(start[0]),
            "yStart": float(start[1]),
            "matNumber": material[0],
            "matName": material[1],
        }
        if "lineType" in inspect.signature(module.first_segment).parameters:
            first_kind = str(segments[0].get("kind", "point"))
            opening["lineType"] = "arc" if first_kind.startswith("arc") else "line"
        module.first_segment(**opening)

        x, y = float(start[0]), float(start[1])
        codes: List[str] = []
        for index, segment in enumerate(segments):
            kind = segment.get("kind")
            if kind not in LINE_SEGMENTS:
                raise ConversationalError(
                    "unknown_segment",
                    f"segment {index + 1}: {kind!r} is not one of {', '.join(LINE_SEGMENTS)}",
                )
            function, names = LINE_SEGMENTS[kind]
            builder = getattr(module, function, None)
            if builder is None:
                raise ConversationalError(
                    "segment_unsupported", f"this LinuxCNC's line module cannot do a {kind}"
                )
            missing = [name for name in names if name not in segment]
            if missing:
                raise ConversationalError(
                    "missing_parameters",
                    f"segment {index + 1} ({kind}) needs {', '.join(missing)}",
                )

            result = builder(shim, x, y, *(segment[name] for name in names))
            if result[0]:
                # The builder's own complaint, with the segment it belongs to.
                return {
                    "gcode": None,
                    "error": f"segment {index + 1}: {str(result[1]).strip()}",
                }
            _failed, x, y, code = result
            codes.append(code)

        module.last_segment(paths["tmp"], paths["ngc"], "".join(codes), post)

        with open(paths["ngc"], "r", encoding="utf-8", errors="replace") as handle:
            gcode = handle.read()
        return {"gcode": gcode, "error": None, "end": [x, y]}
    finally:
        for path in paths.values():
            try:
                os.unlink(path)
            except OSError:
                pass
        try:
            os.rmdir(directory)
        except OSError:
            pass


#: ``block.get_midpoints`` is replaced for the duration of a call, so one lock guards it.
_BLOCK_LOCK = threading.Lock()


def _g5x_index() -> int:
    """Which coordinate system is active (1–9); 1 (G54) when there is no machine to ask."""
    try:
        import linuxcnc  # noqa: PLC0415

        stat = linuxcnc.stat()
        stat.poll()
        return int(getattr(stat, "g5x_index", 1) or 1)
    except Exception:
        return 1


#: Arguments to ``block.preview`` that this layer supplies rather than a client.
#:
#: The two LinuxCNC generations differ here more than anywhere else: 2.9.4 takes ``fTmp``,
#: ``convBlock``, ``g5xIndex`` and ``convUnits`` and does its own mirror/flip bookkeeping with
#: ``convMirror``/``convFlip``; 2.10 takes ``window`` and ``isConvBlock`` and a plain
#: ``doMirror``/``doFlip``. Reading the signature rather than assuming one of them is what keeps
#: both working.
_BLOCK_SUPPLIED = (
    "Conv",
    "fNgc",
    "fTmp",
    "window",
    "isConvBlock",
    "convBlock",
    "g5xIndex",
    "convUnits",
)


def block_parameters() -> Tuple[str, ...]:
    """The array/rotate/scale parameters this LinuxCNC's block module takes."""
    module = _shape_module_named("block")
    return tuple(
        name
        for name in inspect.signature(module.preview).parameters
        if name not in _BLOCK_SUPPLIED
    )


def generate_block(
    job: str,
    params: Mapping[str, Any],
    midpoint: Tuple[float, float],
) -> Dict[str, Any]:
    """Array, rotate, scale, mirror or flip an existing job — upstream's ``block`` module.

    One thing has to be supplied differently. ``block.preview`` finds the shape's centre with
    ``get_midpoints(window)``, which measures a qtvcp preview *widget* through
    ``GlCanonDraw.extents_info``; there is no widget here. The centre is a measurement, not a
    decision, so it is measured from the toolpath preview instead and handed to upstream by
    replacing that one function for the duration of the call — everything else, including the
    validation and the whole block format, stays upstream's.

    ``job`` is the program to operate on and comes back transformed.
    """
    module = _shape_module_named("block")
    expected = set(block_parameters())
    unknown = [name for name in params if name not in expected]
    if unknown:
        raise ConversationalError(
            "unknown_parameters",
            f"block does not take {', '.join(sorted(unknown))}; expected {', '.join(sorted(expected))}",
        )
    missing = [name for name in expected if name not in params]
    if missing:
        raise ConversationalError(
            "missing_parameters", f"block needs {', '.join(sorted(missing))}"
        )

    directory = tempfile.mkdtemp(prefix="lcncgui-block-")
    path = os.path.join(directory, "block.ngc")
    scratch = os.path.join(directory, "block-tmp.ngc")
    try:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(job)
        open(scratch, "w", encoding="utf-8").close()
        # A job this layer has already arrayed carries upstream's own marker.
        is_conv_block = job.lstrip().startswith(";conversational block V2") or job.lstrip().startswith(
            ";CONV_BLOCK"
        )

        signature = inspect.signature(module.preview).parameters
        call: Dict[str, Any] = {name: params[name] for name in expected}
        call["Conv"] = ConvShim()
        call["fNgc"] = path
        if "fTmp" in signature:
            call["fTmp"] = scratch
        if "window" in signature:
            call["window"] = None
        if "isConvBlock" in signature:
            call["isConvBlock"] = is_conv_block
        if "convBlock" in signature:
            # 2.9.4 passes a two-element list; [0] is "this file is already a block".
            call["convBlock"] = [is_conv_block, False]
        if "g5xIndex" in signature:
            call["g5xIndex"] = _g5x_index()
        if "convUnits" in signature:
            # [factor, unit code] — no conversion, because the job we hand over is already in
            # the machine's units.
            call["convUnits"] = [1, None]

        with _BLOCK_LOCK:
            original = getattr(module, "get_midpoints", None)
            if original is not None:
                module.get_midpoints = lambda _window: (
                    float(midpoint[0]),
                    float(midpoint[1]),
                )
            try:
                error = module.preview(**call)
            finally:
                if original is not None:
                    module.get_midpoints = original

        if error:
            return {"gcode": None, "error": str(error).strip()}
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            return {"gcode": handle.read(), "error": None}
    finally:
        for temporary in (path, scratch):
            try:
                os.unlink(temporary)
            except OSError:
                pass
        try:
            os.rmdir(directory)
        except OSError:
            pass
