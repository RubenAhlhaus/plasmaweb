"""Service-layer tests: UI intents must land on the right pins, and only those."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

import pytest

from backend.plasma.hal_bridge import PinWriteRejected
from backend.plasma.service import ENABLE_PINS, PlasmaService
from backend.plasma.pins import PLASMAC_COMPONENT, QTPLASMAC_COMPONENT
from backend.tests.test_plasma_hal_bridge import FakeHalRuntime, make_bridge


def build(**runtime_kwargs: Any) -> Tuple[PlasmaService, FakeHalRuntime, Any]:
    runtime = FakeHalRuntime(**runtime_kwargs)
    bridge = make_bridge(runtime)
    bridge.poll_once()
    return PlasmaService(bridge), runtime, bridge


def applied(bridge: Any, runtime: FakeHalRuntime) -> List[Tuple[str, str]]:
    bridge._apply_pending_writes()
    return runtime.set_p_calls


def test_snapshot_payload_carries_pins_state_and_missing() -> None:
    service, runtime, bridge = build(absent=("dry-run",), plasmac_values={"state-out": 11, "stop-type-out": 3})
    bridge.poll_once()

    payload = service.snapshot_payload()
    assert payload["pins"][PLASMAC_COMPONENT]["state-out"] == 11
    assert payload["state"]["stateName"] == "CUT_MODE_01"
    assert payload["state"]["stopTypeName"] == "PAUSE"
    assert payload["state"]["isCutting"] is True
    assert payload["missingPins"] == ["plasmac.dry-run"]


def test_set_param_writes_setpoints() -> None:
    service, runtime, bridge = build()
    service.set_param("pierce-height", 3.2)
    assert ("plasmac.pierce-height", "3.2") in applied(bridge, runtime)


@pytest.mark.parametrize("name", ["torch-on", "state-out", "arc-voltage-in", "units-per-mm"])
def test_set_param_refuses_pins_we_do_not_own(name: str) -> None:
    service, runtime, bridge = build()
    with pytest.raises(PinWriteRejected) as excinfo:
        service.set_param(name, 1)
    assert excinfo.value.code == "pin_not_writable"
    assert applied(bridge, runtime) == []


def test_set_param_unknown_pin_raises_key_error() -> None:
    service, _, _ = build()
    with pytest.raises(KeyError):
        service.set_param("no-such-pin", 1)


@pytest.mark.parametrize(("key", "pin"), sorted(ENABLE_PINS.items()))
def test_every_named_toggle_maps_to_a_real_setpoint(key: str, pin: str) -> None:
    service, runtime, bridge = build()
    assert service.set_enable(key, True) == pin
    assert (f"plasmac.{pin}", "1") in applied(bridge, runtime)


def test_unknown_toggle_is_rejected_by_name() -> None:
    service, _, _ = build()
    with pytest.raises(PinWriteRejected) as excinfo:
        service.set_enable("definitely-not-a-toggle", True)
    assert excinfo.value.code == "unknown_enable"


def test_torch_and_thc_enable_and_height_override() -> None:
    service, runtime, bridge = build()
    service.torch_enable(True)
    service.thc_enable(False)
    service.height_override(-2.5)
    calls = applied(bridge, runtime)
    assert ("plasmac.torch-enable", "1") in calls
    assert ("plasmac.thc-enable", "0") in calls
    assert ("plasmac.height-override", "-2.5") in calls


def test_torch_pulse_press_follows_the_qtplasmac_protocol() -> None:
    service, runtime, bridge = build()
    action, skipped = service.torch_pulse("press", seconds=1.5)
    assert action == "press"
    assert skipped == []
    calls = applied(bridge, runtime)
    assert ("plasmac.torch-pulse-time", "1.5") in calls
    assert ("plasmac.torch-pulse-start", "1") in calls
    assert ("plasmac.torch-pulse-hold", "1") in calls


def test_torch_pulse_release_and_abort() -> None:
    service, runtime, bridge = build()
    service.torch_pulse("release")
    calls = applied(bridge, runtime)
    assert ("plasmac.torch-pulse-start", "0") in calls
    assert ("plasmac.torch-pulse-hold", "0") in calls

    runtime.set_p_calls.clear()
    service.torch_pulse("abort")
    service.clear_torch_pulse_abort()
    calls = applied(bridge, runtime)
    assert calls.count(("plasmac.torch-pulse-abort", "1")) == 1
    assert calls.count(("plasmac.torch-pulse-abort", "0")) == 1
    assert ("plasmac.torch-pulse-start", "0") in calls


def test_torch_pulse_is_refused_while_the_torch_is_on() -> None:
    """plasmac owns the torch; a pulse over a live cut is what its interlock exists for."""
    service, runtime, bridge = build(plasmac_values={"torch-on": True})
    bridge.poll_once()
    with pytest.raises(PinWriteRejected) as excinfo:
        service.torch_pulse("press", seconds=1.0)
    assert excinfo.value.code == "torch_already_on"
    assert applied(bridge, runtime) == []


def test_torch_pulse_still_works_without_the_2_10_only_pins() -> None:
    """LinuxCNC 2.9.x has no torch-pulse-hold/abort — the pulse must still start."""
    service, runtime, bridge = build(absent=("torch-pulse-hold", "torch-pulse-abort"))
    bridge.poll_once()

    action, skipped = service.torch_pulse("press", seconds=1.0)
    assert action == "press"
    assert skipped == ["plasmac.torch-pulse-hold"]
    calls = applied(bridge, runtime)
    assert ("plasmac.torch-pulse-start", "1") in calls
    assert not any(name == "plasmac.torch-pulse-hold" for name, _ in calls)

    runtime.set_p_calls.clear()
    _, skipped_abort = service.torch_pulse("abort")
    assert skipped_abort == ["plasmac.torch-pulse-abort", "plasmac.torch-pulse-hold"]
    assert ("plasmac.torch-pulse-start", "0") in applied(bridge, runtime)


def test_invalid_torch_pulse_action_is_rejected() -> None:
    service, _, _ = build()
    with pytest.raises(PinWriteRejected) as excinfo:
        service.torch_pulse("wiggle")
    assert excinfo.value.code == "invalid_action"


def test_own_outputs_are_written_on_our_component() -> None:
    service, runtime, bridge = build()
    service.set_own_output("laser-on", True)
    bridge._apply_pending_writes()
    assert runtime.components[QTPLASMAC_COMPONENT].values["laser-on"] is True
