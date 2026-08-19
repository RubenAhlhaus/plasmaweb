import asyncio
from datetime import datetime, timezone
from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend import config
from backend.adapters.linuxcnc_gateway import GatewayCommandResult, normalize_task_state_param
from backend.application.command_bus import DispatchResult
from backend.application.context import AppContext
from backend.contracts.messages import (
    CommandEnvelope,
    EventMessage,
    build_error,
    build_ok,
)
from backend.handlers.gateway_ack import gateway_result_to_dispatch


class MachinePowerParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    on: bool


async def handle_machine_power(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = MachinePowerParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                "Expected params: {\"on\": true|false}.",
            )
        )

    power_state = ctx.gateway.set_power(params.on)
    power_label: Literal["on", "off"] = "on" if power_state else "off"

    event = EventMessage(
        type="machine_event",
        event="machine.power.changed",
        payload={"on": power_state, "state": power_label},
    )
    return DispatchResult(ack=build_ok(command.commandId), events=[event])


class MachineTaskStateParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Frontend sendet aktuell numeric enums (1..4), laut Doku sind auch Strings möglich.
    status: Union[int, str]


class MachineGetIniConfigParams(BaseModel):
    model_config = ConfigDict(extra="forbid")


async def handle_machine_set_task_state(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = MachineTaskStateParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected params: {"status": 1|2|3|4 or "STATE_*"}.',
            )
        )

    normalized = normalize_task_state_param(params.status)
    _STATE_ESTOP = 1
    _STATE_ESTOP_RESET = 2
    _ESTOP_RESET_VERIFY_RETRIES = 5
    _ESTOP_RESET_VERIFY_INTERVAL_S = 0.05

    ctx.gateway.set_task_state(params.status)
    machine: dict = {}
    actual_ts: int | None = None

    def _read_task_state_once() -> int | None:
        nonlocal machine
        snap = ctx.gateway.get_status_snapshot()
        machine = snap.get("machine") or {}
        actual_raw = machine.get("task_state")
        return int(actual_raw) if actual_raw is not None else None

    actual_ts = _read_task_state_once()

    # LinuxCNC can still report ESTOP for a short moment right after state(ESTOP_RESET).
    # Retry briefly before classifying the reset as rejected.
    if normalized == _STATE_ESTOP_RESET and actual_ts == _STATE_ESTOP:
        for _ in range(_ESTOP_RESET_VERIFY_RETRIES):
            await asyncio.sleep(_ESTOP_RESET_VERIFY_INTERVAL_S)
            actual_ts = _read_task_state_once()
            if actual_ts != _STATE_ESTOP:
                break

    if normalized == _STATE_ESTOP_RESET and actual_ts == _STATE_ESTOP:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "estop_reset_rejected",
                (
                    "Not-Aus konnte nicht zurückgesetzt werden. "
                    "Hardware-Not-Aus oder externe Freigabe prüfen."
                ),
            )
        )

    power_on = bool(machine.get("powerOn"))
    power_label: Literal["on", "off"] = "on" if power_on else "off"

    event = EventMessage(
        type="machine_event",
        event="machine.task_state.changed",
        payload={
            "on": power_on,
            "state": power_label,
            **({"task_state": actual_ts} if actual_ts is not None else {}),
        },
    )
    return DispatchResult(ack=build_ok(command.commandId), events=[event])


async def handle_machine_get_ini_config(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        # We currently do not accept params for this command.
        MachineGetIniConfigParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected params: {}.',
            )
        )

    # Always re-read from disk: INI may have been unavailable on an early call, and
    # linuxcnc.ini must be used (configparser fails on duplicate INI keys).
    payload = ctx.gateway.get_ini_runtime_config(force_reload=True)
    payload["loaded_at"] = datetime.now(timezone.utc).isoformat()
    event = EventMessage(
        type="machine_event",
        event="machine.ini_config.loaded",
        payload=payload,
    )
    return DispatchResult(ack=build_ok(command.commandId), events=[event])


class MachineFloodParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    on: bool


class MachineMistParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    on: bool


class MachineSpindleParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    direction: Literal["forward", "reverse", "stop"]
    speed: Optional[float] = None
    spindle: int = Field(default=0, ge=0)


def _gateway_error_dispatch(
    command_id: str, result: GatewayCommandResult
) -> Optional[DispatchResult]:
    """If `result` is a gateway failure, build a command_result error ACK."""
    if result.ok:
        return None
    code = result.error_code or "handler_failed"
    message = (
        result.error_message
        or "Internal error: gateway returned failure without error details."
    )
    return DispatchResult(ack=build_error(command_id, code, message))


def _dispatch_io_result(
    command_id: str,
    result: GatewayCommandResult,
    event_name: str,
    payload: dict,
) -> DispatchResult:
    err = _gateway_error_dispatch(command_id, result)
    if err is not None:
        return err
    if result.noop:
        return DispatchResult(ack=build_ok(command_id), events=[])
    return DispatchResult(
        ack=build_ok(command_id),
        events=[
            EventMessage(
                type="machine_event",
                event=event_name,
                payload=payload,
            )
        ],
    )


async def handle_machine_flood(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = MachineFloodParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected params: {"on": true|false}.',
            )
        )

    result = ctx.gateway.set_flood(params.on)
    return _dispatch_io_result(
        command.commandId, result, "machine.flood.changed", {"on": params.on}
    )


async def handle_machine_mist(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = MachineMistParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected params: {"on": true|false}.',
            )
        )

    result = ctx.gateway.set_mist(params.on)
    return _dispatch_io_result(
        command.commandId, result, "machine.mist.changed", {"on": params.on}
    )


async def handle_machine_spindle(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = MachineSpindleParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected params: {"direction": "forward"|"reverse"|"stop", '
                '"speed"?: number, "spindle"?: number >= 0}.',
            )
        )

    result = ctx.gateway.set_spindle(
        params.direction,
        speed_rpm=params.speed,
        spindle_index=params.spindle,
    )
    err = _gateway_error_dispatch(command.commandId, result)
    if err is not None:
        return err

    payload: dict = {
        "direction": params.direction,
        "spindle": params.spindle,
    }
    if params.speed is not None:
        payload["speed"] = params.speed

    event = EventMessage(
        type="machine_event",
        event="machine.spindle.changed",
        payload=payload,
    )
    return DispatchResult(ack=build_ok(command.commandId), events=[event])


class MachineAbortParams(BaseModel):
    """Optional empty body for ``machine.abort`` (reject unknown keys)."""

    model_config = ConfigDict(extra="forbid")


async def handle_machine_abort(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        MachineAbortParams.model_validate(command.params or {})
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                "Expected no params or empty object {} for machine.abort.",
            ),
            events=[],
        )

    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, ctx.gateway.abort_program)
    return gateway_result_to_dispatch(command.commandId, result)


class MachineOverrideFactorParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    factor: float


class MachineSpindleOverrideParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    factor: float
    spindle: int = Field(default=0, ge=0)


async def handle_machine_feed_override(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = MachineOverrideFactorParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected params: {"factor": number} (1.0 = 100%).',
            )
        )

    result = ctx.gateway.set_feed_override(params.factor)
    err = _gateway_error_dispatch(command.commandId, result)
    if err is not None:
        return err
    return DispatchResult(ack=build_ok(command.commandId), events=[])


async def handle_machine_rapid_override(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = MachineOverrideFactorParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected params: {"factor": number} (1.0 = 100%).',
            )
        )

    result = ctx.gateway.set_rapid_override(params.factor)
    err = _gateway_error_dispatch(command.commandId, result)
    if err is not None:
        return err
    return DispatchResult(ack=build_ok(command.commandId), events=[])


async def handle_machine_spindle_override(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = MachineSpindleOverrideParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected params: {"factor": number, "spindle"?: number >= 0}.',
            )
        )

    result = ctx.gateway.set_spindle_override(params.factor, params.spindle)
    err = _gateway_error_dispatch(command.commandId, result)
    if err is not None:
        return err
    return DispatchResult(ack=build_ok(command.commandId), events=[])


class MachineToolChangeAckParams(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MachineToolChangeAbortParams(BaseModel):
    model_config = ConfigDict(extra="forbid")


async def handle_machine_tool_change_ack(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        MachineToolChangeAckParams.model_validate(command.params or {})
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                "Expected no params or empty object {} for machine.tool_change_ack.",
            )
        )

    ack_cmd = config.TOOLCHANGE_ACK_CMD.strip()
    if not ack_cmd:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "tool_change_ack_not_configured",
                (
                    "HAL-Quittierung nicht konfiguriert: Umgebungsvariable "
                    "LCNCGUI_TOOLCHANGE_ACK_CMD setzen (siehe Dokumentation)."
                ),
            )
        )

    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        None, ctx.gateway.run_shell_command, ack_cmd
    )
    return gateway_result_to_dispatch(command.commandId, result)


async def handle_machine_tool_change_abort(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        MachineToolChangeAbortParams.model_validate(command.params or {})
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                "Expected no params or empty object {} for machine.tool_change_abort.",
            )
        )

    extra = config.TOOLCHANGE_ABORT_EXTRA_CMD.strip() or None
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        None,
        ctx.gateway.tool_change_abort_with_optional_shell,
        extra,
    )
    return gateway_result_to_dispatch(command.commandId, result)
