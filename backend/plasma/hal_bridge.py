"""The plasma HAL bridge: one dedicated thread that owns all HAL I/O.

Why a thread and not asyncio: the ``hal`` module is a blocking C extension and LinuxCNC's
own timing is unforgiving. Reads and writes happen in this thread only; the event loop sees
nothing but immutable snapshot dicts handed over through a callback.

Startup order is load-bearing (see ``bin/lcncgui`` and BUILD_PLAN.md):

1. :meth:`HalBridge.create_component` — export ``qtplasmac`` and its 91 pins
2. :meth:`HalBridge.ready` — ``comp.ready()``; only now may ``net qtplasmac.*`` lines run
3. the launcher loads ``[HAL] POSTGUI_HALFILE``
4. :meth:`HalBridge.start` — begin polling

The write path never implements control logic: it applies setpoints and one-shot requests.
Anything reactive stays in the realtime ``plasmac`` component and the ``.hal`` wiring.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Protocol, Tuple

from backend.plasma.pins import (
    HAL_NETS,
    PLASMAC_COMPONENT,
    PLASMAC_PINS,
    QTPLASMAC_COMPONENT,
    QTPLASMAC_PINS,
    PlasmaPin,
    hal_name,
    is_writable,
    plasmac_pin,
    qtplasmac_pin,
)

logger = logging.getLogger(__name__)

#: Snapshot layout: ``{"plasmac": {pin: value}, "qtplasmac": {pin: value}}``.
Snapshot = Dict[str, Dict[str, Any]]

DEFAULT_POLL_INTERVAL_S = 0.05

#: HAL pins outside the two plasma components that this layer may write. One entry, and it is
#: a handshake rather than control: ``M190`` raises ``qtplasmac.material_change`` and then
#: polls ``motion.digital-in-03`` for the GUI's answer.
EXTERNAL_WRITABLE_PINS = frozenset({"motion.digital-in-03"})

#: Marker component for a queued :meth:`HalBridge.request_external_write`.
_EXTERNAL = "<external>"


class PinWriteRejected(RuntimeError):
    """A write was refused before it reached HAL. Carries a machine-readable ``code``."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class HalRuntime(Protocol):
    """The slice of the ``hal`` module the bridge uses, so tests can substitute it."""

    def component(self, name: str) -> Any: ...

    def newpin(self, comp: Any, name: str, pin_type: str, direction: str) -> None: ...

    def ready(self, comp: Any) -> None: ...

    def get_value(self, name: str) -> Any: ...

    def set_p(self, name: str, value: str) -> None: ...

    def pin_names(self) -> Tuple[str, ...]: ...

    def pin_has_writer(self, name: str) -> bool: ...

    def pin_types(self) -> Dict[str, str]: ...

    def signal_names(self) -> Tuple[str, ...]: ...

    def new_signal(self, name: str, pin_type: str) -> None: ...

    def connect(self, pin: str, signal: str) -> None: ...


class NativeHalRuntime:
    """Adapter over LinuxCNC's ``hal`` module. Imported lazily so macOS/CI can import us."""

    _TYPES = {"bit": "HAL_BIT", "float": "HAL_FLOAT", "s32": "HAL_S32", "u32": "HAL_U32"}
    _DIRECTIONS = {"in": "HAL_IN", "out": "HAL_OUT"}

    def __init__(self) -> None:
        import hal  # noqa: PLC0415 — optional dependency, only present on the machine

        self._hal = hal

    def component(self, name: str) -> Any:
        return self._hal.component(name)

    def newpin(self, comp: Any, name: str, pin_type: str, direction: str) -> None:
        comp.newpin(
            name,
            getattr(self._hal, self._TYPES[pin_type]),
            getattr(self._hal, self._DIRECTIONS[direction]),
        )

    def ready(self, comp: Any) -> None:
        comp.ready()

    def get_value(self, name: str) -> Any:
        return self._hal.get_value(name)

    def set_p(self, name: str, value: str) -> None:
        self._hal.set_p(name, value)

    def pin_names(self) -> Tuple[str, ...]:
        # get_info_pins() needs a component to exist first, which create_component ensures.
        return tuple(info["NAME"] for info in self._hal.get_info_pins())

    def pin_has_writer(self, name: str) -> bool:
        return bool(self._hal.pin_has_writer(name))

    #: hal reports pin/signal types as ints; keep the table's vocabulary instead.
    _TYPE_NAMES = {1: "bit", 2: "float", 3: "s32", 4: "u32"}

    def pin_types(self) -> Dict[str, str]:
        return {
            info["NAME"]: self._TYPE_NAMES.get(int(info["TYPE"]), "float")
            for info in self._hal.get_info_pins()
        }

    def signal_names(self) -> Tuple[str, ...]:
        return tuple(info["NAME"] for info in self._hal.get_info_signals())

    def new_signal(self, name: str, pin_type: str) -> None:
        self._hal.new_sig(name, getattr(self._hal, self._TYPES[pin_type]))

    def connect(self, pin: str, signal: str) -> None:
        self._hal.connect(pin, signal)


def format_hal_value(pin: PlasmaPin, value: Any) -> str:
    """Render a Python value the way ``hal.set_p`` expects it for this pin type."""
    if pin.type == "bit":
        if isinstance(value, str):
            truthy = value.strip().lower() in ("1", "true", "yes", "on")
        else:
            truthy = bool(value)
        return "1" if truthy else "0"
    if pin.type == "float":
        return repr(float(value))
    number = int(float(value))
    if pin.type == "u32" and number < 0:
        raise PinWriteRejected("value_out_of_range", f"{pin.name} is u32; got {value}")
    return str(number)


class HalBridge:
    """Owns the ``qtplasmac`` component and polls ``plasmac.*`` at a fixed interval.

    ``on_change`` is called from the bridge thread with ``(snapshot, diff)`` whenever a
    polled value changed — hand it a ``loop.call_soon_threadsafe`` wrapper, never do real
    work in it.
    """

    def __init__(
        self,
        runtime: HalRuntime,
        on_change: Optional[Callable[[Snapshot, Snapshot], None]] = None,
        poll_interval_s: float = DEFAULT_POLL_INTERVAL_S,
        component_name: str = QTPLASMAC_COMPONENT,
    ) -> None:
        self._runtime = runtime
        self._on_change = on_change
        self._poll_interval_s = poll_interval_s
        self._component_name = component_name

        self._comp: Any = None
        self._ready = False
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._writes: "queue.Queue[Tuple[str, str, Any]]" = queue.Queue()

        self._lock = threading.Lock()
        self._snapshot: Snapshot = {PLASMAC_COMPONENT: {}, self._component_name: {}}
        self._missing: Tuple[str, ...] = ()
        self._read_plasmac: Tuple[PlasmaPin, ...] = ()
        self._write_errors: List[str] = []
        #: Extra HAL pins this machine's own config named (see ``allow_external_pin``).
        self._allowed_external: set = set()

    # ---- lifecycle -----------------------------------------------------------------

    def set_on_change(self, callback: Optional[Callable[[Snapshot, Snapshot], None]]) -> None:
        """Install (or clear) the change callback. Called from the event loop, not the thread."""
        self._on_change = callback

    def create_component(self) -> None:
        """Export ``qtplasmac`` with all 91 pins. Must run before ``hal.ready()``."""
        if self._comp is not None:
            raise RuntimeError("component already created")
        self._comp = self._runtime.component(self._component_name)
        for pin in QTPLASMAC_PINS:
            self._runtime.newpin(self._comp, pin.name, pin.type, pin.direction)
        logger.info(
            "plasma: exported HAL component %s with %d pins",
            self._component_name,
            len(QTPLASMAC_PINS),
        )

    def ready(self) -> None:
        """``comp.ready()``, then work out which ``plasmac.*`` pins this build actually has."""
        if self._comp is None:
            raise RuntimeError("create_component() must run first")
        self._runtime.ready(self._comp)
        self._ready = True

        existing = set(self._runtime.pin_names())
        present, missing = [], []
        for pin in PLASMAC_PINS:
            (present if hal_name(PLASMAC_COMPONENT, pin) in existing else missing).append(pin)
        self._read_plasmac = tuple(present)
        self._missing = tuple(hal_name(PLASMAC_COMPONENT, pin) for pin in missing)
        if self._missing:
            # Warning, not info: uvicorn configures no root handler, so info from backend
            # modules is dropped, and "this build is missing 18 pins" is worth seeing.
            logger.warning(
                "plasma: this LinuxCNC build has no %s — those pins stay absent",
                ", ".join(self._missing),
            )

    def apply_nets(self) -> Tuple[str, ...]:
        """Recreate the HAL links QtPlasmaC's ``link_hal_pins()`` makes.

        Without them the component exports pins that nothing is wired to, and — the part
        that actually breaks cutting — ``plasmac.axis-*-limit`` stays at 0, so every probe
        fails immediately. Signals that already exist are joined rather than recreated, and
        a member that is already linked is left alone: machine configs are allowed to have
        wired these themselves, and their wiring wins.

        Returns the names of links that could not be made, for logging.
        """
        if not self._ready:
            raise RuntimeError("ready() must run before apply_nets()")

        pin_types = self._runtime.pin_types()
        existing_pins = set(pin_types)
        signals = set(self._runtime.signal_names())
        skipped: List[str] = []

        for net in HAL_NETS:
            members = [name for name in net.members if name in existing_pins]
            missing = [name for name in net.members if name not in existing_pins]
            skipped.extend(missing)
            if not members:
                continue

            if net.signal not in signals:
                try:
                    self._runtime.new_signal(net.signal, pin_types[members[0]])
                    signals.add(net.signal)
                except Exception as exc:
                    logger.warning("plasma: could not create signal %s: %s", net.signal, exc)
                    skipped.extend(members)
                    continue

            for member in members:
                try:
                    self._runtime.connect(member, net.signal)
                except Exception as exc:
                    # Already linked is the common case and not an error worth shouting about.
                    logger.debug("plasma: net %s <- %s: %s", net.signal, member, exc)
                    skipped.append(member)

        if skipped:
            logger.info("plasma: %d net members left alone (absent or already linked)", len(skipped))
        return tuple(skipped)

    def apply_startup_values(self, values: Mapping[str, Any]) -> Tuple[str, ...]:
        """Give our own output pins the values QtPlasmaC's handler gives them at startup.

        A HAL pin starts at zero, and for ``gcode_scale`` zero is not a neutral value:
        plasmac divides its requested feed rate by it, so the requested feed rate comes out
        infinite, the "at cut speed" test never passes, ``target-volts`` is never set and the
        THC never engages — a cut runs with the torch height frozen. ``thc_feed_rate`` is the
        Z velocity the THC may use, and is likewise useless at zero.

        Returns the names it could not set, for logging.
        """
        if not self._ready:
            raise RuntimeError("ready() must run before apply_startup_values()")

        failed: List[str] = []
        for name, value in values.items():
            try:
                pin = qtplasmac_pin(name)
            except KeyError:
                logger.warning("plasma: no such own pin to initialise: %s", name)
                failed.append(name)
                continue
            if pin.direction != "out" or self._comp is None:
                failed.append(name)
                continue
            try:
                self._comp[pin.name] = _coerce_own_pin_value(pin, format_hal_value(pin, value))
            except Exception as exc:
                logger.warning("plasma: could not initialise %s to %s: %s", name, value, exc)
                failed.append(name)
        return tuple(failed)

    def start(self) -> None:
        if not self._ready:
            raise RuntimeError("ready() must run before start()")
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run, name="plasma-hal-bridge", daemon=True
        )
        self._thread.start()

    def stop(self, timeout_s: float = 2.0) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=timeout_s)
            if thread.is_alive():
                logger.warning("plasma: HAL bridge thread did not stop within %ss", timeout_s)
        self._thread = None

    # ---- reads ---------------------------------------------------------------------

    @property
    def missing_pins(self) -> Tuple[str, ...]:
        """``plasmac.*`` pins the pin table knows but this LinuxCNC build does not export."""
        return self._missing

    def take_write_errors(self) -> Tuple[str, ...]:
        """Writes HAL refused since this was last called, and forget them.

        A queued write that fails is invisible to whoever asked for it — the ack went out when
        the write was *accepted*. For a user button wired to a solenoid, "nothing happened and
        nobody said so" is the worst outcome, so the publisher drains this and tells the client.
        """
        with self._lock:
            errors = tuple(self._write_errors)
            self._write_errors.clear()
        return errors

    def external_pin_value(self, name: str) -> Any:
        """Read any HAL pin by full name — for a user button that toggles one."""
        return self._runtime.get_value(name)

    def snapshot(self) -> Snapshot:
        """Latest full snapshot — what a newly connected WebSocket client gets."""
        with self._lock:
            return {component: dict(values) for component, values in self._snapshot.items()}

    def poll_once(self) -> Snapshot:
        """Read every pin once, publish the diff, and return it. Also the unit-test seam."""
        current: Snapshot = {
            PLASMAC_COMPONENT: self._read_component_pins(),
            self._component_name: self._read_own_pins(),
        }
        with self._lock:
            diff = _diff_snapshots(self._snapshot, current)
            self._snapshot = current
        if diff and self._on_change is not None:
            self._on_change(
                {component: dict(values) for component, values in current.items()}, diff
            )
        return diff

    def _read_component_pins(self) -> Dict[str, Any]:
        values: Dict[str, Any] = {}
        for pin in self._read_plasmac:
            try:
                values[pin.name] = self._runtime.get_value(hal_name(PLASMAC_COMPONENT, pin))
            except Exception:  # a pin can vanish if the comp is unloaded under us
                logger.debug("plasma: read failed for %s", pin.name, exc_info=True)
        return values

    def _read_own_pins(self) -> Dict[str, Any]:
        values: Dict[str, Any] = {}
        if self._comp is None:
            return values
        for pin in QTPLASMAC_PINS:
            try:
                values[pin.name] = self._comp[pin.name]
            except Exception:
                logger.debug("plasma: read failed for own pin %s", pin.name, exc_info=True)
        return values

    # ---- writes --------------------------------------------------------------------

    def request_write(self, component: str, name: str, value: Any) -> None:
        """Queue a pin write. Policy violations raise here, in the caller's context.

        The policy check is deliberately at enqueue time: a rejected write must surface as
        an error on the command that asked for it, not as a log line in the bridge thread.
        """
        pin = self._resolve_writable(component, name)
        self._writes.put((component, pin.name, format_hal_value(pin, value)))

    def allow_external_pin(self, name: str) -> None:
        """Permit writes to one more HAL pin outside the plasma components.

        For the pins a machine's *own config file* names — a user button's
        ``toggle-halpin dust-extractor``. The name comes from the machine owner's prefs, never
        from a request, so this is configuration rather than an open door; a client can only
        ask for a button by number.
        """
        self._allowed_external.add(name)

    def request_external_write(self, name: str, value: Any) -> None:
        """Queue a write to one of the few HAL pins outside the plasma components.

        The base allowlist is one pin: ``motion.digital-in-03`` is what ``M190`` polls while it
        waits for a material change, so answering it is not optional. Anything else has to have
        been declared through :meth:`allow_external_pin` — a general "write any HAL pin" door
        would undo the whole point of the write policy.
        """
        if name not in EXTERNAL_WRITABLE_PINS and name not in self._allowed_external:
            allowed = sorted(EXTERNAL_WRITABLE_PINS | self._allowed_external)
            raise PinWriteRejected(
                "pin_not_writable",
                f"{name} is not one of the pins the plasma layer may write ({', '.join(allowed)})",
            )
        self._writes.put((_EXTERNAL, name, "1" if bool(value) else "0"))

    def _resolve_writable(self, component: str, name: str) -> PlasmaPin:
        if component == PLASMAC_COMPONENT:
            try:
                pin = plasmac_pin(name)
            except KeyError:
                raise PinWriteRejected("unknown_pin", f"no such pin: {component}.{name}")
        elif component == self._component_name:
            try:
                pin = qtplasmac_pin(name)
            except KeyError:
                raise PinWriteRejected("unknown_pin", f"no such pin: {component}.{name}")
        else:
            raise PinWriteRejected("unknown_component", f"not a plasma component: {component}")

        if not is_writable(pin):
            raise PinWriteRejected(
                "pin_not_writable",
                f"{component}.{pin.name} is {pin.policy}; the backend only writes setpoints "
                "and its own outputs",
            )
        if component == PLASMAC_COMPONENT:
            if hal_name(component, pin) in self._missing:
                raise PinWriteRejected(
                    "pin_missing", f"{component}.{pin.name} does not exist in this LinuxCNC build"
                )
            # A setpoint that HAL already drives belongs to the machine's wiring; writing it
            # would fight another writer, and HAL would refuse anyway.
            try:
                if self._runtime.pin_has_writer(hal_name(component, pin)):
                    raise PinWriteRejected(
                        "pin_has_hal_writer",
                        f"{component}.{pin.name} is driven by a HAL signal on this machine",
                    )
            except PinWriteRejected:
                raise
            except Exception:
                logger.debug("plasma: pin_has_writer check failed for %s", pin.name, exc_info=True)
        return pin

    def _apply_pending_writes(self) -> None:
        while True:
            try:
                component, name, value = self._writes.get_nowait()
            except queue.Empty:
                return
            try:
                if component == _EXTERNAL:
                    self._runtime.set_p(name, value)
                elif component == self._component_name and self._comp is not None:
                    self._comp[name] = _coerce_own_pin_value(qtplasmac_pin(name), value)
                else:
                    self._runtime.set_p(f"{component}.{name}", value)
            except Exception as exc:
                logger.warning("plasma: write %s.%s = %s failed: %s", component, name, value, exc)
                target = name if component == _EXTERNAL else f"{component}.{name}"
                with self._lock:
                    self._write_errors.append(f"{target}: {exc}")

    # ---- thread body ---------------------------------------------------------------

    def _run(self) -> None:
        logger.info("plasma: HAL bridge polling every %.0f ms", self._poll_interval_s * 1000)
        while not self._stop.is_set():
            started = time.monotonic()
            try:
                self._apply_pending_writes()
                self.poll_once()
            except Exception:
                logger.exception("plasma: HAL bridge iteration failed")
            elapsed = time.monotonic() - started
            self._stop.wait(max(0.0, self._poll_interval_s - elapsed))
        logger.info("plasma: HAL bridge stopped")


def _coerce_own_pin_value(pin: PlasmaPin, formatted: str) -> Any:
    """Own-component pins are assigned Python values, not ``set_p`` strings."""
    if pin.type == "bit":
        return formatted == "1"
    if pin.type == "float":
        return float(formatted)
    return int(formatted)


def _diff_snapshots(previous: Snapshot, current: Snapshot) -> Snapshot:
    """Per-component dict of the values that changed (or appeared) in ``current``."""
    diff: Snapshot = {}
    for component, values in current.items():
        before = previous.get(component, {})
        changed = {
            name: value for name, value in values.items() if name not in before or before[name] != value
        }
        if changed:
            diff[component] = changed
    return diff


def rising_edges(previous: Mapping[str, Any], current: Mapping[str, Any], names: Iterable[str]) -> Tuple[str, ...]:
    """Names in ``names`` that went false → true between the two readings.

    The ``ext_*`` panel inputs are momentary: a control panel button is a rising edge, not a
    state. Same pattern as ``services/panel_hal_publisher.py``.
    """
    edges = []
    for name in names:
        if not previous.get(name) and current.get(name):
            edges.append(name)
    return tuple(edges)
