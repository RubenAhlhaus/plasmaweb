import asyncio
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend import config
from backend.application.command_bus import DispatchResult
from backend.application.context import AppContext
from backend.contracts.messages import CommandEnvelope, build_error
from backend.handlers.gateway_ack import gateway_result_to_dispatch

HalSoftkeySlot = Literal[14, 15, 16]


class HalSoftkeyPulseParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slot: HalSoftkeySlot


class HalJogWheelScaleParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scale: float = Field(..., gt=0)


async def handle_hal_softkey_pulse(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = HalSoftkeyPulseParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected params: {"slot": 14|15|16}.',
            )
        )

    pin = config.HAL_SOFTKEY_TRIGGER_PINS.get(params.slot, "").strip()
    if not pin:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "hal_softkey_pin_not_configured",
                f"No HAL trigger pin configured for softkey slot {params.slot}.",
            )
        )

    result = await asyncio.to_thread(
        ctx.gateway.hal_pulse_rising_edge,
        pin,
        timeout_s=config.TOOLCHANGE_HALCMD_TIMEOUT_S,
    )
    return gateway_result_to_dispatch(command.commandId, result)


async def handle_hal_set_jog_wheel_scale(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    try:
        params = HalJogWheelScaleParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected params: {"scale": number > 0}.',
            )
        )

    result = await asyncio.to_thread(
        ctx.gateway.set_jog_wheel_scale,
        params.scale,
        timeout_s=config.TOOLCHANGE_HALCMD_TIMEOUT_S,
    )
    return gateway_result_to_dispatch(command.commandId, result)
