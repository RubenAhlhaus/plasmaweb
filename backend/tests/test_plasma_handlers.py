"""Command-handler tests for the ``plasma`` category."""

from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

from backend.application.context import AppContext
from backend.contracts.messages import CommandEnvelope
from backend.handlers.plasma import (
    handle_plasma_delete_material,
    handle_plasma_get_materials,
    handle_plasma_get_parameters,
    handle_plasma_get_snapshot,
    handle_plasma_height_override,
    handle_plasma_reload_config,
    handle_plasma_run_from_line,
    handle_plasma_save_material,
    handle_plasma_save_parameters,
    handle_plasma_select_material,
    handle_plasma_set_default_material,
    handle_plasma_set_enable,
    handle_plasma_set_param,
    handle_plasma_thc_enable,
    handle_plasma_toolpath,
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


# ---- materials and parameters -------------------------------------------------------


def build_config_ctx(tmp_path, with_config: bool = True):
    """A context whose plasma_config points at a throwaway machine config."""
    from backend.plasma.config_service import PlasmaConfigService
    from backend.plasma.machine_files import machine_files
    from backend.tests.test_plasma_config_service import CFG, INI

    (tmp_path / "machine.ini").write_text(INI)
    (tmp_path / "my_plasma_material.cfg").write_text(CFG)

    runtime = FakeHalRuntime()
    bridge = make_bridge(runtime)
    bridge.poll_once()
    config = None
    if with_config:
        files = machine_files(str(tmp_path / "machine.ini"))
        assert files is not None
        config = PlasmaConfigService(bridge, files)
        config.load()
    ctx = AppContext(
        manager=FakeManager(),
        gateway=object(),
        plasma=PlasmaService(bridge),
        plasma_config=config,
    )
    return ctx, runtime, bridge


def test_get_materials_lists_them_with_the_selection(tmp_path) -> None:
    ctx, _runtime, _bridge = build_config_ctx(tmp_path)

    result = run(handle_plasma_get_materials, command("get_materials"), ctx)

    assert result.ack.ok is True
    assert [m["number"] for m in result.ack.result["materials"]] == [0, 3]
    assert result.ack.result["selected"] == 0


def test_select_material_writes_the_setpoints(tmp_path) -> None:
    ctx, runtime, bridge = build_config_ctx(tmp_path)

    result = run(
        handle_plasma_select_material, command("select_material", {"number": 3}), ctx
    )

    assert result.ack.ok is True
    assert ("plasmac.cut-volts", "122.0") in applied(bridge, runtime)


def test_select_material_reports_an_unknown_number(tmp_path) -> None:
    ctx, _runtime, _bridge = build_config_ctx(tmp_path)

    result = run(
        handle_plasma_select_material, command("select_material", {"number": 42}), ctx
    )

    assert result.ack.ok is False
    assert result.ack.error.code == "unknown_material"


def test_save_material_stores_the_edit(tmp_path) -> None:
    ctx, _runtime, _bridge = build_config_ctx(tmp_path)

    result = run(
        handle_plasma_save_material,
        command("save_material", {"number": 3, "name": "6mm", "values": {"cutVolts": 130.0}}),
        ctx,
    )

    assert result.ack.ok is True
    assert result.ack.result["material"]["cutVolts"] == 130.0
    assert result.ack.result["material"]["name"] == "6mm"


def test_save_material_refuses_a_temporary_number(tmp_path) -> None:
    ctx, _runtime, _bridge = build_config_ctx(tmp_path)

    result = run(
        handle_plasma_save_material,
        command("save_material", {"number": 1000000, "name": "temp", "values": {}}),
        ctx,
    )

    assert result.ack.ok is False
    assert result.ack.error.code == "temporary_material"


def test_delete_material_removes_it(tmp_path) -> None:
    ctx, _runtime, _bridge = build_config_ctx(tmp_path)

    result = run(
        handle_plasma_delete_material, command("delete_material", {"number": 3}), ctx
    )
    listing = run(handle_plasma_get_materials, command("get_materials"), ctx)

    assert result.ack.ok is True
    assert [m["number"] for m in listing.ack.result["materials"]] == [0]


def test_set_default_material_is_remembered(tmp_path) -> None:
    ctx, _runtime, _bridge = build_config_ctx(tmp_path)

    result = run(
        handle_plasma_set_default_material,
        command("set_default_material", {"number": 3}),
        ctx,
    )
    listing = run(handle_plasma_get_materials, command("get_materials"), ctx)

    assert result.ack.ok is True
    assert listing.ack.result["default"] == 3


def test_get_and_save_parameters(tmp_path) -> None:
    ctx, runtime, bridge = build_config_ctx(tmp_path)

    before = run(handle_plasma_get_parameters, command("get_parameters"), ctx)
    saved = run(
        handle_plasma_save_parameters,
        command("save_parameters", {"values": {"Pid P Gain": 17.5}}),
        ctx,
    )

    assert before.ack.result["values"]["Pid P Gain"] == 10.0
    assert saved.ack.ok is True
    assert saved.ack.result["values"]["Pid P Gain"] == 17.5
    assert ("plasmac.pid-p-gain", "17.5") in applied(bridge, runtime)


def test_reload_config_returns_both_files(tmp_path) -> None:
    ctx, _runtime, _bridge = build_config_ctx(tmp_path)

    result = run(handle_plasma_reload_config, command("reload_config"), ctx)

    assert result.ack.ok is True
    assert result.ack.result["materials"]["selected"] == 0
    assert "Pid P Gain" in result.ack.result["parameters"]["values"]


def test_every_config_command_says_so_when_there_is_no_ini(tmp_path) -> None:
    ctx, _runtime, _bridge = build_config_ctx(tmp_path, with_config=False)

    for handler, action, params in (
        (handle_plasma_get_materials, "get_materials", {}),
        (handle_plasma_select_material, "select_material", {"number": 0}),
        (handle_plasma_save_material, "save_material", {"number": 0, "name": "x", "values": {}}),
        (handle_plasma_delete_material, "delete_material", {"number": 0}),
        (handle_plasma_set_default_material, "set_default_material", {"number": 0}),
        (handle_plasma_get_parameters, "get_parameters", {}),
        (handle_plasma_save_parameters, "save_parameters", {"values": {}}),
        (handle_plasma_reload_config, "reload_config", {}),
    ):
        result = run(handler, command(action, params), ctx)
        assert result.ack.ok is False, action
        assert result.ack.error.code == "plasma_config_unavailable", action


def test_bad_params_are_rejected_before_anything_is_written(tmp_path) -> None:
    ctx, _runtime, _bridge = build_config_ctx(tmp_path)

    result = run(
        handle_plasma_select_material, command("select_material", {"material": 3}), ctx
    )

    assert result.ack.ok is False
    assert result.ack.error.code == "invalid_params"


def test_a_new_client_gets_materials_and_parameters_with_the_snapshot(tmp_path) -> None:
    """The screens render from the store, so the connect snapshot has to carry both files."""
    from backend.services.plasma_publisher import snapshot_event

    ctx, _runtime, _bridge = build_config_ctx(tmp_path)

    event = snapshot_event(ctx.plasma, ctx.plasma_config)

    assert [m["number"] for m in event["payload"]["materials"]["materials"]] == [0, 3]
    assert event["payload"]["parameters"]["values"]["Pid P Gain"] == 10.0
    assert event["payload"]["parameters"]["enables"]["thc-enable"] is True
    assert "torch-on" in event["payload"]["pins"]["plasmac"]


def test_saving_a_material_tells_every_client(tmp_path) -> None:
    ctx, _runtime, _bridge = build_config_ctx(tmp_path)

    run(
        handle_plasma_save_material,
        command("save_material", {"number": 3, "name": "6mm", "values": {"cutVolts": 130.0}}),
        ctx,
    )

    events = [msg["event"] for msg in ctx.manager.broadcasts]
    assert "plasma.materials.changed" in events


# ---- toolpath preview and run from line ---------------------------------------------


class FakeGateway:
    """Just the two things the preview handlers ask the gateway for."""

    def __init__(
        self,
        program: str | None,
        ini: str | None = None,
        open_ok: bool = True,
        prefixes: tuple[str, ...] = (),
    ) -> None:
        self.program = program
        self.ini = ini
        self.open_ok = open_ok
        self.prefixes = prefixes
        self.opened: list[str] = []

    def current_program_path(self):
        return self.program

    def get_program_prefix_directories(self):
        return list(self.prefixes)

    def resolve_ini_path(self):
        return self.ini

    def program_open(self, path: str):
        self.opened.append(path)
        from backend.adapters.linuxcnc_gateway import GatewayCommandResult

        if self.open_ok:
            return GatewayCommandResult(ok=True, noop=False)
        return GatewayCommandResult(
            ok=False, error_code="not_idle", error_message="interpreter is busy"
        )


def build_preview_ctx(program: str | None, **kwargs):
    from backend.plasma.service import PlasmaService

    runtime = FakeHalRuntime()
    bridge = make_bridge(runtime)
    bridge.poll_once()
    return AppContext(
        manager=FakeManager(),
        gateway=FakeGateway(program, **kwargs),
        plasma=PlasmaService(bridge),
    )


def test_toolpath_previews_the_loaded_program(tmp_path, monkeypatch) -> None:
    from backend.tests.test_plasma_toolpath import FakeState, install_stubs

    program = tmp_path / "cut.ngc"
    program.write_text("G21\nG0 X0 Y0\nG1 X10\nM2\n")
    install_stubs(
        monkeypatch,
        [
            ("next_line", FakeState(2)),
            ("straight_traverse", 10.0, 0.0, 5.0, 0, 0, 0, 0, 0, 0),
            ("next_line", FakeState(3)),
            ("straight_feed", 20.0, 0.0, 1.0, 0, 0, 0, 0, 0, 0),
        ],
    )
    ctx = build_preview_ctx(str(program))

    result = run(handle_plasma_toolpath, command("toolpath"), ctx)

    assert result.ack.ok is True
    assert [s["kind"] for s in result.ack.result["segments"]] == ["rapid", "feed"]
    # Machine units: the interpreter reports inches, the payload carries millimetres.
    assert result.ack.result["extents"]["max"] == [20.0 * 25.4, 0.0, 5.0 * 25.4]


def test_toolpath_says_so_with_no_program_loaded() -> None:
    ctx = build_preview_ctx(None)

    result = run(handle_plasma_toolpath, command("toolpath"), ctx)

    assert result.ack.ok is False
    assert result.ack.error.code == "no_program"


def test_toolpath_reports_a_gcode_error_rather_than_an_empty_preview(tmp_path, monkeypatch) -> None:
    from backend.tests.test_plasma_toolpath import install_stubs

    program = tmp_path / "bad.ngc"
    program.write_text("G1 X\n")
    install_stubs(monkeypatch, [], result=9)
    ctx = build_preview_ctx(str(program))

    result = run(handle_plasma_toolpath, command("toolpath"), ctx)

    assert result.ack.ok is False
    assert result.ack.error.code == "gcode_error"


def test_run_from_line_builds_and_loads_the_program(tmp_path, monkeypatch) -> None:
    from backend.tests.test_plasma_run_from_line import PROGRAM, install_helper

    install_helper(monkeypatch)
    program = tmp_path / "two_cuts.ngc"
    program.write_text(PROGRAM)
    ctx = build_preview_ctx(str(program))
    monkeypatch.setattr(
        "backend.plasma.run_from_line.DEFAULT_OUTPUT_DIR", str(tmp_path / "tmpout")
    )

    result = run(
        handle_plasma_run_from_line,
        command("run_from_line", {"line": 6, "runType": "cut"}),
        ctx,
    )

    assert result.ack.ok is True
    assert result.ack.result["startLine"] == 3
    assert result.ack.result["loaded"] is True
    assert ctx.gateway.opened == [result.ack.result["path"]]


def test_run_from_line_can_be_asked_not_to_load(tmp_path, monkeypatch) -> None:
    from backend.tests.test_plasma_run_from_line import PROGRAM, install_helper

    install_helper(monkeypatch)
    program = tmp_path / "two_cuts.ngc"
    program.write_text(PROGRAM)
    ctx = build_preview_ctx(str(program))
    monkeypatch.setattr(
        "backend.plasma.run_from_line.DEFAULT_OUTPUT_DIR", str(tmp_path / "tmpout")
    )

    result = run(
        handle_plasma_run_from_line,
        command("run_from_line", {"line": 6, "load": False}),
        ctx,
    )

    assert result.ack.ok is True
    assert ctx.gateway.opened == []


def test_run_from_line_passes_the_refusal_through(tmp_path, monkeypatch) -> None:
    from backend.tests.test_plasma_run_from_line import PROGRAM, install_helper

    install_helper(monkeypatch, get_result={"error": True, "compError": True, "subError": []})
    program = tmp_path / "two_cuts.ngc"
    program.write_text(PROGRAM)
    ctx = build_preview_ctx(str(program))

    result = run(
        handle_plasma_run_from_line, command("run_from_line", {"line": 6}), ctx
    )

    assert result.ack.ok is False
    assert result.ack.error.code == "cutter_compensation_active"


def test_a_failed_open_is_reported_not_swallowed(tmp_path, monkeypatch) -> None:
    from backend.tests.test_plasma_run_from_line import PROGRAM, install_helper

    install_helper(monkeypatch)
    program = tmp_path / "two_cuts.ngc"
    program.write_text(PROGRAM)
    ctx = build_preview_ctx(str(program), open_ok=False)
    monkeypatch.setattr(
        "backend.plasma.run_from_line.DEFAULT_OUTPUT_DIR", str(tmp_path / "tmpout")
    )

    result = run(
        handle_plasma_run_from_line, command("run_from_line", {"line": 6}), ctx
    )

    assert result.ack.ok is False
    assert result.ack.error.code == "not_idle"


def test_run_from_line_writes_into_the_machines_program_directory(tmp_path, monkeypatch) -> None:
    """`program.open` only loads files under PROGRAM_PREFIX, so that is where rfl.ngc goes."""
    from backend.tests.test_plasma_run_from_line import PROGRAM, install_helper

    install_helper(monkeypatch)
    program = tmp_path / "nc_files" / "two_cuts.ngc"
    program.parent.mkdir()
    program.write_text(PROGRAM)
    ctx = build_preview_ctx(str(program), prefixes=(str(program.parent),))

    result = run(
        handle_plasma_run_from_line, command("run_from_line", {"line": 6}), ctx
    )

    assert result.ack.ok is True
    assert result.ack.result["path"] == str(program.parent / "rfl.ngc")
