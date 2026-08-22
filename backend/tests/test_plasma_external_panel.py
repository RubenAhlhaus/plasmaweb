"""The machine's own buttons: ``qtplasmac.ext_*`` edges must do what the screen does."""

from __future__ import annotations

from typing import Any, Dict, List

import pytest

from backend.plasma.external_panel import EXTERNAL_EVENT, ExternalPanel
from backend.plasma.hal_bridge import PinWriteRejected
from backend.plasma.pins import PLASMAC_COMPONENT, QTPLASMAC_COMPONENT
from backend.plasma.service import PlasmaService
from backend.tests.test_plasma_hal_bridge import FakeHalRuntime, make_bridge


class FakeResult:
    def __init__(self, ok: bool = True, code: str = "", message: str = "") -> None:
        self.ok = ok
        self.error_code = code
        self.error_message = message


class FakeGateway:
    def __init__(self, ok: bool = True) -> None:
        self.calls: List[Any] = []
        self.ok = ok

    def program_auto(self, subcommand: str, start_line: int = 0) -> FakeResult:
        self.calls.append(("auto", subcommand))
        return FakeResult(self.ok, "not_idle", "the interpreter is busy")

    def abort_program(self) -> FakeResult:
        self.calls.append(("abort",))
        return FakeResult(self.ok)


def build(**plasmac_values: Any):
    runtime = FakeHalRuntime(plasmac_values=plasmac_values or None)
    bridge = make_bridge(runtime)
    bridge.poll_once()
    service = PlasmaService(bridge)
    gateway = FakeGateway()
    return ExternalPanel(service, gateway), bridge, runtime, gateway


def press(panel: ExternalPanel, pin: str, value: Any = True) -> List[Any]:
    return panel.observe({QTPLASMAC_COMPONENT: {pin: value}})


def written(bridge: Any, runtime: FakeHalRuntime) -> Dict[str, str]:
    bridge._apply_pending_writes()
    return dict(runtime.set_p_calls)


def test_a_torch_enable_button_toggles_rather_than_following_the_switch() -> None:
    """A latching switch following its own level would fight the on-screen control."""
    panel, bridge, runtime, _gateway = build(**{"torch-enable": False})

    press(panel, "ext_torch_enable")

    assert written(bridge, runtime)["plasmac.torch-enable"] == "1"


def test_the_same_button_turns_it_off_again() -> None:
    panel, bridge, runtime, _gateway = build(**{"torch-enable": True})

    press(panel, "ext_torch_enable")

    assert written(bridge, runtime)["plasmac.torch-enable"] == "0"


def test_releasing_a_toggle_button_does_nothing() -> None:
    panel, bridge, runtime, _gateway = build(**{"thc-enable": True})

    press(panel, "ext_thc_enable", False)
    bridge._apply_pending_writes()

    assert not any(call[0] == "plasmac.thc-enable" for call in runtime.set_p_calls)


@pytest.mark.parametrize(
    "pin,expected",
    [
        ("ext_thc_enable", "plasmac.thc-enable"),
        ("ext_cornerlock_enable", "plasmac.cornerlock-enable"),
        ("ext_voidlock_enable", "plasmac.voidlock-enable"),
        ("ext_auto_volts_enable", "plasmac.use-auto-volts"),
        ("ext_mesh_mode", "plasmac.mesh-enable"),
        ("ext_ohmic_probe_enable", "plasmac.ohmic-probe-enable"),
        ("ext_ignore_arc_ok", "plasmac.ignore-arc-ok-1"),
    ],
)
def test_every_toggle_button_reaches_its_pin(pin: str, expected: str) -> None:
    panel, bridge, runtime, _gateway = build()

    press(panel, pin)

    assert expected in written(bridge, runtime)


def test_the_pulse_button_follows_press_and_release() -> None:
    panel, bridge, runtime, _gateway = build()

    press(panel, "ext_pulse", True)
    press(panel, "ext_pulse", False)
    values = written(bridge, runtime)

    assert values["plasmac.torch-pulse-start"] == "0"  # last write is the release
    assert any(
        call == ("plasmac.torch-pulse-start", "1") for call in runtime.set_p_calls
    )


def test_the_ohmic_button_follows_the_button() -> None:
    panel, bridge, runtime, _gateway = build()

    press(panel, "ext_ohmic", True)
    assert written(bridge, runtime)["plasmac.ohmic-test"] == "1"

    press(panel, "ext_ohmic", False)
    assert written(bridge, runtime)["plasmac.ohmic-test"] == "0"


def test_a_recovery_arrow_moves_one_kerf_width() -> None:
    panel, bridge, runtime, _gateway = build(**{"offset-scale": 0.1, "x-offset": 0, "y-offset": 0})
    bridge.poll_once()

    press(panel, "ext_cutrec_ne")
    values = written(bridge, runtime)

    assert values["plasmac.x-offset"] == "10"  # 1 mm default kerf / 0.1 scale
    assert values["plasmac.y-offset"] == "10"
    assert values["plasmac.cut-recovery"] == "1"


def test_the_recovery_forward_button_runs_while_held() -> None:
    panel, bridge, runtime, _gateway = build()

    press(panel, "ext_cutrec_fwd", True)
    assert float(written(bridge, runtime)["plasmac.paused-motion-speed"]) == 1.0

    press(panel, "ext_cutrec_fwd", False)
    assert float(written(bridge, runtime)["plasmac.paused-motion-speed"]) == 0.0


def test_the_recovery_cancel_button_gives_up() -> None:
    panel, bridge, runtime, _gateway = build()

    press(panel, "ext_cutrec_cancel")

    assert written(bridge, runtime)["plasmac.cut-recovery"] == "0"


def test_the_height_override_buttons_step_and_reset() -> None:
    panel, bridge, runtime, _gateway = build()

    def override() -> float:
        bridge._apply_pending_writes()
        return runtime.components[QTPLASMAC_COMPONENT].values["height_override"]

    press(panel, "ext_height_ovr_plus")
    press(panel, "ext_height_ovr_plus")
    assert override() == 2.0

    press(panel, "ext_height_ovr_minus")
    assert override() == 1.0

    press(panel, "ext_height_ovr_reset")
    assert override() == 0.0


def test_run_pause_abort_reach_the_gateway() -> None:
    panel, _bridge, _runtime, gateway = build()

    press(panel, "ext_run")
    press(panel, "ext_pause")
    press(panel, "ext_resume")
    press(panel, "ext_abort")

    assert gateway.calls == [("auto", "run"), ("auto", "pause"), ("auto", "resume"), ("abort",)]


def test_one_button_for_run_and_pause_reads_the_machine() -> None:
    """`ext_run_pause` is one physical button; what it does depends on what the machine is doing."""
    panel, _bridge, _runtime, gateway = build(**{"program-is-running": True})
    panel._service.bridge.poll_once()

    press(panel, "ext_run_pause")

    assert gateway.calls == [("auto", "pause")]


def test_a_paused_program_resumes_from_the_same_button() -> None:
    panel, _bridge, _runtime, gateway = build(
        **{"program-is-running": True, "program-is-paused": True}
    )
    panel._service.bridge.poll_once()

    press(panel, "ext_run_pause")

    assert gateway.calls == [("auto", "resume")]


def test_a_refused_command_is_reported_because_someone_pressed_a_real_button() -> None:
    runtime = FakeHalRuntime()
    bridge = make_bridge(runtime)
    bridge.poll_once()
    panel = ExternalPanel(PlasmaService(bridge), FakeGateway(ok=False))

    events = press(panel, "ext_run")

    assert events[0][0] == EXTERNAL_EVENT
    assert events[0][1]["code"] == "not_idle"
    assert events[0][1]["pin"] == "ext_run"


def test_a_refused_pin_write_is_reported_too() -> None:
    panel, bridge, _runtime, _gateway = build(**{"torch-on": True})
    bridge.poll_once()

    events = press(panel, "ext_pulse", True)

    assert events[0][1]["code"] == "torch_already_on"


def test_an_unsupported_button_says_so_once() -> None:
    """A wired button that does nothing is worse than one that says it does nothing."""
    panel, _bridge, _runtime, _gateway = build()

    first = press(panel, "ext_frame_job")
    second = press(panel, "ext_frame_job")

    assert first[0][1]["code"] == "external_pin_unsupported"
    assert second == []


def test_pins_from_the_other_component_are_ignored() -> None:
    panel, bridge, runtime, gateway = build()

    panel.observe({PLASMAC_COMPONENT: {"torch-on": True}})
    bridge._apply_pending_writes()

    assert runtime.set_p_calls == []
    assert gateway.calls == []
