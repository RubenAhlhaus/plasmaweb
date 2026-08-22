"""HAL bridge tests. No LinuxCNC needed — the runtime seam is faked."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Tuple

import pytest

from backend.plasma.hal_bridge import (
    HalBridge,
    PinWriteRejected,
    format_hal_value,
    rising_edges,
)
from backend.plasma.pins import (
    PLASMAC_COMPONENT,
    PLASMAC_PINS,
    QTPLASMAC_COMPONENT,
    QTPLASMAC_PINS,
    hal_name,
    plasmac_pin,
    qtplasmac_pin,
)


class FakeComponent:
    def __init__(self, name: str) -> None:
        self.name = name
        self.pins: Dict[str, Tuple[str, str]] = {}
        self.values: Dict[str, Any] = {}
        self.is_ready = False

    def __getitem__(self, key: str) -> Any:
        return self.values[key]

    def __setitem__(self, key: str, value: Any) -> None:
        if key not in self.pins:
            raise KeyError(key)
        self.values[key] = value


class FakeHalRuntime:
    """Enough of the ``hal`` module to exercise the bridge, plus recording for assertions."""

    def __init__(
        self,
        plasmac_values: Dict[str, Any] | None = None,
        absent: Tuple[str, ...] = (),
        written_by_hal: Tuple[str, ...] = (),
    ) -> None:
        self.components: Dict[str, FakeComponent] = {}
        self.set_p_calls: List[Tuple[str, str]] = []
        #: pins outside the two plasma components, e.g. ini.z.min_limit and motion.feed-upm
        self.extra_pins: Dict[str, str] = {
            "ini.x.min_limit": "float",
            "ini.x.max_limit": "float",
            "ini.y.min_limit": "float",
            "ini.y.max_limit": "float",
            "ini.z.min_limit": "float",
            "ini.z.max_limit": "float",
            "motion.feed-upm": "float",
        }
        self.signals: Dict[str, str] = {}
        #: Values of pins outside the two plasma components (a machine's own HAL).
        self.extra_pin_values: Dict[str, Any] = {}
        self.links: Dict[str, str] = {}
        self._absent = set(absent)
        self._written_by_hal = set(written_by_hal)
        self.plasmac_values: Dict[str, Any] = {
            pin.name: (False if pin.type == "bit" else 0.0 if pin.type == "float" else 0)
            for pin in PLASMAC_PINS
        }
        if plasmac_values:
            self.plasmac_values.update(plasmac_values)

    # --- HalRuntime -------------------------------------------------------------
    def component(self, name: str) -> FakeComponent:
        comp = FakeComponent(name)
        self.components[name] = comp
        return comp

    def newpin(self, comp: FakeComponent, name: str, pin_type: str, direction: str) -> None:
        comp.pins[name] = (pin_type, direction)
        comp.values[name] = False if pin_type == "bit" else 0.0 if pin_type == "float" else 0

    def ready(self, comp: FakeComponent) -> None:
        comp.is_ready = True

    def get_value(self, name: str) -> Any:
        component, _, pin = name.partition(".")
        if component != PLASMAC_COMPONENT:
            # Real `hal.get_value` reads any pin or signal by full name, which is what a user
            # button's `toggle-halpin` relies on.
            if name in self.extra_pins:
                return self.extra_pin_values.get(name, False)
            raise KeyError(name)
        if pin in self._absent:
            raise KeyError(name)
        return self.plasmac_values[pin]

    def set_p(self, name: str, value: str) -> None:
        self.set_p_calls.append((name, value))
        component, _, pin = name.partition(".")
        if component == PLASMAC_COMPONENT:
            self.plasmac_values[pin] = value
        else:
            self.extra_pin_values[name] = value not in ("0", "FALSE", "False", "false")

    def pin_names(self) -> Tuple[str, ...]:
        return tuple(
            hal_name(PLASMAC_COMPONENT, pin)
            for pin in PLASMAC_PINS
            if pin.name not in self._absent
        )

    def pin_has_writer(self, name: str) -> bool:
        return name in self._written_by_hal

    def pin_types(self) -> Dict[str, str]:
        types = {
            hal_name(PLASMAC_COMPONENT, pin): pin.type
            for pin in PLASMAC_PINS
            if pin.name not in self._absent
        }
        types.update(
            {hal_name(QTPLASMAC_COMPONENT, pin): pin.type for pin in QTPLASMAC_PINS}
        )
        types.update(self.extra_pins)
        return types

    def signal_names(self) -> Tuple[str, ...]:
        return tuple(self.signals)

    def new_signal(self, name: str, pin_type: str) -> None:
        self.signals[name] = pin_type

    def connect(self, pin: str, signal: str) -> None:
        if pin in self.links:
            raise RuntimeError(f"pin {pin} is already linked")
        self.links[pin] = signal


def _wait_until(predicate, timeout_s: float = 2.0) -> None:
    deadline = time.monotonic() + timeout_s
    while not predicate() and time.monotonic() < deadline:
        time.sleep(0.01)


def make_bridge(runtime: FakeHalRuntime, **kwargs: Any) -> HalBridge:
    bridge = HalBridge(runtime, **kwargs)
    bridge.create_component()
    bridge.ready()
    return bridge


def test_create_component_exports_every_qtplasmac_pin() -> None:
    runtime = FakeHalRuntime()
    bridge = HalBridge(runtime)
    bridge.create_component()

    comp = runtime.components[QTPLASMAC_COMPONENT]
    assert len(comp.pins) == len(QTPLASMAC_PINS) == 95
    assert comp.pins["ext_abort"] == ("bit", "in")
    assert comp.pins["laser_on"] == ("bit", "out")
    assert not comp.is_ready, "ready() is the launcher's cue to load POSTGUI halfiles"

    bridge.ready()
    assert comp.is_ready


def test_ready_is_required_before_start_and_create_before_ready() -> None:
    runtime = FakeHalRuntime()
    bridge = HalBridge(runtime)
    with pytest.raises(RuntimeError):
        bridge.ready()
    bridge.create_component()
    with pytest.raises(RuntimeError):
        bridge.create_component()
    other = HalBridge(FakeHalRuntime())
    other.create_component()
    with pytest.raises(RuntimeError):
        other.start()


def test_missing_pins_are_reported_and_skipped_not_fatal() -> None:
    """LinuxCNC 2.9.4 has no plasmac.dry-run; the bridge must carry on."""
    runtime = FakeHalRuntime(absent=("dry-run", "tube-cut"))
    bridge = make_bridge(runtime)

    assert bridge.missing_pins == ("plasmac.dry-run", "plasmac.tube-cut")
    bridge.poll_once()
    snapshot = bridge.snapshot()
    assert "dry-run" not in snapshot[PLASMAC_COMPONENT]
    assert "torch-on" in snapshot[PLASMAC_COMPONENT]


def test_poll_publishes_only_what_changed() -> None:
    seen: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    runtime = FakeHalRuntime()
    bridge = make_bridge(runtime, on_change=lambda snap, diff: seen.append((snap, diff)))

    first = bridge.poll_once()
    assert first[PLASMAC_COMPONENT]["torch-on"] is False
    assert len(seen) == 1

    assert bridge.poll_once() == {}, "no change means no publish"
    assert len(seen) == 1

    runtime.plasmac_values["torch-on"] = True
    runtime.plasmac_values["arc-voltage-out"] = 123.4
    diff = bridge.poll_once()
    assert diff == {PLASMAC_COMPONENT: {"torch-on": True, "arc-voltage-out": 123.4}}
    assert len(seen) == 2
    assert seen[-1][0][PLASMAC_COMPONENT]["torch-on"] is True


def test_snapshot_is_a_copy() -> None:
    runtime = FakeHalRuntime()
    bridge = make_bridge(runtime)
    bridge.poll_once()

    snapshot = bridge.snapshot()
    snapshot[PLASMAC_COMPONENT]["torch-on"] = "tampered"
    assert bridge.snapshot()[PLASMAC_COMPONENT]["torch-on"] is False


def test_own_pins_are_polled_from_the_component() -> None:
    runtime = FakeHalRuntime()
    bridge = make_bridge(runtime)
    bridge.poll_once()

    runtime.components[QTPLASMAC_COMPONENT].values["ext_torch_enable"] = True
    diff = bridge.poll_once()
    assert diff == {QTPLASMAC_COMPONENT: {"ext_torch_enable": True}}


@pytest.mark.parametrize(
    "name",
    ["torch-on", "arc-ok-out", "z-offset-counts", "state-out", "cut-time"],
)
def test_realtime_owned_pins_cannot_be_written(name: str) -> None:
    bridge = make_bridge(FakeHalRuntime())
    with pytest.raises(PinWriteRejected) as excinfo:
        bridge.request_write(PLASMAC_COMPONENT, name, 1)
    assert excinfo.value.code == "pin_not_writable"


def test_hal_driven_pins_cannot_be_written() -> None:
    bridge = make_bridge(FakeHalRuntime())
    with pytest.raises(PinWriteRejected) as excinfo:
        bridge.request_write(PLASMAC_COMPONENT, "arc-voltage-in", 100.0)
    assert excinfo.value.code == "pin_not_writable"


def test_external_input_on_our_own_component_cannot_be_written() -> None:
    bridge = make_bridge(FakeHalRuntime())
    with pytest.raises(PinWriteRejected) as excinfo:
        bridge.request_write(QTPLASMAC_COMPONENT, "ext_abort", True)
    assert excinfo.value.code == "pin_not_writable"


def test_unknown_pin_and_component_are_rejected() -> None:
    bridge = make_bridge(FakeHalRuntime())
    with pytest.raises(PinWriteRejected) as unknown_pin:
        bridge.request_write(PLASMAC_COMPONENT, "no-such-pin", 1)
    assert unknown_pin.value.code == "unknown_pin"
    with pytest.raises(PinWriteRejected) as unknown_component:
        bridge.request_write("motion", "torch-on", 1)
    assert unknown_component.value.code == "unknown_component"


def test_setpoint_already_driven_by_hal_is_rejected() -> None:
    """On a machine that nets a parameter in HAL, writing it would fight the other writer."""
    runtime = FakeHalRuntime(written_by_hal=("plasmac.cut-feed-rate",))
    bridge = make_bridge(runtime)
    with pytest.raises(PinWriteRejected) as excinfo:
        bridge.request_write(PLASMAC_COMPONENT, "cut-feed-rate", 4000.0)
    assert excinfo.value.code == "pin_has_hal_writer"
    assert runtime.set_p_calls == []


def test_missing_setpoint_is_rejected_with_its_own_code() -> None:
    runtime = FakeHalRuntime(absent=("dry-run",))
    bridge = make_bridge(runtime)
    with pytest.raises(PinWriteRejected) as excinfo:
        bridge.request_write(PLASMAC_COMPONENT, "dry-run", True)
    assert excinfo.value.code == "pin_missing"


def test_writes_reach_hal_only_from_the_bridge_thread_pass() -> None:
    """request_write only queues; the value lands on the next bridge iteration."""
    runtime = FakeHalRuntime()
    bridge = make_bridge(runtime)

    bridge.request_write(PLASMAC_COMPONENT, "pierce-height", 3.5)
    bridge.request_write(PLASMAC_COMPONENT, "torch-enable", True)
    bridge.request_write(QTPLASMAC_COMPONENT, "laser_on", True)
    assert runtime.set_p_calls == []

    bridge._apply_pending_writes()

    assert ("plasmac.pierce-height", "3.5") in runtime.set_p_calls
    assert ("plasmac.torch-enable", "1") in runtime.set_p_calls
    # our own pins are assigned, not set_p'd
    assert runtime.components[QTPLASMAC_COMPONENT].values["laser_on"] is True


@pytest.mark.parametrize(
    ("name", "value", "expected"),
    [
        ("torch-enable", True, "1"),
        ("torch-enable", False, "0"),
        ("torch-enable", "on", "1"),
        ("torch-enable", 0, "0"),
        ("pierce-height", 3, "3.0"),
        ("pierce-height", "2.5", "2.5"),
        ("mode", 2, "2"),
        ("mode", 2.0, "2"),
    ],
)
def test_hal_value_formatting_matches_pin_type(name: str, value: Any, expected: str) -> None:
    assert format_hal_value(plasmac_pin(name), value) == expected


def test_bit_output_on_own_component_is_assigned_as_bool() -> None:
    runtime = FakeHalRuntime()
    bridge = make_bridge(runtime)
    bridge.request_write(QTPLASMAC_COMPONENT, "thc_feed_rate", 1234.5)
    bridge._apply_pending_writes()
    values = runtime.components[QTPLASMAC_COMPONENT].values
    assert values["thc_feed_rate"] == 1234.5
    assert qtplasmac_pin("thc_feed_rate").type == "float"


def test_start_stop_runs_the_thread_and_polls() -> None:
    runtime = FakeHalRuntime()
    bridge = make_bridge(runtime, poll_interval_s=0.005)
    bridge.start()
    try:
        _wait_until(lambda: bool(bridge.snapshot()[PLASMAC_COMPONENT]))
        assert bridge.snapshot()[PLASMAC_COMPONENT], "bridge thread never produced a snapshot"

        bridge.request_write(PLASMAC_COMPONENT, "cut-height", 1.5)
        _wait_until(lambda: ("plasmac.cut-height", "1.5") in runtime.set_p_calls)
        assert ("plasmac.cut-height", "1.5") in runtime.set_p_calls
    finally:
        bridge.stop()
    assert bridge._thread is None


def test_failing_write_does_not_kill_the_loop() -> None:
    class BrokenRuntime(FakeHalRuntime):
        def set_p(self, name: str, value: str) -> None:
            raise RuntimeError("HAL says no")

    runtime = BrokenRuntime()
    bridge = make_bridge(runtime)
    bridge.request_write(PLASMAC_COMPONENT, "cut-height", 1.5)
    bridge._apply_pending_writes()  # must not raise
    assert bridge.poll_once() != {}


def test_rising_edges_only_reports_false_to_true() -> None:
    previous = {"ext_pause": False, "ext_run": True, "ext_abort": False}
    current = {"ext_pause": True, "ext_run": True, "ext_abort": False}
    names = ("ext_pause", "ext_run", "ext_abort", "ext_probe")
    assert rising_edges(previous, current, names) == ("ext_pause",)
    assert rising_edges(current, previous, names) == ()


def test_apply_nets_recreates_the_links_qtplasmac_makes() -> None:
    """The axis limits are the load-bearing ones: at 0 every probe fails."""
    runtime = FakeHalRuntime()
    bridge = make_bridge(runtime)

    skipped = bridge.apply_nets()

    assert runtime.links["plasmac.axis-z-min-limit"] == "plasmac:axis-z-min-limit"
    assert runtime.links["ini.z.min_limit"] == "plasmac:axis-z-min-limit"
    assert runtime.links["qtplasmac.plasmac_state"] == "plasmac:state"
    assert runtime.links["plasmac.state-out"] == "plasmac:state"
    assert runtime.signals["plasmac:axis-z-min-limit"] == "float"
    assert runtime.signals["plasmac:state"] == "s32"
    assert skipped == ()


def test_apply_nets_joins_a_signal_that_already_exists() -> None:
    runtime = FakeHalRuntime()
    runtime.signals["plasmac:state"] = "s32"
    bridge = make_bridge(runtime)

    bridge.apply_nets()

    assert runtime.links["qtplasmac.plasmac_state"] == "plasmac:state"


def test_apply_nets_leaves_pins_the_machine_already_wired_alone() -> None:
    """A config may net these itself; its wiring wins and we carry on."""
    runtime = FakeHalRuntime()
    bridge = make_bridge(runtime)
    runtime.links["plasmac.feed-upm"] = "some-machine-signal"

    skipped = bridge.apply_nets()

    assert runtime.links["plasmac.feed-upm"] == "some-machine-signal"
    assert "plasmac.feed-upm" in skipped
    assert runtime.links["plasmac.axis-z-min-limit"] == "plasmac:axis-z-min-limit"


def test_apply_nets_skips_pins_this_linuxcnc_does_not_have() -> None:
    runtime = FakeHalRuntime()
    del runtime.extra_pins["ini.z.max_limit"]
    bridge = make_bridge(runtime)

    skipped = bridge.apply_nets()

    assert "ini.z.max_limit" in skipped
    assert runtime.links["plasmac.axis-z-max-limit"] == "plasmac:axis-z-max-limit"


def test_apply_nets_requires_ready() -> None:
    bridge = HalBridge(FakeHalRuntime())
    bridge.create_component()
    with pytest.raises(RuntimeError):
        bridge.apply_nets()


def test_apply_startup_values_sets_our_own_output_pins() -> None:
    """gcode_scale at 0 makes plasmac's requested feed rate infinite, so the THC never runs."""
    runtime = FakeHalRuntime()
    bridge = make_bridge(runtime)

    failed = bridge.apply_startup_values({"gcode_scale": 1.0, "thc_feed_rate": 3600.0})

    own = runtime.components[QTPLASMAC_COMPONENT]
    assert own.values["gcode_scale"] == 1.0
    assert own.values["thc_feed_rate"] == 3600.0
    assert failed == ()


def test_apply_startup_values_reports_pins_it_cannot_set() -> None:
    runtime = FakeHalRuntime()
    bridge = make_bridge(runtime)

    failed = bridge.apply_startup_values({"not_a_pin": 1.0, "ext_abort": True})

    assert set(failed) == {"not_a_pin", "ext_abort"}


def test_apply_startup_values_requires_ready() -> None:
    bridge = HalBridge(FakeHalRuntime())
    bridge.create_component()
    with pytest.raises(RuntimeError):
        bridge.apply_startup_values({"gcode_scale": 1.0})


def test_a_pending_write_error_wakes_the_publisher_without_a_diff() -> None:
    """The publisher only ever hears from the bridge on change, so errors must count as one."""
    runtime = FakeHalRuntime()
    bridge = make_bridge(runtime)
    bridge.poll_once()  # settle, so a second poll produces no diff
    seen = []
    bridge._on_change = lambda snapshot, diff: seen.append(diff)

    bridge.poll_once()
    assert seen == []

    bridge._write_errors.append("motion.digital-out-00: pin is not writable")
    bridge.poll_once()
    assert seen == [{}]
