import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional, Tuple

import pytest

from backend.application.command_bus import CommandBus
from backend.application.context import AppContext
from backend.contracts.messages import CommandEnvelope
from backend.adapters.linuxcnc_gateway import GatewayCommandResult, normalize_task_state_param
from backend.handlers.app import handle_app_exit
from backend.handlers.machine import (
    handle_machine_abort,
    handle_machine_feed_override,
    handle_machine_rapid_override,
    handle_machine_flood,
    handle_machine_get_ini_config,
    handle_machine_mist,
    handle_machine_power,
    handle_machine_set_task_state,
    handle_machine_spindle,
    handle_machine_spindle_override,
)
from backend.handlers.motion import (
    handle_motion_home,
    handle_motion_jog,
    handle_motion_jog_stop,
    handle_motion_set_active_coordinate_system,
    handle_motion_set_axis_coordinate,
    handle_motion_set_coordinate_system_offset,
    handle_motion_unhome,
)
from backend.handlers.program import (
    INTERP_IDLE,
    INTERP_READING,
    MODE_AUTO,
    MODE_MANUAL,
    handle_program_auto,
    handle_program_list,
    handle_program_load_tool_table,
    handle_program_mdi,
    handle_program_open,
    handle_program_read,
    handle_program_write,
)
from backend.handlers.tool import (
    handle_tool_add_tool_table_row,
    handle_tool_delete_tool_table_row,
    handle_tool_touch_off,
    handle_tool_update_tool_table_row,
)
from backend.services.mdi_manual_revert import mdi_manual_revert_tick
from backend.ws.connection_manager import ConnectionManager

_CREATED_FAKE_GATEWAYS: list["FakeGateway"] = []


class FakeGateway:
    def __init__(
        self,
        flood_error: bool = False,
        flood_noop: bool = False,
        jog_error: bool = False,
        estop_reset_rejected: bool = False,
        estop_reset_pending_polls: int = 0,
        *,
        enabled: bool = True,
        task_state: int = 3,
        task_mode: int = 1,
        interp_state: int = 1,
        program_mdi_error_code: str | None = None,
        program_open_error_code: str | None = None,
        program_auto_error_code: str | None = None,
        abort_program_error_code: str | None = None,
        load_tool_table_error_code: str | None = None,
        update_tool_table_row_error_code: str | None = None,
        delete_tool_table_row_error_code: str | None = None,
        add_tool_table_row_error_code: str | None = None,
        tool_touch_off_error_code: str | None = None,
        fake_active_coordinate_system: str = "G54",
        program_prefix_dirs: list[str] | None = None,
        wait_last_command_complete_result: GatewayCommandResult | None = None,
    ) -> None:
        _CREATED_FAKE_GATEWAYS.append(self)
        self.power_on = False
        self.task_state = task_state
        self.flood_error = flood_error
        self.flood_noop = flood_noop
        self.jog_error = jog_error
        self.estop_reset_rejected = estop_reset_rejected
        self.estop_reset_pending_polls = max(0, int(estop_reset_pending_polls))
        self.enabled = enabled
        self.task_mode = task_mode
        self.interp_state = interp_state
        self.program_mdi_error_code = program_mdi_error_code
        self.program_open_error_code = program_open_error_code
        self.program_auto_error_code = program_auto_error_code
        self.abort_program_error_code = abort_program_error_code
        self.load_tool_table_error_code = load_tool_table_error_code
        self.update_tool_table_row_error_code = update_tool_table_row_error_code
        self.delete_tool_table_row_error_code = delete_tool_table_row_error_code
        self.add_tool_table_row_error_code = add_tool_table_row_error_code
        self.tool_touch_off_error_code = tool_touch_off_error_code
        self.last_mdi: dict | None = None
        self.last_program_open: str | None = None
        self.last_program_auto: dict | None = None
        self.abort_program_calls = 0
        self.load_tool_table_calls = 0
        self.update_tool_table_row_calls = 0
        self.last_update_tool_table_row: dict | None = None
        self.delete_tool_table_row_calls = 0
        self.last_delete_tool_table_row: dict | None = None
        self.add_tool_table_row_calls = 0
        self.last_add_tool_table_row: dict | None = None
        self.set_task_mode_calls: list[int] = []
        self.last_jog: Optional[dict] = None
        self.last_jog_stop: Optional[dict] = None
        self.last_home_joint: Optional[int] = None
        self.last_unhome_joint: Optional[int] = None
        self.last_set_axis_coordinate: Optional[dict] = None
        self.last_tool_touch_off: Optional[dict] = None
        self.last_set_active_coordinate_system: Optional[str] = None
        self.last_set_coordinate_system_offset: Optional[dict] = None
        self.last_feed_override_factor: Optional[float] = None
        self.last_rapid_override_factor: Optional[float] = None
        self.last_spindle_override: Optional[Tuple[float, int]] = None
        self.last_jog_wheel_scale: Optional[float] = None
        self.fake_active_coordinate_system = fake_active_coordinate_system
        self.program_prefix_dirs: list[str] = (
            list(program_prefix_dirs) if program_prefix_dirs is not None else []
        )
        self.wait_last_command_complete_result = wait_last_command_complete_result
        self.ini_runtime_config = {
            "jog_increments_spec": "5 mm, 1 mm, 0.1 mm",
            "linear_units": "mm",
            "angular_units": "deg",
            "program_units": 2,
            "traj_coordinates": None,
            "display_lathe": False,
            "user_macros": [],
            "source": "ini",
            "ini_path": "/tmp/test.ini",
        }
        self._blocking_executor = ThreadPoolExecutor(max_workers=1)

    def set_power(self, on: bool) -> bool:
        if on:
            self.set_task_state(4)
        else:
            self.set_task_state(3)
        return self.power_on

    def set_task_state(self, status):  # noqa: ANN001
        n = normalize_task_state_param(status)
        if self.estop_reset_rejected and n == 2:
            self.task_state = 1
            self.estop_reset_pending_polls = 0
        elif n == 2 and self.estop_reset_pending_polls > 0:
            # Simulate short status lag: reset command accepted, snapshot still ESTOP briefly.
            self.task_state = 1
        else:
            self.task_state = n
        self.power_on = self.task_state == 4
        return self.power_on

    def set_task_mode(self, mode: int) -> GatewayCommandResult:
        # Mirror into in-memory state; handler uses this for revert.
        self.task_mode = int(mode)
        self.set_task_mode_calls.append(int(mode))
        return GatewayCommandResult(ok=True, noop=False)

    def wait_last_command_complete(self, timeout_s: float = 600.0) -> GatewayCommandResult:
        if self.wait_last_command_complete_result is not None:
            return self.wait_last_command_complete_result
        return GatewayCommandResult(ok=True, noop=False)

    def get_machine_task_context(self) -> dict:
        return {
            "enabled": bool(self.enabled),
            "task_state": int(self.task_state),
            "task_mode": int(self.task_mode),
            "interp_state": int(self.interp_state),
            "current_vel": 0.0,
            "motion_type": 0,
        }

    def set_flood(self, on: bool) -> GatewayCommandResult:
        if self.flood_error:
            return GatewayCommandResult(
                ok=False,
                error_code="machine_not_on",
                error_message="test denial",
            )
        if self.flood_noop:
            return GatewayCommandResult(ok=True, noop=True)
        return GatewayCommandResult(ok=True, noop=False)

    def set_mist(self, on: bool) -> GatewayCommandResult:
        return GatewayCommandResult(ok=True, noop=True)

    def set_spindle(
        self,
        direction: str,
        speed_rpm: Optional[float] = None,
        spindle_index: int = 0,
    ) -> GatewayCommandResult:
        return GatewayCommandResult(ok=True, noop=False)

    def set_feed_override(self, factor: float) -> GatewayCommandResult:
        self.last_feed_override_factor = float(factor)
        return GatewayCommandResult(ok=True, noop=False)

    def set_rapid_override(self, factor: float) -> GatewayCommandResult:
        self.last_rapid_override_factor = float(factor)
        return GatewayCommandResult(ok=True, noop=False)

    def set_spindle_override(self, factor: float, spindle_index: int = 0) -> GatewayCommandResult:
        self.last_spindle_override = (float(factor), int(spindle_index))
        return GatewayCommandResult(ok=True, noop=False)

    def set_jog_wheel_scale(self, scale: float, *, timeout_s: float = 3.0) -> GatewayCommandResult:
        self.last_jog_wheel_scale = float(scale)
        return GatewayCommandResult(ok=True, noop=False)

    def hal_pulse_rising_edge(self, pin: str, *, timeout_s: float = 3.0) -> GatewayCommandResult:
        self.last_hal_pulse_pin = str(pin)
        return GatewayCommandResult(ok=True, noop=False)

    def jog_motion(
        self,
        joint_mode: bool,
        index: int,
        velocity_per_min: float,
        mode: str,
        distance: Optional[float] = None,
    ) -> GatewayCommandResult:
        if self.jog_error:
            return GatewayCommandResult(
                ok=False,
                error_code="jog_wrong_motion_mode",
                error_message="test jog denial",
            )
        self.last_jog = {
            "joint_mode": joint_mode,
            "index": index,
            "velocity_per_min": velocity_per_min,
            "mode": mode,
            "distance": distance,
        }
        return GatewayCommandResult(ok=True, noop=False)

    def jog_stop(self, joint_mode: bool, index: int) -> GatewayCommandResult:
        if self.jog_error:
            return GatewayCommandResult(
                ok=False,
                error_code="wrong_task_mode",
                error_message="test jog_stop denial",
            )
        self.last_jog_stop = {"joint_mode": joint_mode, "index": index}
        return GatewayCommandResult(ok=True, noop=False)

    def home_motion_precheck(self, joint: int) -> GatewayCommandResult:
        return GatewayCommandResult(ok=True)

    def unhome_motion_precheck(self, joint: int) -> GatewayCommandResult:
        return GatewayCommandResult(ok=True)

    def home_motion(self, joint: int) -> GatewayCommandResult:
        self.last_home_joint = joint
        return GatewayCommandResult(ok=True, noop=False)

    def home_motion_execute(self, joint: int) -> GatewayCommandResult:
        self.last_home_joint = joint
        return GatewayCommandResult(ok=True, noop=False)

    def unhome_motion(self, joint: int) -> GatewayCommandResult:
        self.last_unhome_joint = joint
        return GatewayCommandResult(ok=True, noop=False)

    def unhome_motion_execute(self, joint: int) -> GatewayCommandResult:
        self.last_unhome_joint = joint
        return GatewayCommandResult(ok=True, noop=False)

    @property
    def blocking_executor(self) -> ThreadPoolExecutor:
        return self._blocking_executor

    def get_status_snapshot(self):  # noqa: ANN201
        if self.estop_reset_pending_polls > 0 and self.task_state == 1:
            self.estop_reset_pending_polls -= 1
            if self.estop_reset_pending_polls == 0:
                self.task_state = 2
        return {
            "machine": {
                "powerOn": self.power_on,
                "task_state": self.task_state,
                "error": self.task_state == 1,
            },
            "program": {},
        }

    def set_axis_coordinate(self, axis: str, value: float) -> GatewayCommandResult:
        if self.program_mdi_error_code:
            return GatewayCommandResult(
                ok=False,
                error_code=self.program_mdi_error_code,
                error_message="test denial",
            )
        self.last_set_axis_coordinate = {"axis": axis, "value": value}
        return GatewayCommandResult(ok=True, noop=False)

    def tool_touch_off(self, axis: str, value: float) -> GatewayCommandResult:
        if self.tool_touch_off_error_code:
            return GatewayCommandResult(
                ok=False,
                error_code=self.tool_touch_off_error_code,
                error_message="test denial",
            )
        self.last_tool_touch_off = {"axis": axis, "value": float(value)}
        return GatewayCommandResult(ok=True, noop=False)

    def set_active_coordinate_system(self, system_id: str) -> GatewayCommandResult:
        if self.program_mdi_error_code:
            return GatewayCommandResult(
                ok=False,
                error_code=self.program_mdi_error_code,
                error_message="test denial",
            )
        sid = (system_id or "").strip()
        self.last_set_active_coordinate_system = sid
        if sid == self.fake_active_coordinate_system:
            return GatewayCommandResult(ok=True, noop=True)
        self.task_mode = 3
        self.interp_state = 1
        return GatewayCommandResult(ok=True, noop=False)

    def set_coordinate_system_offset(
        self, system_id: str, axis_values: dict[str, float]
    ) -> GatewayCommandResult:
        if self.program_mdi_error_code:
            return GatewayCommandResult(
                ok=False,
                error_code=self.program_mdi_error_code,
                error_message="test denial",
            )
        self.last_set_coordinate_system_offset = {
            "systemId": system_id,
            "axis_values": dict(axis_values),
        }
        return GatewayCommandResult(
            ok=True,
            noop=False,
            result={"g5x_offsets": dict(axis_values)},
        )

    def program_mdi(self, text: str) -> GatewayCommandResult:
        if self.program_mdi_error_code:
            return GatewayCommandResult(
                ok=False,
                error_code=self.program_mdi_error_code,
                error_message="test denial",
            )
        self.last_mdi = {"text": text}
        # Emulate gateway behavior: it switches into MODE_MDI before sending.
        self.task_mode = 3
        # Emulate interpreter already being idle for revert tests.
        self.interp_state = 1
        return GatewayCommandResult(ok=True, noop=False)

    def program_open(self, path: str) -> GatewayCommandResult:
        if self.program_open_error_code:
            return GatewayCommandResult(
                ok=False,
                error_code=self.program_open_error_code,
                error_message="test denial",
            )
        self.last_program_open = path
        return GatewayCommandResult(ok=True, noop=False)

    def program_auto(self, subcommand: str, start_line: int = 0) -> GatewayCommandResult:
        if self.program_auto_error_code:
            return GatewayCommandResult(
                ok=False,
                error_code=self.program_auto_error_code,
                error_message="test denial",
            )
        self.last_program_auto = {
            "subcommand": subcommand,
            "start_line": int(start_line),
        }
        return GatewayCommandResult(ok=True, noop=False)

    def abort_program(self, *, timeout_s: float | None = None) -> GatewayCommandResult:
        del timeout_s
        self.abort_program_calls += 1
        if self.abort_program_error_code:
            return GatewayCommandResult(
                ok=False,
                error_code=self.abort_program_error_code,
                error_message="test denial",
            )
        return GatewayCommandResult(ok=True, noop=False)

    def load_tool_table(self) -> GatewayCommandResult:
        self.load_tool_table_calls += 1
        if self.load_tool_table_error_code:
            return GatewayCommandResult(
                ok=False,
                error_code=self.load_tool_table_error_code,
                error_message="test denial",
            )
        return GatewayCommandResult(ok=True, noop=False)

    def update_tool_table_row(self, params: dict) -> GatewayCommandResult:
        self.update_tool_table_row_calls += 1
        self.last_update_tool_table_row = dict(params)
        if self.update_tool_table_row_error_code:
            return GatewayCommandResult(
                ok=False,
                error_code=self.update_tool_table_row_error_code,
                error_message="test denial",
            )
        return GatewayCommandResult(ok=True, noop=False)

    def delete_tool_table_row(self, params: dict) -> GatewayCommandResult:
        self.delete_tool_table_row_calls += 1
        self.last_delete_tool_table_row = dict(params)
        if self.delete_tool_table_row_error_code:
            return GatewayCommandResult(
                ok=False,
                error_code=self.delete_tool_table_row_error_code,
                error_message="test denial",
            )
        return GatewayCommandResult(ok=True, noop=False)

    def add_tool_table_row(self, params: dict) -> GatewayCommandResult:
        self.add_tool_table_row_calls += 1
        self.last_add_tool_table_row = dict(params)
        if self.add_tool_table_row_error_code:
            return GatewayCommandResult(
                ok=False,
                error_code=self.add_tool_table_row_error_code,
                error_message="test denial",
            )
        return GatewayCommandResult(ok=True, noop=False)

    def get_ini_runtime_config(self, force_reload: bool = False) -> dict:
        return dict(self.ini_runtime_config)

    def get_program_prefix_directories(self) -> list[str]:
        return list(self.program_prefix_dirs)


@pytest.fixture(autouse=True)
def _cleanup_fake_gateway_executors() -> None:
    # Ensure each test closes all executors created through FakeGateway.
    yield
    for gw in _CREATED_FAKE_GATEWAYS:
        gw._blocking_executor.shutdown(wait=True)
    _CREATED_FAKE_GATEWAYS.clear()


def test_command_bus_routes_program_mdi_invalid_params_empty_text() -> None:
    bus = CommandBus()
    bus.register("program", "mdi", handle_program_mdi)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-mdi-empty",
        category="program",
        action="mdi",
        params={"text": "   "},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"


def test_command_bus_routes_program_mdi_invalid_params_too_long() -> None:
    bus = CommandBus()
    bus.register("program", "mdi", handle_program_mdi)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    too_long = "A" * 255
    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-mdi-too-long",
        category="program",
        action="mdi",
        params={"text": too_long},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"


def test_command_bus_routes_program_mdi_wrong_task_mode() -> None:
    bus = CommandBus()
    bus.register("program", "mdi", handle_program_mdi)
    ctx = AppContext(
        manager=ConnectionManager(),
        gateway=FakeGateway(program_mdi_error_code="wrong_task_mode"),
    )  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-mdi-wrong",
        category="program",
        action="mdi",
        params={"text": "G0 X1"},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "wrong_task_mode"


def test_command_bus_routes_program_mdi_revert_to_manual() -> None:
    bus = CommandBus()
    bus.register("program", "mdi", handle_program_mdi)

    gw = FakeGateway(task_state=4, task_mode=1, interp_state=1)
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    async def _run() -> None:
        command = CommandEnvelope(
            type="command",
            protocolVersion=1,
            commandId="id-mdi-revert",
            category="program",
            action="mdi",
            params={"text": "G0 X1"},
        )

        result = await bus.dispatch(command, ctx)
        assert result.ack.ok is True

        await mdi_manual_revert_tick(ctx)
        assert gw.set_task_mode_calls == [MODE_MANUAL]

    asyncio.run(_run())


def test_mdi_manual_revert_tick_auto_idle_to_manual() -> None:
    gw = FakeGateway(
        task_state=4, task_mode=MODE_AUTO, interp_state=INTERP_IDLE
    )
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    async def _run() -> None:
        await mdi_manual_revert_tick(ctx)
        assert gw.set_task_mode_calls == [MODE_MANUAL]
        assert gw.task_mode == MODE_MANUAL

    asyncio.run(_run())


def test_mdi_manual_revert_tick_auto_running_skips_revert() -> None:
    gw = FakeGateway(
        task_state=4, task_mode=MODE_AUTO, interp_state=INTERP_READING
    )
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    async def _run() -> None:
        await mdi_manual_revert_tick(ctx)
        assert gw.set_task_mode_calls == []

    asyncio.run(_run())


def test_mdi_manual_revert_tick_wait_linuxcnc_command_failed_still_reverts() -> None:
    gw = FakeGateway(
        task_state=4,
        task_mode=MODE_AUTO,
        interp_state=INTERP_IDLE,
        wait_last_command_complete_result=GatewayCommandResult(
            ok=False,
            error_code="linuxcnc_command_failed",
            error_message="RCS_ERROR after program fault",
        ),
    )
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    async def _run() -> None:
        await mdi_manual_revert_tick(ctx)
        assert gw.set_task_mode_calls == [MODE_MANUAL]
        assert gw.task_mode == MODE_MANUAL

    asyncio.run(_run())


def test_mdi_manual_revert_tick_wait_command_in_progress_skips_revert() -> None:
    gw = FakeGateway(
        task_state=4,
        task_mode=MODE_AUTO,
        interp_state=INTERP_IDLE,
        wait_last_command_complete_result=GatewayCommandResult(
            ok=False,
            error_code="command_in_progress",
            error_message="Cannot wait while another command is being executed.",
        ),
    )
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    async def _run() -> None:
        await mdi_manual_revert_tick(ctx)
        assert gw.set_task_mode_calls == []

    asyncio.run(_run())


def test_command_bus_routes_program_open_invalid_params() -> None:
    bus = CommandBus()
    bus.register("program", "open", handle_program_open)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-open-bad",
        category="program",
        action="open",
        params={"path": "  "},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"


def test_command_bus_routes_program_open_success() -> None:
    bus = CommandBus()
    bus.register("program", "open", handle_program_open)
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-open-ok",
        category="program",
        action="open",
        params={"path": "/tmp/test.ngc"},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert gw.last_program_open == "/tmp/test.ngc"


def test_command_bus_routes_program_open_gateway_error() -> None:
    bus = CommandBus()
    bus.register("program", "open", handle_program_open)
    gw = FakeGateway(program_open_error_code="file_not_found")
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-open-fail",
        category="program",
        action="open",
        params={"path": "/missing.ngc"},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "file_not_found"


def test_command_bus_routes_program_list_default(tmp_path) -> None:
    programs = tmp_path / "programs"
    programs.mkdir()
    (programs / "part.ngc").write_text("G0\n", encoding="utf-8")
    (programs / "nested").mkdir()
    root = str(programs.resolve())

    bus = CommandBus()
    bus.register("program", "list", handle_program_list)
    gw = FakeGateway(program_prefix_dirs=[root])
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-list-1",
        category="program",
        action="list",
        params={},
    )
    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert result.ack.result is not None
    assert result.ack.result["path"] == root
    names = {e["name"] for e in result.ack.result["entries"]}
    assert names == {"nested", "part.ngc"}


def test_command_bus_routes_program_list_outside_prefix(tmp_path) -> None:
    programs = tmp_path / "programs"
    programs.mkdir()
    other = tmp_path / "other"
    other.mkdir()

    bus = CommandBus()
    bus.register("program", "list", handle_program_list)
    gw = FakeGateway(program_prefix_dirs=[str(programs.resolve())])
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-list-out",
        category="program",
        action="list",
        params={"path": str(other.resolve())},
    )
    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "outside_program_prefix"


def test_command_bus_routes_program_list_missing_directory(tmp_path) -> None:
    missing = tmp_path / "missing_programs"
    assert not missing.exists()

    bus = CommandBus()
    bus.register("program", "list", handle_program_list)
    gw = FakeGateway(program_prefix_dirs=[str(missing.resolve())])
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-list-missing",
        category="program",
        action="list",
        params={},
    )
    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "not_a_directory"
    assert result.ack.error.path == str(missing.resolve())
    assert result.ack.error.message == "NC program directory does not exist"


def test_command_bus_routes_program_read_write_roundtrip(tmp_path) -> None:
    programs = tmp_path / "programs"
    programs.mkdir()
    fpath = programs / "edit.ngc"
    fpath.write_text("before\n", encoding="utf-8")
    root = str(programs.resolve())

    bus = CommandBus()
    bus.register("program", "read", handle_program_read)
    bus.register("program", "write", handle_program_write)
    gw = FakeGateway(program_prefix_dirs=[root])
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    read_cmd = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-read-1",
        category="program",
        action="read",
        params={"path": str(fpath.resolve())},
    )
    r1 = asyncio.run(bus.dispatch(read_cmd, ctx))
    assert r1.ack.ok is True
    assert r1.ack.result is not None
    assert r1.ack.result["content"] == "before\n"

    write_cmd = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-write-1",
        category="program",
        action="write",
        params={"path": str(fpath.resolve()), "content": "after\n"},
    )
    r2 = asyncio.run(bus.dispatch(write_cmd, ctx))
    assert r2.ack.ok is True
    assert fpath.read_text(encoding="utf-8") == "after\n"


def test_command_bus_routes_program_write_new_file(tmp_path) -> None:
    programs = tmp_path / "programs"
    programs.mkdir()
    root = str(programs.resolve())
    new_file = programs / "fresh.ngc"

    bus = CommandBus()
    bus.register("program", "write", handle_program_write)
    gw = FakeGateway(program_prefix_dirs=[root])
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-write-new",
        category="program",
        action="write",
        params={"path": str(new_file.resolve()), "content": "M2\n"},
    )
    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert new_file.read_text(encoding="utf-8") == "M2\n"


def test_command_bus_routes_program_auto_invalid_params_unknown_command() -> None:
    bus = CommandBus()
    bus.register("program", "auto", handle_program_auto)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-auto-bad-cmd",
        category="program",
        action="auto",
        params={"command": "rewind"},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"


def test_command_bus_routes_program_auto_invalid_params_startline_with_pause() -> None:
    bus = CommandBus()
    bus.register("program", "auto", handle_program_auto)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-auto-bad-sl",
        category="program",
        action="auto",
        params={"command": "pause", "startLine": 5},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"


def test_command_bus_routes_program_auto_run_with_start_line() -> None:
    bus = CommandBus()
    bus.register("program", "auto", handle_program_auto)
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-auto-run-line",
        category="program",
        action="auto",
        params={"command": "run", "startLine": 42},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert gw.last_program_auto == {"subcommand": "run", "start_line": 42}


def test_command_bus_routes_program_auto_gateway_error() -> None:
    bus = CommandBus()
    bus.register("program", "auto", handle_program_auto)
    gw = FakeGateway(program_auto_error_code="wrong_task_mode")
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-auto-fail",
        category="program",
        action="auto",
        params={"command": "run"},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "wrong_task_mode"


def test_command_bus_routes_machine_abort_success() -> None:
    bus = CommandBus()
    bus.register("machine", "abort", handle_machine_abort)
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-abort-ok",
        category="machine",
        action="abort",
        params={},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert gw.abort_program_calls == 1


def test_command_bus_routes_machine_abort_invalid_params() -> None:
    bus = CommandBus()
    bus.register("machine", "abort", handle_machine_abort)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-abort-bad",
        category="machine",
        action="abort",
        params={"extra": 1},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"


def test_command_bus_routes_machine_abort_gateway_error() -> None:
    bus = CommandBus()
    bus.register("machine", "abort", handle_machine_abort)
    gw = FakeGateway(abort_program_error_code="command_in_progress")
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-abort-fail",
        category="machine",
        action="abort",
        params={},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "command_in_progress"


def test_command_bus_routes_program_load_tool_table_success() -> None:
    bus = CommandBus()
    bus.register("program", "load_tool_table", handle_program_load_tool_table)
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-ltt-ok",
        category="program",
        action="load_tool_table",
        params={},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert gw.load_tool_table_calls == 1


def test_command_bus_routes_program_load_tool_table_gateway_error() -> None:
    bus = CommandBus()
    bus.register("program", "load_tool_table", handle_program_load_tool_table)
    gw = FakeGateway(load_tool_table_error_code="interpreter_busy")
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-ltt-fail",
        category="program",
        action="load_tool_table",
        params={},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "interpreter_busy"


def test_command_bus_routes_tool_update_tool_table_row_success() -> None:
    bus = CommandBus()
    bus.register("tool", "update_tool_table_row", handle_tool_update_tool_table_row)
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-tuttr-ok",
        category="tool",
        action="update_tool_table_row",
        params={"toolno": 1, "zoffset": 1.0, "comment": "edited"},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert gw.update_tool_table_row_calls == 1
    assert gw.last_update_tool_table_row == {
        "toolno": 1,
        "zoffset": 1.0,
        "comment": "edited",
    }


def test_command_bus_routes_tool_update_tool_table_row_invalid_params() -> None:
    bus = CommandBus()
    bus.register("tool", "update_tool_table_row", handle_tool_update_tool_table_row)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-tuttr-bad",
        category="tool",
        action="update_tool_table_row",
        params={"toolno": 0},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"


def test_command_bus_routes_tool_update_tool_table_row_gateway_error() -> None:
    bus = CommandBus()
    bus.register("tool", "update_tool_table_row", handle_tool_update_tool_table_row)
    gw = FakeGateway(update_tool_table_row_error_code="tool_line_not_found")
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-tuttr-fail",
        category="tool",
        action="update_tool_table_row",
        params={"toolno": 2},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "tool_line_not_found"


def test_command_bus_routes_tool_delete_tool_table_row_success() -> None:
    bus = CommandBus()
    bus.register("tool", "delete_tool_table_row", handle_tool_delete_tool_table_row)
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-del-ok",
        category="tool",
        action="delete_tool_table_row",
        params={"toolno": 3},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert gw.delete_tool_table_row_calls == 1
    assert gw.last_delete_tool_table_row == {"toolno": 3}


def test_command_bus_routes_tool_add_tool_table_row_success() -> None:
    bus = CommandBus()
    bus.register("tool", "add_tool_table_row", handle_tool_add_tool_table_row)
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-add-ok",
        category="tool",
        action="add_tool_table_row",
        params={"toolno": 9, "zoffset": 0.0, "comment": "new"},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert gw.add_tool_table_row_calls == 1
    assert gw.last_add_tool_table_row == {"toolno": 9, "zoffset": 0.0, "comment": "new"}


def test_command_bus_routes_tool_delete_tool_table_row_invalid_params() -> None:
    bus = CommandBus()
    bus.register("tool", "delete_tool_table_row", handle_tool_delete_tool_table_row)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-del-bad",
        category="tool",
        action="delete_tool_table_row",
        params={"toolno": 0},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"


def test_command_bus_routes_tool_add_tool_table_row_invalid_params() -> None:
    bus = CommandBus()
    bus.register("tool", "add_tool_table_row", handle_tool_add_tool_table_row)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-add-bad",
        category="tool",
        action="add_tool_table_row",
        params={"toolno": -1},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"


def test_command_bus_routes_machine_power() -> None:
    bus = CommandBus()
    bus.register("machine", "power", handle_machine_power)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-1",
        category="machine",
        action="power",
        params={"on": True},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert len(result.events) == 1
    assert result.events[0].event == "machine.power.changed"


def test_command_bus_routes_machine_set_task_state() -> None:
    bus = CommandBus()
    bus.register("machine", "set_task_state", handle_machine_set_task_state)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-2",
        category="machine",
        action="set_task_state",
        params={"status": 4},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert len(result.events) == 1
    assert result.events[0].event == "machine.task_state.changed"


def test_command_bus_routes_machine_get_ini_config() -> None:
    bus = CommandBus()
    bus.register("machine", "get_ini_config", handle_machine_get_ini_config)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-ini-config",
        category="machine",
        action="get_ini_config",
        params={},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert len(result.events) == 1
    assert result.events[0].event == "machine.ini_config.loaded"
    assert result.events[0].payload["jog_increments_spec"] == "5 mm, 1 mm, 0.1 mm"


def test_command_bus_machine_set_task_state_estop_reset_rejected() -> None:
    bus = CommandBus()
    bus.register("machine", "set_task_state", handle_machine_set_task_state)
    ctx = AppContext(
        manager=ConnectionManager(), gateway=FakeGateway(estop_reset_rejected=True)
    )  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-estop-fail",
        category="machine",
        action="set_task_state",
        params={"status": 2},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "estop_reset_rejected"
    assert result.events == []


def test_command_bus_machine_set_task_state_estop_reset_transient_status_lag() -> None:
    bus = CommandBus()
    bus.register("machine", "set_task_state", handle_machine_set_task_state)
    ctx = AppContext(
        manager=ConnectionManager(), gateway=FakeGateway(estop_reset_pending_polls=2)
    )  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-estop-lag",
        category="machine",
        action="set_task_state",
        params={"status": 2},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert result.ack.error is None
    assert len(result.events) == 1
    assert result.events[0].event == "machine.task_state.changed"
    assert result.events[0].payload["task_state"] == 2


def test_command_bus_routes_machine_flood() -> None:
    bus = CommandBus()
    bus.register("machine", "flood", handle_machine_flood)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-flood",
        category="machine",
        action="flood",
        params={"on": True},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert len(result.events) == 1
    assert result.events[0].event == "machine.flood.changed"
    assert result.events[0].payload["on"] is True


def test_command_bus_routes_machine_flood_noop_no_event() -> None:
    bus = CommandBus()
    bus.register("machine", "flood", handle_machine_flood)
    ctx = AppContext(
        manager=ConnectionManager(), gateway=FakeGateway(flood_noop=True)
    )  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-flood-noop",
        category="machine",
        action="flood",
        params={"on": True},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert result.events == []


def test_command_bus_routes_machine_mist_noop_no_event() -> None:
    bus = CommandBus()
    bus.register("machine", "mist", handle_machine_mist)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-mist",
        category="machine",
        action="mist",
        params={"on": False},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert result.events == []


def test_command_bus_routes_machine_spindle() -> None:
    bus = CommandBus()
    bus.register("machine", "spindle", handle_machine_spindle)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-spindle",
        category="machine",
        action="spindle",
        params={"direction": "stop", "spindle": 0},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert len(result.events) == 1
    assert result.events[0].event == "machine.spindle.changed"
    assert result.events[0].payload["direction"] == "stop"


def test_command_bus_routes_machine_feed_override() -> None:
    bus = CommandBus()
    bus.register("machine", "feed_override", handle_machine_feed_override)
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-feed-ov",
        category="machine",
        action="feed_override",
        params={"factor": 1.25},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert result.events == []
    assert gw.last_feed_override_factor == 1.25


def test_command_bus_routes_machine_rapid_override() -> None:
    bus = CommandBus()
    bus.register("machine", "rapid_override", handle_machine_rapid_override)
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-rapid-ov",
        category="machine",
        action="rapid_override",
        params={"factor": 0.75},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert result.events == []
    assert gw.last_rapid_override_factor == 0.75


def test_command_bus_machine_rapid_override_invalid_params() -> None:
    bus = CommandBus()
    bus.register("machine", "rapid_override", handle_machine_rapid_override)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-rapid-ov-bad",
        category="machine",
        action="rapid_override",
        params={},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"


def test_command_bus_routes_machine_spindle_override() -> None:
    bus = CommandBus()
    bus.register("machine", "spindle_override", handle_machine_spindle_override)
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-spindle-ov",
        category="machine",
        action="spindle_override",
        params={"factor": 0.9, "spindle": 0},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert result.events == []
    assert gw.last_spindle_override == (0.9, 0)


def test_command_bus_machine_feed_override_invalid_params() -> None:
    bus = CommandBus()
    bus.register("machine", "feed_override", handle_machine_feed_override)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-feed-ov-bad",
        category="machine",
        action="feed_override",
        params={},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"


def test_command_bus_machine_flood_gateway_error() -> None:
    bus = CommandBus()
    bus.register("machine", "flood", handle_machine_flood)
    ctx = AppContext(
        manager=ConnectionManager(), gateway=FakeGateway(flood_error=True)
    )  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-flood-err",
        category="machine",
        action="flood",
        params={"on": True},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "machine_not_on"


def test_command_bus_routes_motion_jog() -> None:
    bus = CommandBus()
    bus.register("motion", "jog", handle_motion_jog)
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-jog",
        category="motion",
        action="jog",
        params={
            "jointMode": False,
            "index": 0,
            "velocity": 100.0,
            "mode": "increment",
            "distance": 0.1,
        },
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert result.events == []
    assert gw.last_jog is not None
    assert gw.last_jog["mode"] == "increment"
    assert gw.last_jog["distance"] == 0.1


def test_command_bus_routes_motion_jog_stop() -> None:
    bus = CommandBus()
    bus.register("motion", "jog_stop", handle_motion_jog_stop)
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-jog-stop",
        category="motion",
        action="jog_stop",
        params={"jointMode": True, "index": 1},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert gw.last_jog_stop == {"joint_mode": True, "index": 1}


def test_command_bus_motion_jog_invalid_params() -> None:
    bus = CommandBus()
    bus.register("motion", "jog", handle_motion_jog)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-jog-bad",
        category="motion",
        action="jog",
        params={
            "jointMode": False,
            "index": 0,
            "velocity": 10.0,
            "mode": "increment",
        },
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"


def test_command_bus_motion_jog_gateway_error() -> None:
    bus = CommandBus()
    bus.register("motion", "jog", handle_motion_jog)
    ctx = AppContext(
        manager=ConnectionManager(), gateway=FakeGateway(jog_error=True)
    )  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-jog-err",
        category="motion",
        action="jog",
        params={
            "jointMode": False,
            "index": 0,
            "velocity": 100.0,
            "mode": "continuous",
        },
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "jog_wrong_motion_mode"


def test_command_bus_routes_motion_home() -> None:
    bus = CommandBus()
    bus.register("motion", "home", handle_motion_home)
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-home",
        category="motion",
        action="home",
        params={"joint": -1},
    )

    async def _run() -> None:
        result = await bus.dispatch(command, ctx)
        assert result.ack.ok is True
        assert result.ack.asyncPending is True
        await asyncio.sleep(0.05)
        assert gw.last_home_joint == -1

    asyncio.run(_run())


def test_command_bus_routes_motion_unhome() -> None:
    bus = CommandBus()
    bus.register("motion", "unhome", handle_motion_unhome)
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-unhome",
        category="motion",
        action="unhome",
        params={"joint": 2},
    )

    async def _run() -> None:
        result = await bus.dispatch(command, ctx)
        assert result.ack.ok is True
        assert result.ack.asyncPending is True
        await asyncio.sleep(0.05)
        assert gw.last_unhome_joint == 2

    asyncio.run(_run())


def test_command_bus_routes_motion_set_axis_coordinate() -> None:
    bus = CommandBus()
    bus.register("motion", "set_axis_coordinate", handle_motion_set_axis_coordinate)
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-set-axis",
        category="motion",
        action="set_axis_coordinate",
        params={"axis": "X", "value": 12.5},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert result.events == []
    assert gw.last_set_axis_coordinate == {"axis": "x", "value": 12.5}


def test_command_bus_motion_set_axis_coordinate_invalid_params() -> None:
    bus = CommandBus()
    bus.register("motion", "set_axis_coordinate", handle_motion_set_axis_coordinate)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-set-axis-bad",
        category="motion",
        action="set_axis_coordinate",
        params={"axis": "q", "value": 1.0},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"


def test_command_bus_motion_set_axis_coordinate_gateway_error() -> None:
    bus = CommandBus()
    bus.register("motion", "set_axis_coordinate", handle_motion_set_axis_coordinate)
    ctx = AppContext(
        manager=ConnectionManager(), gateway=FakeGateway(program_mdi_error_code="machine_not_on")
    )  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-set-axis-err",
        category="motion",
        action="set_axis_coordinate",
        params={"axis": "z", "value": 0.0},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "machine_not_on"


def test_command_bus_routes_tool_touch_off() -> None:
    bus = CommandBus()
    bus.register("tool", "touch_off", handle_tool_touch_off)
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-tool-touch",
        category="tool",
        action="touch_off",
        params={"axis": "Z", "value": 10.0},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert result.events == []
    assert gw.last_tool_touch_off == {"axis": "z", "value": 10.0}


def test_command_bus_tool_touch_off_invalid_params() -> None:
    bus = CommandBus()
    bus.register("tool", "touch_off", handle_tool_touch_off)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-tool-touch-bad",
        category="tool",
        action="touch_off",
        params={"axis": "q", "value": 1.0},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"


def test_command_bus_tool_touch_off_gateway_error() -> None:
    bus = CommandBus()
    bus.register("tool", "touch_off", handle_tool_touch_off)
    ctx = AppContext(
        manager=ConnectionManager(),
        gateway=FakeGateway(tool_touch_off_error_code="no_tool_in_spindle"),
    )  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-tool-touch-err",
        category="tool",
        action="touch_off",
        params={"axis": "z", "value": 0.0},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "no_tool_in_spindle"


def test_command_bus_routes_motion_set_active_coordinate_system() -> None:
    bus = CommandBus()
    bus.register(
        "motion",
        "set_active_coordinate_system",
        handle_motion_set_active_coordinate_system,
    )
    gw = FakeGateway(fake_active_coordinate_system="G54")
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-set-active-cs",
        category="motion",
        action="set_active_coordinate_system",
        params={"systemId": "G55"},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert result.events == []
    assert gw.last_set_active_coordinate_system == "G55"


def test_command_bus_routes_motion_set_coordinate_system_offset() -> None:
    bus = CommandBus()
    bus.register(
        "motion",
        "set_coordinate_system_offset",
        handle_motion_set_coordinate_system_offset,
    )
    gw = FakeGateway()
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-set-cs-offset",
        category="motion",
        action="set_coordinate_system_offset",
        params={"systemId": "G55", "x": 12.5},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert gw.last_set_coordinate_system_offset == {
        "systemId": "G55",
        "axis_values": {"x": 12.5},
    }


def test_command_bus_motion_set_coordinate_system_offset_invalid_params() -> None:
    bus = CommandBus()
    bus.register(
        "motion",
        "set_coordinate_system_offset",
        handle_motion_set_coordinate_system_offset,
    )
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-cs-offset-bad",
        category="motion",
        action="set_coordinate_system_offset",
        params={"systemId": "G54"},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"


def test_command_bus_motion_set_active_coordinate_system_invalid_params() -> None:
    bus = CommandBus()
    bus.register(
        "motion",
        "set_active_coordinate_system",
        handle_motion_set_active_coordinate_system,
    )
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-set-active-bad",
        category="motion",
        action="set_active_coordinate_system",
        params={"systemId": "G99"},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"


def test_command_bus_motion_set_active_coordinate_system_gateway_error() -> None:
    bus = CommandBus()
    bus.register(
        "motion",
        "set_active_coordinate_system",
        handle_motion_set_active_coordinate_system,
    )
    ctx = AppContext(
        manager=ConnectionManager(), gateway=FakeGateway(program_mdi_error_code="machine_not_on")
    )  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-set-active-err",
        category="motion",
        action="set_active_coordinate_system",
        params={"systemId": "G55"},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "machine_not_on"


def test_command_bus_routes_motion_set_active_coordinate_system_revert_to_manual() -> None:
    bus = CommandBus()
    bus.register(
        "motion",
        "set_active_coordinate_system",
        handle_motion_set_active_coordinate_system,
    )

    gw = FakeGateway(
        task_state=4,
        task_mode=1,
        interp_state=1,
        fake_active_coordinate_system="G54",
    )
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    async def _run() -> None:
        command = CommandEnvelope(
            type="command",
            protocolVersion=1,
            commandId="id-set-active-revert",
            category="motion",
            action="set_active_coordinate_system",
            params={"systemId": "G56"},
        )

        result = await bus.dispatch(command, ctx)
        assert result.ack.ok is True

        await mdi_manual_revert_tick(ctx)
        assert gw.set_task_mode_calls == [MODE_MANUAL]

    asyncio.run(_run())


def test_command_bus_motion_set_active_coordinate_system_noop_skips_revert() -> None:
    bus = CommandBus()
    bus.register(
        "motion",
        "set_active_coordinate_system",
        handle_motion_set_active_coordinate_system,
    )

    gw = FakeGateway(
        task_state=4,
        task_mode=1,
        interp_state=1,
        fake_active_coordinate_system="G54",
    )
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    async def _run() -> None:
        command = CommandEnvelope(
            type="command",
            protocolVersion=1,
            commandId="id-set-active-noop",
            category="motion",
            action="set_active_coordinate_system",
            params={"systemId": "G54"},
        )

        result = await bus.dispatch(command, ctx)
        assert result.ack.ok is True

        await mdi_manual_revert_tick(ctx)
        assert gw.set_task_mode_calls == []

    asyncio.run(_run())


def test_command_bus_returns_unknown_command_error() -> None:
    bus = CommandBus()
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]
    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-2",
        category="machine",
        action="missing",
        params={},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "unknown_command"


def test_command_bus_routes_app_exit_success() -> None:
    bus = CommandBus()
    bus.register("app", "exit", handle_app_exit)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-app-exit",
        category="app",
        action="exit",
        params={},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True


def test_command_bus_routes_app_exit_with_shutdown_param(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    from backend.shutdown import shutdown_marker_path

    monkeypatch.setattr(
        "backend.handlers.app.can_schedule_system_shutdown",
        lambda: True,
    )
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    bus = CommandBus()
    bus.register("app", "exit", handle_app_exit)
    gw = FakeGateway(task_state=4)
    gw.power_on = True
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-app-exit-shutdown",
        category="app",
        action="exit",
        params={"shutdown": True},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert gw.abort_program_calls == 1
    assert gw.power_on is False
    assert gw.task_state == 3
    assert shutdown_marker_path().is_file()


def test_command_bus_app_exit_shutdown_when_machine_already_off(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        "backend.handlers.app.can_schedule_system_shutdown",
        lambda: True,
    )
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    bus = CommandBus()
    bus.register("app", "exit", handle_app_exit)
    gw = FakeGateway(task_state=3)
    gw.power_on = False
    ctx = AppContext(manager=ConnectionManager(), gateway=gw)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-app-exit-shutdown-off",
        category="app",
        action="exit",
        params={"shutdown": True},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert gw.abort_program_calls == 0


def test_command_bus_routes_app_exit_shutdown_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "backend.handlers.app.can_schedule_system_shutdown",
        lambda: False,
    )
    bus = CommandBus()
    bus.register("app", "exit", handle_app_exit)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-app-exit-shutdown-denied",
        category="app",
        action="exit",
        params={"shutdown": True},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "shutdown_unavailable"


def test_command_bus_routes_app_exit_invalid_params() -> None:
    bus = CommandBus()
    bus.register("app", "exit", handle_app_exit)
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-app-exit-bad",
        category="app",
        action="exit",
        params={"oops": True},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"
