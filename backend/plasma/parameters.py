"""``[PLASMA_PARAMETERS]`` in ``<machine>.prefs``: the cut settings, and the pins they feed.

QtPlasmaC keeps these in its prefs file, loads them into spinboxes, and lets HAL carry them
to plasmac: every parameter widget owns a ``qtplasmac.<widget>-f`` pin netted straight to a
``plasmac.*`` setpoint (``qtplasmac_handler.py:936``). We have no widgets, so we skip the
middle and write the ``plasmac.*`` setpoint ourselves — which is also why we deliberately do
not recreate those widget nets: an unlinked setpoint is one the backend can still write.

Getting these onto the pins is not cosmetic. Zero is a legal float but a nonsense parameter:
``Arc Maximum Starts`` at 0 makes plasmac pause the program with "no arc detected after 0
start attempts" the instant the torch fires, and ``Pid P Gain`` at 0 leaves the THC computing
no correction at all, so the torch height never moves.

Defaults and key names come from ``load_plasma_parameters()``
(``qtplasmac_handler.py:2803``); the unit-scaled ones use QtPlasmaC's own rounding so a file
we create matches the one QtPlasmaC would have created.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, Mapping, NamedTuple, Optional, Tuple

from backend.plasma.machine_files import MachineFiles, read_config, write_config

logger = logging.getLogger(__name__)

SECTION = "PLASMA_PARAMETERS"


class PlasmaParameter(NamedTuple):
    """One prefs key: its type, its default, and the ``plasmac.*`` setpoint it drives."""

    key: str
    #: ``float`` or ``int`` — ``int`` keys are written to the file without a decimal point,
    #: the way ``putpref(..., int, ...)`` does.
    kind: type
    #: ``units_per_mm`` → default value. Scaled defaults are rounded as QtPlasmaC rounds them.
    default: Callable[[float], Any]
    #: The ``plasmac.*`` pin this parameter feeds, or ``None`` when it is GUI-only.
    pin: Optional[str]


def _fixed(value: Any) -> Callable[[float], Any]:
    return lambda _units_per_mm: value


def _scaled(value: float, digits: int) -> Callable[[float], Any]:
    return lambda units_per_mm: round(value * units_per_mm, digits)


#: Every key QtPlasmaC reads from ``[PLASMA_PARAMETERS]``, in its own load order.
#:
#: ``X Pierce Offset`` and ``Y Pierce Offset`` have no pin: QtPlasmaC uses them for the pierce
#: bounds check in the GUI (``qtplasmac_handler.py:2700``), not through HAL.
#:
#: ``Setup Feed Rate`` and ``Offset Feed Rate`` default to 80% of a rate derived from the INI,
#: so their defaults are filled in by :func:`default_parameters` rather than from this table.
PLASMA_PARAMETERS: Tuple[PlasmaParameter, ...] = (
    PlasmaParameter("Arc Fail Timeout", float, _fixed(3.0), "arc-fail-delay"),
    PlasmaParameter("Arc OK High", float, _fixed(250.0), "arc-ok-high"),
    PlasmaParameter("Arc OK Low", float, _fixed(60.0), "arc-ok-low"),
    PlasmaParameter("Arc Maximum Starts", int, _fixed(3), "arc-max-starts"),
    PlasmaParameter("Arc Voltage Offset", float, _fixed(0.0), "arc-voltage-offset"),
    PlasmaParameter("Arc Voltage Scale", float, _fixed(1.0), "arc-voltage-scale"),
    PlasmaParameter("Velocity Anti Dive Threshold", float, _fixed(90.0), "cornerlock-threshold"),
    PlasmaParameter("Float Switch Travel", float, _scaled(1.5, 2), "float-switch-travel"),
    PlasmaParameter("Height Per Volt", float, _scaled(0.1, 3), "height-per-volt"),
    PlasmaParameter("Offset Feed Rate", float, _fixed(0.0), "offset-feed-rate"),
    PlasmaParameter("Ohmic Maximum Attempts", int, _fixed(0), "ohmic-max-attempts"),
    PlasmaParameter("Ohmic Probe Offset", float, _fixed(0.0), "ohmic-probe-offset"),
    PlasmaParameter("Pid P Gain", float, _fixed(10.0), "pid-p-gain"),
    PlasmaParameter("Pid D Gain", float, _fixed(0.0), "pid-d-gain"),
    PlasmaParameter("Pid I Gain", float, _fixed(0.0), "pid-i-gain"),
    PlasmaParameter("Probe Feed Rate", float, _scaled(300.0, 0), "probe-feed-rate"),
    PlasmaParameter("Probe Start Height", float, _scaled(25.0, 0), "probe-start-height"),
    PlasmaParameter("Slat Height", float, _fixed(0.0), "slat-height"),
    PlasmaParameter("Arc Restart Delay", float, _fixed(1.0), "restart-delay"),
    PlasmaParameter("Safe Height", float, _scaled(25.0, 0), "safe-height"),
    PlasmaParameter("Setup Feed Rate", float, _fixed(0.0), "setup-feed-rate"),
    PlasmaParameter("Scribe Arming Delay", float, _fixed(0.0), "scribe-arm-delay"),
    PlasmaParameter("Scribe On Delay", float, _fixed(0.0), "scribe-on-delay"),
    PlasmaParameter("Skip IHS Distance", float, _fixed(0.0), "skip-ihs-distance"),
    PlasmaParameter("Spotting Threshold", float, _fixed(1.0), "spotting-threshold"),
    PlasmaParameter("Spotting Time", float, _fixed(0.0), "spotting-time"),
    PlasmaParameter("THC Delay", float, _fixed(0.5), "thc-delay"),
    PlasmaParameter("THC Sample Counts", int, _fixed(50), "thc-sample-counts"),
    PlasmaParameter("THC Sample Threshold", float, _fixed(1.0), "thc-sample-threshold"),
    PlasmaParameter("THC Threshold", float, _fixed(1.0), "thc-threshold"),
    PlasmaParameter("Void Sense Slope", int, _fixed(500), "voidlock-slope"),
    PlasmaParameter("X Pierce Offset", float, _scaled(1.6, 2), None),
    PlasmaParameter("Y Pierce Offset", float, _fixed(0.0), None),
)

_BY_KEY: Dict[str, PlasmaParameter] = {p.key: p for p in PLASMA_PARAMETERS}


def parameter(key: str) -> PlasmaParameter:
    return _BY_KEY[key]


def default_parameters(files: MachineFiles) -> Dict[str, Any]:
    """The values QtPlasmaC would put in a prefs file it had to create from scratch.

    The two feed rates are the awkward ones: QtPlasmaC derives them from the INI's axis
    velocities and then takes 80%, which is why they are not plain constants.

    ``Setup Feed Rate`` is 80% of ``thcFeedRate``
    (``[AXIS_Z] MAX_VELOCITY * OFFSET_AV_RATIO * 60``), and ``Offset Feed Rate`` 80% of
    ``offsetFeedRate`` (the slowest of X/Y ``MAX_VELOCITY * 30`` and ``[TRAJ]
    MAX_LINEAR_VELOCITY``) — ``qtplasmac_handler.py:276``.
    """
    from backend.plasma.machine_files import ini_real  # noqa: PLC0415 — avoids a cycle

    values: Dict[str, Any] = {}
    for param in PLASMA_PARAMETERS:
        values[param.key] = param.default(files.units_per_mm)

    z_velocity = ini_real(files.ini_path, "AXIS_Z", "MAX_VELOCITY")
    z_ratio = ini_real(files.ini_path, "AXIS_Z", "OFFSET_AV_RATIO")
    if z_velocity is not None and z_ratio is not None:
        values["Setup Feed Rate"] = z_velocity * z_ratio * 60.0 * 0.8

    candidates = [
        rate * 30.0
        for rate in (
            ini_real(files.ini_path, "AXIS_X", "MAX_VELOCITY"),
            ini_real(files.ini_path, "AXIS_Y", "MAX_VELOCITY"),
        )
        if rate is not None
    ]
    traj = ini_real(files.ini_path, "TRAJ", "MAX_LINEAR_VELOCITY")
    candidates.append(traj if traj is not None else 100000.0)
    if candidates:
        values["Offset Feed Rate"] = min(candidates) * 0.8

    return values


def read_parameters(path: str, defaults: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """Every parameter from the prefs file, falling back to ``defaults`` key by key.

    A key with a value the file cannot express as a number falls back too, with a warning:
    QtPlasmaC's own reader does the same (its ``getpref`` swallows the error and rewrites the
    default), and refusing to start over one bad line would be worse.
    """
    parser = read_config(path)
    values: Dict[str, Any] = {}
    for param in PLASMA_PARAMETERS:
        fallback = (defaults or {}).get(param.key, param.default(1.0))
        if not parser.has_option(SECTION, param.key):
            values[param.key] = fallback
            continue
        raw = parser.get(SECTION, param.key)
        try:
            values[param.key] = param.kind(float(raw))
        except (TypeError, ValueError):
            logger.warning(
                "plasma: %s: [%s] %s is not a number (%r); using %s",
                path,
                SECTION,
                param.key,
                raw,
                fallback,
            )
            values[param.key] = fallback
    return values


def write_parameters(path: str, values: Mapping[str, Any]) -> None:
    """Store parameters into the prefs file, leaving every other section untouched.

    Only known keys are written, and each one in the type QtPlasmaC stores it as, so the file
    keeps reading correctly there — an ``Arc Maximum Starts`` of ``3.0`` would come back from
    its ``getint`` as an error and be silently reset to the default.
    """
    parser = read_config(path)
    if not parser.has_section(SECTION):
        parser.add_section(SECTION)
    for key, value in values.items():
        param = _BY_KEY.get(key)
        if param is None:
            logger.warning("plasma: refusing to write unknown parameter %r", key)
            continue
        parser.set(SECTION, key, str(param.kind(float(value))))
    write_config(path, parser)


def parameter_pin_values(values: Mapping[str, Any]) -> Dict[str, Any]:
    """``{plasmac pin: value}`` for the parameters that drive one, ready for the bridge."""
    pins: Dict[str, Any] = {}
    for key, value in values.items():
        param = _BY_KEY.get(key)
        if param is None or param.pin is None:
            continue
        pins[param.pin] = param.kind(float(value))
    return pins


ENABLE_SECTION = "ENABLE_OPTIONS"


class PlasmaEnable(NamedTuple):
    """One ``[ENABLE_OPTIONS]`` toggle: its prefs key, its pin, and its default."""

    key: str
    pin: str
    default: bool


#: The toggles QtPlasmaC remembers between runs (``qtplasmac_handler.py:1097``). They are
#: state, not parameters, but they live in the same file and they matter just as much: with
#: ``THC enable`` unset the torch height never moves during a cut, however good the
#: parameters are.
#:
#: Torch enable is deliberately absent — upstream does not persist it, and a machine that
#: came up with the torch already armed would be a nasty surprise.
PLASMA_ENABLES: Tuple[PlasmaEnable, ...] = (
    PlasmaEnable("THC enable", "thc-enable", True),
    PlasmaEnable("Corner lock enable", "cornerlock-enable", True),
    PlasmaEnable("Void lock enable", "voidlock-enable", False),
    PlasmaEnable("Use auto volts", "use-auto-volts", True),
    PlasmaEnable("Ohmic probe enable", "ohmic-probe-enable", False),
    PlasmaEnable("THC auto", "thc-auto", False),
)

_ENABLES_BY_PIN: Dict[str, PlasmaEnable] = {enable.pin: enable for enable in PLASMA_ENABLES}


def enable_for_pin(pin: str) -> Optional[PlasmaEnable]:
    """The persisted toggle a ``plasmac.*`` pin belongs to, if it is one of them."""
    return _ENABLES_BY_PIN.get(pin)


def read_enables(path: str) -> Dict[str, bool]:
    """``{plasmac pin: on}`` for the six remembered toggles, defaults where the file is silent."""
    parser = read_config(path)
    values: Dict[str, bool] = {}
    for enable in PLASMA_ENABLES:
        value = enable.default
        if parser.has_option(ENABLE_SECTION, enable.key):
            raw = parser.get(ENABLE_SECTION, enable.key).strip().lower()
            if raw in ("true", "1", "yes", "on"):
                value = True
            elif raw in ("false", "0", "no", "off"):
                value = False
            else:
                logger.warning(
                    "plasma: %s: [%s] %s is not a boolean (%r); using %s",
                    path,
                    ENABLE_SECTION,
                    enable.key,
                    raw,
                    value,
                )
        values[enable.pin] = value
    return values


def write_enable(path: str, pin: str, value: bool) -> None:
    """Remember one toggle, in the ``True``/``False`` spelling QtPlasmaC's reader expects."""
    enable = _ENABLES_BY_PIN.get(pin)
    if enable is None:
        return
    parser = read_config(path)
    if not parser.has_section(ENABLE_SECTION):
        parser.add_section(ENABLE_SECTION)
    parser.set(ENABLE_SECTION, enable.key, "True" if value else "False")
    write_config(path, parser)
