import asyncio
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from backend.adapters.linuxcnc_gateway import GatewayCommandResult
from backend.application.command_bus import DispatchResult
from backend.application.context import AppContext
from backend.contracts.messages import build_error, build_ok


class ToolDeleteToolTableRowParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    toolno: int = Field(gt=0)


class ToolTouchOffParams(BaseModel):
    """Gmoccapy-style ``G10 L10`` tool touch-off (see ``LinuxCncGateway.tool_touch_off``)."""

    model_config = ConfigDict(extra="forbid")

    axis: Literal["x", "y", "z", "a", "b", "c", "u", "v", "w"]
    value: float

    @field_validator("axis", mode="before")
    @classmethod
    def normalize_axis(cls, value: object) -> object:
        if isinstance(value, str):
            return value.lower()
        return value


def _tool_row_validation_error_message(exc: ValidationError) -> str:
    """First Pydantic error for actionable ``invalid_params`` messages."""
    errors = exc.errors()
    if not errors:
        return "Parameter validation failed."
    e0 = errors[0]
    loc = ".".join(str(x) for x in e0.get("loc", ()))
    msg = str(e0.get("msg", "invalid"))
    detail = f"{loc}: {msg}" if loc else msg
    return (
        f"{detail} — Erwartet u. a. toolno (int > 0), optional new_toolno nur bei update, "
        "pocket/offsets/Geometrie, lcncgui_meta, lcncgui_presets. Siehe docs/commands-events.md."
    )


class ToolTableRowWriteParamsBase(BaseModel):
    """Shared row fields for add/update.

    ``extra="ignore"``: Clients (JSON/Proxies) dürfen null-Werte oder unbekannte Keys mitschicken,
    ohne dass das Kommando scheitert; das Gateway sieht nur die modellierten Felder.
    """

    model_config = ConfigDict(extra="ignore")

    toolno: int = Field(gt=0)
    pocket: Optional[int] = None
    diameter: Optional[float] = None
    xoffset: Optional[float] = None
    yoffset: Optional[float] = None
    zoffset: Optional[float] = None
    aoffset: Optional[float] = None
    boffset: Optional[float] = None
    coffset: Optional[float] = None
    uoffset: Optional[float] = None
    voffset: Optional[float] = None
    woffset: Optional[float] = None
    frontangle: Optional[float] = None
    backangle: Optional[float] = None
    orientation: Optional[float] = None
    comment: Optional[str] = None
    lcncgui_meta: Optional[dict[str, Any]] = None
    lcncgui_presets: Optional[list[Any]] = None


class ToolUpdateToolTableRowParams(ToolTableRowWriteParamsBase):
    new_toolno: Optional[int] = Field(
        default=None,
        gt=0,
        description="If set and different from toolno, renumber the .tbl row and sidecar key.",
    )


def _gateway_result_to_ack(command_id: str, result: GatewayCommandResult) -> DispatchResult:
    if result.ok:
        return DispatchResult(
            ack=build_ok(command_id, result=result.result),
            events=[],
        )
    return DispatchResult(
        ack=build_error(
            command_id,
            result.error_code or "handler_failed",
            result.error_message or "Gateway returned failure without error details.",
        ),
        events=[],
    )


async def handle_tool_update_tool_table_row(command, ctx: AppContext) -> DispatchResult:  # type: ignore[no-untyped-def]
    try:
        params = ToolUpdateToolTableRowParams.model_validate(command.params)
    except ValidationError as exc:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                _tool_row_validation_error_message(exc),
            ),
            events=[],
        )

    loop = asyncio.get_running_loop()
    payload = params.model_dump(mode="json", exclude_none=True, exclude_unset=True)
    result = await loop.run_in_executor(None, ctx.gateway.update_tool_table_row, payload)
    return _gateway_result_to_ack(command.commandId, result)


async def handle_tool_delete_tool_table_row(command, ctx: AppContext) -> DispatchResult:  # type: ignore[no-untyped-def]
    try:
        params = ToolDeleteToolTableRowParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                "Expected params: toolno (int > 0) — see docs/commands-events.md.",
            ),
            events=[],
        )

    loop = asyncio.get_running_loop()
    payload = params.model_dump(mode="json", exclude_none=True)
    result = await loop.run_in_executor(None, ctx.gateway.delete_tool_table_row, payload)
    return _gateway_result_to_ack(command.commandId, result)


async def handle_tool_add_tool_table_row(command, ctx: AppContext) -> DispatchResult:  # type: ignore[no-untyped-def]
    try:
        params = ToolTableRowWriteParamsBase.model_validate(command.params)
    except ValidationError as exc:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                _tool_row_validation_error_message(exc),
            ),
            events=[],
        )

    loop = asyncio.get_running_loop()
    payload = params.model_dump(mode="json", exclude_none=True, exclude_unset=True)
    result = await loop.run_in_executor(None, ctx.gateway.add_tool_table_row, payload)
    return _gateway_result_to_ack(command.commandId, result)


async def handle_tool_touch_off(command, ctx: AppContext) -> DispatchResult:  # type: ignore[no-untyped-def]
    try:
        params = ToolTouchOffParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected params: {"axis": "x|y|z|a|b|c|u|v|w", "value": number}.',
            ),
            events=[],
        )

    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        None, ctx.gateway.tool_touch_off, params.axis, params.value
    )
    return _gateway_result_to_ack(command.commandId, result)
