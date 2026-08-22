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


class ParameterLimits(NamedTuple):
    """What a parameter may be set to, and how it is written.

    QtPlasmaC's spinboxes carry these: a range, a precision and a unit suffix. They are not
    presentation — the value goes straight onto a live ``plasmac.*`` setpoint, so a
    ``Height Per Volt`` of 10 instead of 0.1 makes every volt of arc error command 100 mm of
    Z motion. Ours arrive over a WebSocket, which is one more reason to bound them here
    rather than trust the field that produced them.
    """

    minimum: float
    maximum: float
    #: Digits after the point the machine's owner may enter; 0 means whole numbers.
    decimals: int
    #: Unit as QtPlasmaC labels it. ``mS`` for ``Spotting Time`` is not a typo — see below.
    unit: str


#: ``key → (metric, imperial)`` bounds, from QtPlasmaC's ``qtplasmac.ui`` spinbox properties
#: and the imperial overrides in ``set_spinbox_parameters`` (``qtplasmac_handler.py:3176``).
#:
#: Three entries carry a ``None`` maximum: it comes from the machine's INI, not the screen —
#: see :func:`machine_bounds`. Everything else is the same on every machine.
#:
#: ``Spotting Time`` is **milliseconds**, with 0 decimals and a 9999 ceiling. That is
#: upstream's unit (``spotting_time`` suffix ``mS``) and the realtime component divides it by
#: 1000 (``plasmac.comp:1542``), so labelling it seconds here would make every spot 1000×
#: too short.
_LIMITS: Dict[str, Tuple[ParameterLimits, ParameterLimits]] = {
    # ---- arc ----
    "Arc Fail Timeout": (
        ParameterLimits(0.0, 60.0, 1, "s"),
        ParameterLimits(0.0, 60.0, 1, "s"),
    ),
    "Arc Maximum Starts": (
        ParameterLimits(0.0, 10.0, 0, ""),
        ParameterLimits(0.0, 10.0, 0, ""),
    ),
    "Arc Restart Delay": (
        ParameterLimits(0.0, 60.0, 0, "s"),
        ParameterLimits(0.0, 60.0, 0, "s"),
    ),
    "Arc OK High": (
        ParameterLimits(0.0, 99999.0, 0, "V"),
        ParameterLimits(0.0, 99999.0, 0, "V"),
    ),
    "Arc OK Low": (
        ParameterLimits(0.0, 99.0, 0, "V"),
        ParameterLimits(0.0, 99.0, 0, "V"),
    ),
    "Arc Voltage Scale": (
        ParameterLimits(0.0, 9999.0, 6, ""),
        ParameterLimits(0.0, 9999.0, 6, ""),
    ),
    "Arc Voltage Offset": (
        ParameterLimits(0.0, 999999.0, 3, ""),
        ParameterLimits(0.0, 999999.0, 3, ""),
    ),
    # ---- THC ----
    "Pid P Gain": (
        ParameterLimits(0.0, 1000.0, 0, ""),
        ParameterLimits(0.0, 1000.0, 0, ""),
    ),
    "Pid I Gain": (
        ParameterLimits(0.0, 1000.0, 0, ""),
        ParameterLimits(0.0, 1000.0, 0, ""),
    ),
    "Pid D Gain": (
        ParameterLimits(0.0, 1000.0, 0, ""),
        ParameterLimits(0.0, 1000.0, 0, ""),
    ),
    "THC Delay": (
        ParameterLimits(0.0, 9.0, 2, "s"),
        ParameterLimits(0.0, 9.0, 2, "s"),
    ),
    "THC Threshold": (
        ParameterLimits(0.05, 10.0, 2, "V"),
        ParameterLimits(0.05, 10.0, 2, "V"),
    ),
    "THC Sample Counts": (
        ParameterLimits(0.0, 1000.0, 0, ""),
        ParameterLimits(0.0, 1000.0, 0, ""),
    ),
    "THC Sample Threshold": (
        ParameterLimits(0.0, 99.0, 2, "V"),
        ParameterLimits(0.0, 99.0, 2, "V"),
    ),
    "Height Per Volt": (
        ParameterLimits(0.025, 0.25, 3, "mm"),
        ParameterLimits(0.001, 0.01, 3, "in"),
    ),
    "Velocity Anti Dive Threshold": (
        ParameterLimits(0.0, 99.0, 0, "%"),
        ParameterLimits(0.0, 99.0, 0, "%"),
    ),
    "Void Sense Slope": (
        ParameterLimits(0.0, 10000.0, 0, "V/sec"),
        ParameterLimits(0.0, 10000.0, 0, "V/sec"),
    ),
    # ---- probing ----
    "Probe Feed Rate": (
        ParameterLimits(0.0, None, 0, "mm/min"),  # type: ignore[arg-type]
        ParameterLimits(4.0, None, 1, "in/min"),  # type: ignore[arg-type]
    ),
    "Probe Start Height": (
        ParameterLimits(0.0, None, 2, "mm"),  # type: ignore[arg-type]
        ParameterLimits(0.0, None, 3, "in"),  # type: ignore[arg-type]
    ),
    "Float Switch Travel": (
        ParameterLimits(-25.0, 25.0, 2, "mm"),
        ParameterLimits(-1.0, 1.0, 3, "in"),
    ),
    "Skip IHS Distance": (
        ParameterLimits(0.0, 999.0, 0, "mm"),
        ParameterLimits(0.0, 40.0, 1, "in"),
    ),
    "Ohmic Probe Offset": (
        ParameterLimits(-25.0, 25.0, 2, "mm"),
        ParameterLimits(-1.0, 1.0, 3, "in"),
    ),
    "Ohmic Maximum Attempts": (
        ParameterLimits(0.0, 10.0, 0, ""),
        ParameterLimits(0.0, 10.0, 0, ""),
    ),
    # ---- motion ----
    "Setup Feed Rate": (
        ParameterLimits(0.0, None, 0, "mm/min"),  # type: ignore[arg-type]
        ParameterLimits(4.0, None, 1, "in/min"),  # type: ignore[arg-type]
    ),
    "Offset Feed Rate": (
        ParameterLimits(100.0, None, 0, "mm/min"),  # type: ignore[arg-type]
        ParameterLimits(4.0, None, 1, "in/min"),  # type: ignore[arg-type]
    ),
    "Safe Height": (
        ParameterLimits(0.0, None, 2, "mm"),  # type: ignore[arg-type]
        ParameterLimits(0.0, None, 3, "in"),  # type: ignore[arg-type]
    ),
    "Slat Height": (
        ParameterLimits(0.0, None, 2, "mm"),  # type: ignore[arg-type]
        ParameterLimits(0.0, None, 3, "in"),  # type: ignore[arg-type]
    ),
    # ---- scribe, spotting, pierce offsets ----
    "Scribe Arming Delay": (
        ParameterLimits(0.0, 10.0, 1, "s"),
        ParameterLimits(0.0, 10.0, 1, "s"),
    ),
    "Scribe On Delay": (
        ParameterLimits(0.0, 10.0, 1, "s"),
        ParameterLimits(0.0, 10.0, 1, "s"),
    ),
    "Spotting Threshold": (
        ParameterLimits(0.0, 200.0, 0, "V"),
        ParameterLimits(0.0, 200.0, 0, "V"),
    ),
    "Spotting Time": (
        ParameterLimits(0.0, 9999.0, 0, "mS"),
        ParameterLimits(0.0, 9999.0, 0, "mS"),
    ),
    "X Pierce Offset": (
        ParameterLimits(-5.0, 5.0, 2, "mm"),
        ParameterLimits(-0.2, 0.2, 3, "in"),
    ),
    "Y Pierce Offset": (
        ParameterLimits(-5.0, 5.0, 2, "mm"),
        ParameterLimits(-0.2, 0.2, 3, "in"),
    ),
}


class MachineBounds(NamedTuple):
    """The three ceilings a machine's own INI sets, in the machine's units."""

    #: ``[AXIS_Z] MAX_VELOCITY * OFFSET_AV_RATIO * 60`` — how fast the THC may move Z.
    thc_feed_rate: Optional[float]
    #: The slowest of X/Y ``MAX_VELOCITY * 30`` and ``[TRAJ] MAX_LINEAR_VELOCITY``.
    offset_feed_rate: Optional[float]
    #: ``[AXIS_Z] MAX_LIMIT - MIN_LIMIT`` — nothing may ask for more Z than the machine has.
    max_height: Optional[float]


def machine_bounds(files: MachineFiles) -> MachineBounds:
    """QtPlasmaC's ``thcFeedRate``, ``offsetFeedRate`` and ``maxHeight``
    (``qtplasmac_handler.py:276``).

    A missing INI value gives ``None`` rather than a guess: an invented ceiling on a real
    machine is worse than no ceiling, because it silently refuses a legitimate setting.
    """
    from backend.plasma.machine_files import ini_real  # noqa: PLC0415 — avoids a cycle

    path = files.ini_path
    z_velocity = ini_real(path, "AXIS_Z", "MAX_VELOCITY")
    z_ratio = ini_real(path, "AXIS_Z", "OFFSET_AV_RATIO")
    thc = z_velocity * z_ratio * 60.0 if z_velocity is not None and z_ratio is not None else None

    rates = [
        rate * 30.0
        for rate in (
            ini_real(path, "AXIS_X", "MAX_VELOCITY"),
            ini_real(path, "AXIS_Y", "MAX_VELOCITY"),
        )
        if rate is not None
    ]
    traj = ini_real(path, "TRAJ", "MAX_LINEAR_VELOCITY")
    if traj is not None:
        rates.append(traj)
    offset = min(rates) if rates else None

    z_max = ini_real(path, "AXIS_Z", "MAX_LIMIT")
    z_min = ini_real(path, "AXIS_Z", "MIN_LIMIT")
    height = z_max - z_min if z_max is not None and z_min is not None else None

    return MachineBounds(thc, offset, height)


#: Which INI-derived ceiling fills in each ``None`` maximum above.
_MACHINE_MAXIMUM = {
    "Setup Feed Rate": "thc_feed_rate",
    "Probe Feed Rate": "thc_feed_rate",
    "Offset Feed Rate": "offset_feed_rate",
    "Probe Start Height": "max_height",
    "Safe Height": "max_height",
    "Slat Height": "max_height",
}

#: The ceiling QtPlasmaC keeps as high as ``Setup Feed Rate`` and no higher
#: (``setup_feed_rate_changed``, ``qtplasmac_handler.py:2042``): a probe that descends faster
#: than the setup rate is a torch into the slats.
_CAPPED_BY = {"Probe Feed Rate": "Setup Feed Rate"}


def parameter_limits(
    files: MachineFiles, values: Optional[Mapping[str, Any]] = None
) -> Dict[str, ParameterLimits]:
    """Bounds for every parameter, for this machine and its units.

    ``values`` supplies the current settings, which two bounds depend on. Without them the
    machine ceiling is used, which is the wider of the two and so never refuses a value
    QtPlasmaC would have accepted.
    """
    imperial = files.units_per_mm < 0.5
    bounds = machine_bounds(files)
    limits: Dict[str, ParameterLimits] = {}
    for key, pair in _LIMITS.items():
        limit = pair[1] if imperial else pair[0]
        maximum = limit.maximum
        if maximum is None:
            attribute = _MACHINE_MAXIMUM.get(key)
            machine_max = getattr(bounds, attribute) if attribute else None
            # No ceiling in the INI means no ceiling at all, which is what QtPlasmaC does
            # with a missing value too.
            maximum = float(machine_max) if machine_max is not None else float("inf")
        capped_by = _CAPPED_BY.get(key)
        if capped_by and values is not None:
            try:
                maximum = min(maximum, float(values[capped_by]))
            except (KeyError, TypeError, ValueError):
                pass
        limits[key] = limit._replace(maximum=maximum)
    return limits


class ParameterRejected(ValueError):
    """A parameter outside its bounds, with the bound it broke."""

    def __init__(self, code: str, message: str, key: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.key = key


def check_parameters(
    files: MachineFiles, edits: Mapping[str, Any], current: Optional[Mapping[str, Any]] = None
) -> Dict[str, Any]:
    """Validate parameter edits against their bounds, returning them as their stored type.

    Refuses rather than clamps. A clamped value looks accepted, and an operator who typed
    ``250`` for a cut height would go on believing the machine had it.
    """
    limits = parameter_limits(files, {**(current or {}), **edits})
    checked: Dict[str, Any] = {}
    for key, raw in edits.items():
        param = _BY_KEY.get(key)
        if param is None:
            raise ParameterRejected("unknown_parameter", f"no parameter named {key!r}", key)
        try:
            value = float(raw)
        except (TypeError, ValueError):
            raise ParameterRejected(
                "not_a_number", f"{key} must be a number, not {raw!r}", key
            ) from None
        limit = limits.get(key)
        if limit is not None and not limit.minimum <= value <= limit.maximum:
            unit = f" {limit.unit}" if limit.unit else ""
            raise ParameterRejected(
                "out_of_range",
                f"{key} must be between {limit.minimum:g} and {limit.maximum:g}{unit}",
                key,
            )
        checked[key] = param.kind(value)
    return checked


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


CONVERSATIONAL_SECTION = "CONVERSATIONAL"


class ConversationalSetting(NamedTuple):
    """One ``[CONVERSATIONAL]`` key: how it is stored, and what it means without a value."""

    key: str
    kind: type
    default: Callable[[float], Any]


#: QtPlasmaC's conversational settings (``conv_settings.py:94``). ``Preamble``/``Postamble`` are
#: strings and are handled separately; these are the numeric ones the UI can edit.
CONVERSATIONAL_SETTINGS: Tuple[ConversationalSetting, ...] = (
    ConversationalSetting("Origin", int, _fixed(0)),
    ConversationalSetting("Leadin", float, _fixed(0.0)),
    ConversationalSetting("Leadout", float, _fixed(0.0)),
    # 32 mm / 1.26 in, QtPlasmaC's `unitCode[2]`.
    ConversationalSetting("Hole diameter", float, lambda units: 1.26 if units != 1.0 else 32.0),
    ConversationalSetting("Hole speed", int, _fixed(60)),
    ConversationalSetting("Grid Size", float, _fixed(0.0)),
)

_CONVERSATIONAL_BY_KEY: Dict[str, ConversationalSetting] = {
    setting.key: setting for setting in CONVERSATIONAL_SETTINGS
}


def read_conversational_settings(path: str, units_per_mm: float = 1.0) -> Dict[str, Any]:
    """The conversational settings, defaults where the file is silent, plus the ambles."""
    parser = read_config(path)
    values: Dict[str, Any] = {}
    for setting in CONVERSATIONAL_SETTINGS:
        fallback = setting.default(units_per_mm)
        if not parser.has_option(CONVERSATIONAL_SECTION, setting.key):
            values[setting.key] = fallback
            continue
        raw = parser.get(CONVERSATIONAL_SECTION, setting.key)
        try:
            values[setting.key] = setting.kind(float(raw))
        except (TypeError, ValueError):
            logger.warning(
                "plasma: %s: [%s] %s is not a number (%r); using %s",
                path,
                CONVERSATIONAL_SECTION,
                setting.key,
                raw,
                fallback,
            )
            values[setting.key] = fallback

    for amble in ("Preamble", "Postamble"):
        if parser.has_option(CONVERSATIONAL_SECTION, amble):
            values[amble] = parser.get(CONVERSATIONAL_SECTION, amble)
    return values


def write_conversational_settings(path: str, values: Mapping[str, Any]) -> None:
    """Store conversational settings, refusing keys QtPlasmaC does not keep there."""
    parser = read_config(path)
    if not parser.has_section(CONVERSATIONAL_SECTION):
        parser.add_section(CONVERSATIONAL_SECTION)
    for key, value in values.items():
        if key in ("Preamble", "Postamble"):
            parser.set(CONVERSATIONAL_SECTION, key, str(value))
            continue
        setting = _CONVERSATIONAL_BY_KEY.get(key)
        if setting is None:
            logger.warning("plasma: refusing to write unknown conversational setting %r", key)
            continue
        parser.set(CONVERSATIONAL_SECTION, key, str(setting.kind(float(value))))
    write_config(path, parser)


#: Where the alignment laser and the camera sit relative to the torch
#: (``offset_peripherals``, ``qtplasmac_handler.py:1232``). Zero on both axes means the machine
#: has none, and QtPlasmaC hides the button — so zero is "not fitted", not "fitted at 0,0".
PERIPHERAL_SECTIONS: Tuple[str, ...] = ("LASER_OFFSET", "CAMERA_OFFSET")

PERIPHERAL_KEYS: Tuple[str, ...] = ("X axis", "Y axis")


def read_peripheral_offset(path: str, section: str) -> Dict[str, float]:
    """``[LASER_OFFSET]`` or ``[CAMERA_OFFSET]`` from the prefs, zeros where the file is silent."""
    if section not in PERIPHERAL_SECTIONS:
        raise KeyError(section)
    parser = read_config(path)
    values: Dict[str, float] = {}
    for key in PERIPHERAL_KEYS:
        value = 0.0
        if parser.has_option(section, key):
            raw = parser.get(section, key)
            try:
                value = float(raw)
            except (TypeError, ValueError):
                logger.warning(
                    "plasma: %s: [%s] %s is not a number (%r); using 0",
                    path,
                    section,
                    key,
                    raw,
                )
        values[key] = value
    return values


def write_peripheral_offset(path: str, section: str, values: Mapping[str, Any]) -> None:
    if section not in PERIPHERAL_SECTIONS:
        raise KeyError(section)
    parser = read_config(path)
    if not parser.has_section(section):
        parser.add_section(section)
    for key, value in values.items():
        if key not in PERIPHERAL_KEYS:
            logger.warning("plasma: refusing to write unknown %s key %r", section, key)
            continue
        parser.set(section, key, str(float(value)))
    write_config(path, parser)


OFFSET_PROBING_SECTION = "OFFSET_PROBING"


class OffsetProbeSetting(NamedTuple):
    """One ``[OFFSET_PROBING]`` key and the ``plasmac.*`` setpoint it feeds."""

    key: str
    pin: str
    default: float


#: A machine whose probe is not under the torch has to move by this much before probing, and
#: wait for the probe to deploy (``plasmac.comp:838``). Zero on both axes means "no offset
#: probe", which is the common case and what upstream hides the offset feed rate for.
OFFSET_PROBING_SETTINGS: Tuple[OffsetProbeSetting, ...] = (
    OffsetProbeSetting("X axis", "offset-probe-x", 0.0),
    OffsetProbeSetting("Y axis", "offset-probe-y", 0.0),
    OffsetProbeSetting("Delay", "offset-probe-delay", 0.0),
)

_OFFSET_PROBING_BY_KEY: Dict[str, OffsetProbeSetting] = {
    setting.key: setting for setting in OFFSET_PROBING_SETTINGS
}


def read_offset_probing(path: str) -> Dict[str, float]:
    """``[OFFSET_PROBING]`` from the prefs, zeros where the file is silent."""
    parser = read_config(path)
    values: Dict[str, float] = {}
    for setting in OFFSET_PROBING_SETTINGS:
        value = setting.default
        if parser.has_option(OFFSET_PROBING_SECTION, setting.key):
            raw = parser.get(OFFSET_PROBING_SECTION, setting.key)
            try:
                value = float(raw)
            except (TypeError, ValueError):
                logger.warning(
                    "plasma: %s: [%s] %s is not a number (%r); using %s",
                    path,
                    OFFSET_PROBING_SECTION,
                    setting.key,
                    raw,
                    value,
                )
        values[setting.key] = value
    return values


def write_offset_probing(path: str, values: Mapping[str, Any]) -> None:
    parser = read_config(path)
    if not parser.has_section(OFFSET_PROBING_SECTION):
        parser.add_section(OFFSET_PROBING_SECTION)
    for key, value in values.items():
        if key not in _OFFSET_PROBING_BY_KEY:
            logger.warning("plasma: refusing to write unknown offset probing key %r", key)
            continue
        parser.set(OFFSET_PROBING_SECTION, key, str(float(value)))
    write_config(path, parser)


def offset_probing_pin_values(values: Mapping[str, Any]) -> Dict[str, float]:
    """``{plasmac pin: value}`` for the offset probe, ready for the bridge."""
    pins: Dict[str, float] = {}
    for key, value in values.items():
        setting = _OFFSET_PROBING_BY_KEY.get(key)
        if setting is not None:
            pins[setting.pin] = float(value)
    return pins
