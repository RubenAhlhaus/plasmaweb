"""Command-handler tests for the ``plasma`` category."""

from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

from backend.application.context import AppContext
from backend.contracts.messages import CommandEnvelope
from backend.handlers.plasma import (
    handle_plasma_get_snapshot,
    handle_plasma_height_override,
    handle_plasma_set_enable,
    handle_plasma_set_param,
    handle_plasma_thc_enable,
    handle_plasma_torch_enable,
    handle_plasma_torch_pulse,
)
from backend.plasma.pins import PLASMAC_COMPONENT
from backend.plasma.service import PlasmaService
from backend.tests.test_plasma_hal_bridge import FakeHalRuntime, make_bridge
from backend.tests.test_plasma_publisher import FakeManager


def build_ctx(plasma: bool = True, **runtime_kwargs: Any):
    runtime = FakeHalRuntime(**runtime_kwargs)
    bridge = make_bridge(runtime)
    bridge.poll_once()
    service = PlasmaService(bridge) if plasma else None
    ctx = AppContext(manager=FakeManager(), gateway=object(), plasma=service)
    return ctx, runtime, bridge


def command(action: str, params: Optional[Dict[str, Any]] = None) -> CommandEnvelope:
    return CommandEnvelope(
        type="command",
        commandId=f"test-{action}",
        category="plasma",
        action=action,
        params=params or {},
    )


def run(handler, cmd: CommandEnvelope, ctx: AppContext):
    return asyncio.run(handler(cmd, ctx))


def applied(bridge, runtime):
    bridge._apply_pending_writes()
    return runtime.set_p_calls


def test_get_snapshot_returns_pins_state_and_missing() -> None:
    ctx, _, bridge = build_ctx(absent=("dry-run",))
    result = run(handle_plasma_get_snapshot, command("get_snapshot"), ctx)

    assert result.ack.ok is True
    assert result.ack.result["state"]["stateName"] == "IDLE"
    assert result.ack.result["missingPins"] == ["plasmac.dry-run"]
    assert "torch-on" in result.ack.result["pins"][PLASMAC_COMPONENT]


def test_every_plasma_command_reports_plasma_unavailable_without_hal() -> None:
    """On macOS/CI there is no HAL; the commands must answer, not crash."""
    ctx, _, _ = build_ctx(plasma=False)
    cases = [
        (handle_plasma_get_snapshot, command("get_snapshot")),
        (handle_plasma_set_param, command("set_param", {"pin": "cut-height", "value": 1})),
        (handle_plasma_set_enable, command("set_enable", {"name": "thc", "enabled": True})),
        (handle_plasma_torch_enable, command("torch_enable", {"enabled": True})),
        (handle_plasma_thc_enable, command("thc_enable", {"enabled": True})),
        (handle_plasma_height_override, command("height_override", {"volts": 1.0})),
        (handle_plasma_torch_pulse, command("torch_pulse", {"action": "press"})),
    ]
    for handler, cmd in cases:
        result = run(handler, cmd, ctx)
        assert result.ack.ok is False
        assert result.ack.error.code == "plasma_unavailable"


def test_set_param_writes_and_acks() -> None:
    ctx, runtime, bridge = build_ctx()
    result = run(
        handle_plasma_set_param,
        command("set_param", {"pin": "pierce-height", "value": 4.2}),
        ctx,
    )
    assert result.ack.ok is True
    assert result.ack.result == {"pin": "pierce-height"}
    assert ("plasmac.pierce-height", "4.2") in applied(bridge, runtime)


def test_set_param_rejects_realtime_owned_pins() -> None:
    ctx, runtime, bridge = build_ctx()
    result = run(
        handle_plasma_set_param, command("set_param", {"pin": "torch-on", "value": 1}), ctx
    )
    assert result.ack.ok is False
    assert result.ack.error.code == "pin_not_writable"
    assert applied(bridge, runtime) == []


def test_set_param_reports_unknown_pins_and_bad_values() -> None:
    ctx, _, _ = build_ctx()
    unknown = run(
        handle_plasma_set_param, command("set_param", {"pin": "nope", "value": 1}), ctx
    )
    assert unknown.ack.error.code == "unknown_pin"

    bad_value = run(
        handle_plasma_set_param,
        command("set_param", {"pin": "pierce-height", "value": "not-a-number"}),
        ctx,
    )
    assert bad_value.ack.error.code == "invalid_value"


def test_invalid_params_are_reported_per_command() -> None:
    ctx, _, _ = build_ctx()
    cases = [
        (handle_plasma_set_param, command("set_param", {"value": 1})),
        (handle_plasma_set_enable, command("set_enable", {"name": "thc"})),
        (handle_plasma_torch_enable, command("torch_enable", {"enabled": "yes-please"})),
        (handle_plasma_height_override, command("height_override", {"volts": "high"})),
        (handle_plasma_torch_pulse, command("torch_pulse", {})),
    ]
    for handler, cmd in cases:
        result = run(handler, cmd, ctx)
        assert result.ack.ok is False
        assert result.ack.error.code == "invalid_params"


def test_set_enable_maps_names_to_pins() -> None:
    ctx, runtime, bridge = build_ctx()
    result = run(
        handle_plasma_set_enable, command("set_enable", {"name": "cornerlock", "enabled": True}), ctx
    )
    assert result.ack.result == {"pin": "cornerlock-enable"}
    assert ("plasmac.cornerlock-enable", "1") in applied(bridge, runtime)

    unknown = run(
        handle_plasma_set_enable, command("set_enable", {"name": "nope", "enabled": True}), ctx
    )
    assert unknown.ack.error.code == "unknown_enable"


def test_torch_and_thc_enable_and_height_override_write_their_pins() -> None:
    ctx, runtime, bridge = build_ctx()
    run(handle_plasma_torch_enable, command("torch_enable", {"enabled": True}), ctx)
    run(handle_plasma_thc_enable, command("thc_enable", {"enabled": False}), ctx)
    run(handle_plasma_height_override, command("height_override", {"volts": 1.5}), ctx)

    calls = applied(bridge, runtime)
    assert ("plasmac.torch-enable", "1") in calls
    assert ("plasmac.thc-enable", "0") in calls
    assert ("plasmac.height-override", "1.5") in calls


def test_torch_pulse_press_and_release() -> None:
    ctx, runtime, bridge = build_ctx()
    press = run(
        handle_plasma_torch_pulse, command("torch_pulse", {"action": "press", "seconds": 0.5}), ctx
    )
    assert press.ack.ok is True
    assert press.ack.result == {"action": "press", "skippedPins": []}
    calls = applied(bridge, runtime)
    assert ("plasmac.torch-pulse-time", "0.5") in calls
    assert ("plasmac.torch-pulse-start", "1") in calls

    runtime.set_p_calls.clear()
    run(handle_plasma_torch_pulse, command("torch_pulse", {"action": "release"}), ctx)
    assert ("plasmac.torch-pulse-start", "0") in applied(bridge, runtime)


def test_torch_pulse_abort_releases_the_abort_pin_afterwards() -> None:
    ctx, runtime, bridge = build_ctx()

    async def _run() -> None:
        result = await handle_plasma_torch_pulse(
            command("torch_pulse", {"action": "abort"}), ctx
        )
        assert result.ack.ok is True
        # the release is scheduled, not awaited, so the ack is not delayed by it
        await asyncio.sleep(0.15)

    asyncio.run(_run())
    calls = applied(bridge, runtime)
    assert ("plasmac.torch-pulse-abort", "1") in calls
    assert ("plasmac.torch-pulse-abort", "0") in calls


def test_torch_pulse_while_the_torch_is_on_is_refused() -> None:
    ctx, runtime, bridge = build_ctx(plasmac_values={"torch-on": True})
    bridge.poll_once()
    result = run(
        handle_plasma_torch_pulse, command("torch_pulse", {"action": "press"}), ctx
    )
    assert result.ack.ok is False
    assert result.ack.error.code == "torch_already_on"
    assert applied(bridge, runtime) == []


def test_torch_pulse_reports_pins_this_build_lacks() -> None:
    ctx, _, bridge = build_ctx(absent=("torch-pulse-hold",))
    bridge.poll_once()
    result = run(
        handle_plasma_torch_pulse, command("torch_pulse", {"action": "press"}), ctx
    )
    assert result.ack.ok is True
    assert result.ack.result["skippedPins"] == ["plasmac.torch-pulse-hold"]


def test_unknown_action_string_is_rejected() -> None:
    ctx, _, _ = build_ctx()
    result = run(
        handle_plasma_torch_pulse, command("torch_pulse", {"action": "wiggle"}), ctx
    )
    assert result.ack.error.code == "invalid_action"
