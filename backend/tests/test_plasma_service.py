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
    # Our own pin, not plasmac's: the two are netted, so plasmac's already has a writer.
    assert runtime.components[QTPLASMAC_COMPONENT].values["height_override"] == -2.5
    assert not any(call[0] == "plasmac.height-override" for call in calls)


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
    service.set_own_output("laser_on", True)
    bridge._apply_pending_writes()
    assert runtime.components[QTPLASMAC_COMPONENT].values["laser_on"] is True


# ---- probing, cut recovery and consumables ------------------------------------------


def test_a_probe_test_raises_the_pin_and_reports_its_time() -> None:
    service, runtime, bridge = build()

    seconds = service.probe_test(5.0)
    applied(bridge, runtime)

    assert seconds == 5.0
    assert ("plasmac.probe-test", "1") in runtime.set_p_calls


def test_a_probe_test_is_refused_while_the_torch_is_on() -> None:
    service, runtime, bridge = build(plasmac_values={"torch-on": True})
    bridge.poll_once()

    with pytest.raises(PinWriteRejected) as excinfo:
        service.probe_test(5.0)

    assert excinfo.value.code == "torch_already_on"


def test_a_probe_test_needs_a_time() -> None:
    service, _runtime, bridge = build()

    with pytest.raises(PinWriteRejected) as excinfo:
        service.probe_test(0)

    assert excinfo.value.code == "invalid_params"


def test_stopping_the_probe_test_lowers_the_pin() -> None:
    service, runtime, bridge = build()

    service.probe_test_stop()
    applied(bridge, runtime)

    assert ("plasmac.probe-test", "0") in runtime.set_p_calls


def test_the_ohmic_test_follows_the_button() -> None:
    service, runtime, bridge = build()

    service.ohmic_test(True)
    service.ohmic_test(False)
    applied(bridge, runtime)

    assert ("plasmac.ohmic-test", "1") in runtime.set_p_calls
    assert ("plasmac.ohmic-test", "0") in runtime.set_p_calls


def test_cut_recovery_moves_along_the_path_at_a_share_of_the_cut_feed() -> None:
    service, runtime, bridge = build()

    service.cut_recovery_move(-1, 50.0)
    applied(bridge, runtime)

    written = dict(runtime.set_p_calls)
    assert float(written["plasmac.paused-motion-speed"]) == -0.5
    # The recovery stays armed when motion stops, as it does upstream.
    assert written["plasmac.cut-recovery"] == "1"


def test_stopping_the_recovery_motion_keeps_it_armed() -> None:
    service, runtime, bridge = build()

    service.cut_recovery_move(0, 100.0)
    applied(bridge, runtime)

    written = dict(runtime.set_p_calls)
    assert float(written["plasmac.paused-motion-speed"]) == 0.0
    assert written["plasmac.cut-recovery"] == "1"


def test_a_bad_recovery_direction_is_refused() -> None:
    service, _runtime, bridge = build()

    with pytest.raises(PinWriteRejected) as excinfo:
        service.cut_recovery_move(2, 100.0)

    assert excinfo.value.code == "invalid_params"


def test_cut_recovery_offsets_the_torch_in_whole_kerf_widths() -> None:
    """x-offset and y-offset are counts of plasmac.offset-scale, not millimetres."""
    service, runtime, bridge = build(plasmac_values={"offset-scale": 0.1, "x-offset": 5, "y-offset": 0})
    bridge.poll_once()

    counts = service.cut_recovery_offset(1, -1, 1.5)
    applied(bridge, runtime)

    assert counts == (15, -15)
    written = dict(runtime.set_p_calls)
    assert written["plasmac.x-offset"] == "20"  # 5 already there, plus 15
    assert written["plasmac.y-offset"] == "-15"
    assert written["plasmac.cut-recovery"] == "1"


def test_an_offset_is_refused_when_the_machine_reports_no_scale() -> None:
    service, _runtime, bridge = build(plasmac_values={"offset-scale": 0.0})
    bridge.poll_once()

    with pytest.raises(PinWriteRejected) as excinfo:
        service.cut_recovery_offset(1, 0, 1.5)

    assert excinfo.value.code == "offset_scale_unavailable"


def test_cancelling_the_recovery_puts_everything_back() -> None:
    service, runtime, bridge = build()

    service.cut_recovery_cancel()
    applied(bridge, runtime)

    written = dict(runtime.set_p_calls)
    assert written["plasmac.cut-recovery"] == "0"
    assert written["plasmac.x-offset"] == "0"
    assert written["plasmac.y-offset"] == "0"
    assert float(written["plasmac.paused-motion-speed"]) == 0.0


def test_a_consumable_change_is_a_plain_toggle() -> None:
    service, runtime, bridge = build()

    service.consumable_change(True)
    applied(bridge, runtime)

    assert ("plasmac.consumable-change", "1") in runtime.set_p_calls


# ---- laser cut recovery ---------------------------------------------------------------


def test_laser_recovery_offsets_the_axes_by_the_laser_offset() -> None:
    """Restarting a cut means seeing where it stopped, and the torch is in the way."""
    service, runtime, bridge = build(plasmac_values={"offset-scale": 0.001})
    bridge.poll_once()

    counts = service.laser_recovery(-25.0, 10.0)
    bridge._apply_pending_writes()
    written = dict(runtime.set_p_calls)

    assert counts == (-25000, 10000)
    assert written["plasmac.laser-x-offset"] == "-25000"
    assert written["plasmac.laser-y-offset"] == "10000"
    assert written["plasmac.laser-recovery-start"] == "1"
    assert written["plasmac.cut-recovery"] == "1"


def test_laser_recovery_needs_a_laser_offset_to_offset_by() -> None:
    service, _runtime, bridge = build(plasmac_values={"offset-scale": 0.001})
    bridge.poll_once()

    with pytest.raises(PinWriteRejected) as excinfo:
        service.laser_recovery(0.0, 0.0)
    assert excinfo.value.code == "no_laser_offset"


def test_laser_recovery_refuses_when_the_machine_cannot_offset() -> None:
    """An offset scale of zero would divide by nothing; the pad refuses the same way."""
    service, _runtime, bridge = build(plasmac_values={"offset-scale": 0.0})
    bridge.poll_once()

    with pytest.raises(PinWriteRejected) as excinfo:
        service.laser_recovery(-25.0, 0.0)
    assert excinfo.value.code == "offset_scale_unavailable"


def test_the_start_request_is_dropped_once_plasmac_has_acted() -> None:
    """It is a request, not a state: left raised it re-arms on the next pause."""
    service, runtime, bridge = build()
    bridge.poll_once()

    service.laser_recovery_started()
    bridge._apply_pending_writes()

    assert dict(runtime.set_p_calls)["plasmac.laser-recovery-start"] == "0"


def test_cancelling_a_recovery_also_drops_the_laser_request() -> None:
    service, runtime, bridge = build()
    bridge.poll_once()

    service.cut_recovery_cancel()
    bridge._apply_pending_writes()
    written = dict(runtime.set_p_calls)

    assert written["plasmac.cut-recovery"] == "0"
    assert written["plasmac.laser-recovery-start"] == "0"


# ---- PowerMax RS485 -------------------------------------------------------------------


def test_the_powermax_setpoints_go_out_before_the_enable() -> None:
    """The first thing the component reads has to be a valid setpoint, not a stale one."""
    service, runtime, bridge = build()

    service.powermax_enable(True, cut_mode=1.0, cut_amps=45.0, pressure=4.5)
    bridge._apply_pending_writes()
    own = runtime.components["qtplasmac"].values

    assert own["pmx485_mode_set"] == 1.0
    assert own["pmx485_current_set"] == 45.0
    assert own["pmx485_pressure_set"] == 4.5
    assert own["pmx485_enable"] is True


def test_connecting_without_a_cut_mode_or_current_is_refused() -> None:
    """The supply would be commanded to nothing, which is worse than not commanding it."""
    service, _runtime, _bridge = build()

    with pytest.raises(PinWriteRejected) as excinfo:
        service.powermax_enable(True, cut_mode=0.0, cut_amps=45.0)
    assert excinfo.value.code == "invalid_setpoints"

    with pytest.raises(PinWriteRejected):
        service.powermax_enable(True, cut_mode=1.0, cut_amps=0.0)


def test_disconnecting_needs_no_setpoints() -> None:
    service, runtime, bridge = build()

    service.powermax_enable(False)
    bridge._apply_pending_writes()

    assert runtime.components["qtplasmac"].values["pmx485_enable"] is False


def test_the_powermax_status_reads_the_supplys_own_pins() -> None:
    service, runtime, bridge = build()
    own = runtime.components["qtplasmac"].values
    own.update(
        {
            "pmx485_status": True,
            "pmx485_current": 45.0,
            "pmx485_current_max": 125.0,
            "pmx485_pressure": 72.0,
            "pmx485_pressure_max": 120.0,
            "pmx485_arc_time": 3600.0,
            "pmx485_fault": 210.0,
        }
    )
    bridge.poll_once()

    status = service.powermax_status()

    assert status["connected"] is True
    assert status["current"] == 45.0
    assert status["pressureUnit"] == "psi"  # over 15, so the supply is reporting psi
    # 0210 above 110 A is the arc voltage fault, not the gas one.
    assert status["fault"]["name"] == "Excessive arc voltage"
    assert status["fault"]["code"] == "0-21-0"


def test_a_healthy_supply_reports_no_fault_at_all() -> None:
    service, runtime, bridge = build()
    runtime.components["qtplasmac"].values.update(
        {"pmx485_status": True, "pmx485_fault": 0.0}
    )
    bridge.poll_once()

    assert service.powermax_status()["fault"] is None
