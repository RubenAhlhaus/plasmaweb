import asyncio
import logging
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic import ValidationError

from backend.coordinate_system_ids import normalize_coordinate_system_id
from backend.coordinate_systems import merge_stored_coordinate_system_offsets

from backend.adapters.linuxcnc_gateway import GatewayCommandResult
from backend.application.command_bus import DispatchResult
from backend.application.context import AppContext
from backend.contracts.messages import (
    CommandEnvelope,
    ErrorDetails,
    build_async_accepted,
    build_command_completion,
    build_error,
    build_ok,
)

logger = logging.getLogger(__name__)


class MotionJogParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jointMode: bool
    index: int = Field(ge=0, le=8)
    velocity: float
    mode: Literal["continuous", "increment"]
    distance: Optional[float] = None

    @model_validator(mode="after")
    def distance_matches_mode(self) -> "MotionJogParams":
        if self.mode == "increment":
            if self.distance is None:
                raise ValueError("distance is required when mode is increment")
            if self.distance <= 0:
                raise ValueError("distance must be positive for incremental jog")
        elif self.distance is not None:
            raise ValueError("distance must be omitted when mode is continuous")
        return self


class MotionJogStopParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jointMode: bool
    index: int = Field(ge=0, le=8)


class MotionHomeUnhomeParams(BaseModel):
    """``joint``: ``-1`` = all joints; else joint index ``>= 0`` (see docs/commands-events.md)."""

    model_config = ConfigDict(extra="forbid")

    joint: int = Field(ge=-1)


class MotionSetAxisCoordinateParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    axis: Literal["x", "y", "z", "a", "b", "c", "u", "v", "w"]
    value: float

    @field_validator("axis", mode="before")
    @classmethod
    def normalize_axis(cls, value: object) -> object:
        if isinstance(value, str):
            return value.lower()
        return value


class MotionSetActiveCoordinateSystemParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    systemId: str = Field(min_length=1)

    @field_validator("systemId", mode="after")
    @classmethod
    def validate_system_id(cls, value: str) -> str:
        return normalize_coordinate_system_id(value)


class MotionSetCoordinateSystemOffsetParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    systemId: str = Field(min_length=1)
    x: float | None = None
    y: float | None = None
    z: float | None = None
    a: float | None = None
    b: float | None = None
    c: float | None = None
    u: float | None = None
    v: float | None = None
    w: float | None = None

    @field_validator("systemId", mode="after")
    @classmethod
    def validate_system_id(cls, value: str) -> str:
        return normalize_coordinate_system_id(value)

    @model_validator(mode="after")
    def at_least_one_axis(self) -> "MotionSetCoordinateSystemOffsetParams":
        axes = (self.x, self.y, self.z, self.a, self.b, self.c, self.u, self.v, self.w)
        if all(v is None for v in axes):
            raise ValueError("at least one axis offset is required")
        return self


def _gateway_error_dispatch_motion(
    command_id: str, result: GatewayCommandResult
) -> Optional[DispatchResult]:
    if result.ok:
        return None
    code = result.error_code or "handler_failed"
    message = (
        result.error_message
        or "Internal error: gateway returned failure without error details."
    )
    return DispatchResult(ack=build_error(command_id, code, message))


def _gateway_result_to_error_details(result: GatewayCommandResult) -> Optional[ErrorDetails]:
    if result.ok:
        return None
    return ErrorDetails(
        code=result.error_code or "handler_failed",
        message=result.error_message
        or "Gateway returned failure without error details.",
    )


async def _complete_motion_command(
    command_id: str,
    category: str,
    action: str,
    joint: int,
    ctx: AppContext,
    *,
    unhome: bool,
) -> None:
    loop = asyncio.get_running_loop()
    gw = ctx.gateway

    def work() -> GatewayCommandResult:
        return gw.unhome_motion_execute(joint) if unhome else gw.home_motion_execute(joint)

    try:
        result = await loop.run_in_executor(gw.blocking_executor, work)
    except Exception as exc:  # noqa: BLE001
        logger.exception("motion %s/%s executor failure", category, action)
        # If the execute path never ran, the gateway homing reservation might remain.
        # Clear it defensively so future homing commands are not blocked forever.
        try:
            gw._clear_homing_job()  # noqa: SLF001
        except Exception:
            pass
        result = GatewayCommandResult(
            ok=False,
            error_code="handler_failed",
            error_message=str(exc),
        )

    completion = build_command_completion(
        command_id,
        category,
        action,
        ok=result.ok,
        error=_gateway_result_to_error_details(result),
    )
    await ctx.manager.broadcast_json(completion.model_dump(exclude_none=True))


def _schedule_motion_completion(
    command_id: str,
    category: str,
    action: str,
    joint: int,
    ctx: AppContext,
    *,
    unhome: bool,
) -> None:
    async def _run() -> None:
        try:
            await _complete_motion_command(
                command_id, category, action, joint, ctx, unhome=unhome
            )
        except Exception:
            logger.exception("motion %s/%s completion task failed", category, action)

    asyncio.create_task(_run())


async def handle_motion_jog(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = MotionJogParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                "Expected motion.jog params: jointMode (bool), index (0-8), velocity (float), "
                'mode ("continuous"|"increment"), optional distance (positive, for increment).',
            )
        )

    result = ctx.gateway.jog_motion(
        joint_mode=params.jointMode,
        index=params.index,
        velocity_per_min=params.velocity,
        mode=params.mode,
        distance=params.distance,
    )
    err = _gateway_error_dispatch_motion(command.commandId, result)
    if err is not None:
        return err
    return DispatchResult(ack=build_ok(command.commandId), events=[])


async def handle_motion_jog_stop(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = MotionJogStopParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                "Expected motion.jog_stop params: jointMode (bool), index (0-8).",
            )
        )

    result = ctx.gateway.jog_stop(
        joint_mode=params.jointMode,
        index=params.index,
    )
    err = _gateway_error_dispatch_motion(command.commandId, result)
    if err is not None:
        return err
    return DispatchResult(ack=build_ok(command.commandId), events=[])


async def handle_motion_home(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = MotionHomeUnhomeParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected motion.home params: {"joint": number} — -1 for all joints, '
                "otherwise joint index ≥ 0.",
            )
        )

    pre = ctx.gateway.home_motion_precheck(params.joint)
    err = _gateway_error_dispatch_motion(command.commandId, pre)
    if err is not None:
        return err

    _schedule_motion_completion(
        command.commandId,
        "motion",
        "home",
        params.joint,
        ctx,
        unhome=False,
    )
    return DispatchResult(ack=build_async_accepted(command.commandId), events=[])


async def handle_motion_unhome(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = MotionHomeUnhomeParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected motion.unhome params: {"joint": number} — -1 for all joints, '
                "otherwise joint index ≥ 0.",
            )
        )

    pre = ctx.gateway.unhome_motion_precheck(params.joint)
    err = _gateway_error_dispatch_motion(command.commandId, pre)
    if err is not None:
        return err

    _schedule_motion_completion(
        command.commandId,
        "motion",
        "unhome",
        params.joint,
        ctx,
        unhome=True,
    )
    return DispatchResult(ack=build_async_accepted(command.commandId), events=[])


async def handle_motion_set_axis_coordinate(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = MotionSetAxisCoordinateParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected motion.set_axis_coordinate params: {"axis": "x|y|z|a|b|c|u|v|w", "value": number}.',
            )
        )

    result = ctx.gateway.set_axis_coordinate(params.axis, params.value)
    err = _gateway_error_dispatch_motion(command.commandId, result)
    if err is not None:
        return err
    return DispatchResult(ack=build_ok(command.commandId), events=[])


async def handle_motion_set_active_coordinate_system(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = MotionSetActiveCoordinateSystemParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                "Expected motion.set_active_coordinate_system params: "
                '{"systemId": string} — one of 0, G54, G55, G56, G57, G58, G59, '
                "G59.1, G59.2, G59.3.",
            )
        )

    result = ctx.gateway.set_active_coordinate_system(params.systemId)
    err = _gateway_error_dispatch_motion(command.commandId, result)
    if err is not None:
        return err

    return DispatchResult(ack=build_ok(command.commandId), events=[])


async def handle_motion_set_coordinate_system_offset(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = MotionSetCoordinateSystemOffsetParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                "Expected motion.set_coordinate_system_offset params: "
                '{"systemId": string, optional x,y,z,a,b,c,u,v,w numbers} — '
                "at least one axis required.",
            )
        )

    axis_payload: dict[str, float] = {}
    for name in ("x", "y", "z", "a", "b", "c", "u", "v", "w"):
        v = getattr(params, name)
        if v is not None:
            axis_payload[name] = float(v)

    result = ctx.gateway.set_coordinate_system_offset(params.systemId, axis_payload)
    err = _gateway_error_dispatch_motion(command.commandId, result)
    if err is not None:
        return err

    stored = axis_payload
    if isinstance(result.result, dict):
        g5x = result.result.get("g5x_offsets")
        if isinstance(g5x, dict) and g5x:
            stored = {str(k): float(v) for k, v in g5x.items()}
    merge_stored_coordinate_system_offsets(params.systemId, stored)
    return DispatchResult(ack=build_ok(command.commandId), events=[])
