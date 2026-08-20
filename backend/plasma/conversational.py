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
from typing import Any, Dict, Mapping, Optional, Tuple

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
) -> Dict[str, Any]:
    """Generate ``shape`` and return the whole job's G-code.

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
