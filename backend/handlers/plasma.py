"""WebSocket command handlers for the ``plasma`` category.

Same envelope as every other category (``backend/contracts/messages.py``); no protocol
change. Each handler validates its params, asks :class:`PlasmaService` to write, and reports
what happened. Nothing here waits on HAL: a write is queued for the bridge thread and the
resulting pin change arrives as a ``plasma.pins.changed`` event.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, ValidationError

from backend.application.command_bus import DispatchResult
from backend.application.context import AppContext
from backend.contracts.messages import CommandEnvelope, build_error, build_ok
from backend.plasma.hal_bridge import PinWriteRejected

logger = logging.getLogger(__name__)

#: QtPlasmaC drops ``torch-pulse-abort`` again 50 ms after raising it.
_ABORT_RELEASE_DELAY_S = 0.05


class PlasmaSetParamParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pin: str
    value: Any


class PlasmaSetEnableParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    enabled: bool


class PlasmaEnabledParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


class PlasmaHeightOverrideParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    volts: float


class PlasmaTorchPulseParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str
    seconds: Optional[float] = None


class PlasmaEmptyParams(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _unavailable(command: CommandEnvelope) -> DispatchResult:
    return DispatchResult(
        ack=build_error(
            command.commandId,
            "plasma_unavailable",
            "The plasma HAL bridge is not running (no LinuxCNC HAL in this process).",
        )
    )


def _invalid(command: CommandEnvelope, expected: str) -> DispatchResult:
    return DispatchResult(
        ack=build_error(command.commandId, "invalid_params", f"Expected {expected}.")
    )


def _rejected(command: CommandEnvelope, exc: PinWriteRejected) -> DispatchResult:
    return DispatchResult(ack=build_error(command.commandId, exc.code, exc.message))


async def handle_plasma_get_snapshot(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma is None:
        return _unavailable(command)
    return DispatchResult(ack=build_ok(command.commandId, ctx.plasma.snapshot_payload()))


async def handle_plasma_set_param(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma is None:
        return _unavailable(command)
    try:
        params = PlasmaSetParamParams.model_validate(command.params)
    except ValidationError:
        return _invalid(command, 'plasma.set_param params: {"pin": string, "value": any}')

    try:
        ctx.plasma.set_param(params.pin, params.value)
    except KeyError:
        return DispatchResult(
            ack=build_error(
                command.commandId, "unknown_pin", f"no such pin: plasmac.{params.pin}"
            )
        )
    except PinWriteRejected as exc:
        return _rejected(command, exc)
    except (TypeError, ValueError) as exc:
        return DispatchResult(
            ack=build_error(command.commandId, "invalid_value", str(exc))
        )
    return DispatchResult(ack=build_ok(command.commandId, {"pin": params.pin}))


async def handle_plasma_set_enable(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma is None:
        return _unavailable(command)
    try:
        params = PlasmaSetEnableParams.model_validate(command.params)
    except ValidationError:
        return _invalid(
            command, 'plasma.set_enable params: {"name": string, "enabled": bool}'
        )
    try:
        pin = ctx.plasma.set_enable(params.name, params.enabled)
    except PinWriteRejected as exc:
        return _rejected(command, exc)
    return DispatchResult(ack=build_ok(command.commandId, {"pin": pin}))


async def handle_plasma_torch_enable(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma is None:
        return _unavailable(command)
    try:
        params = PlasmaEnabledParams.model_validate(command.params)
    except ValidationError:
        return _invalid(command, 'plasma.torch_enable params: {"enabled": bool}')
    try:
        ctx.plasma.torch_enable(params.enabled)
    except PinWriteRejected as exc:
        return _rejected(command, exc)
    return DispatchResult(ack=build_ok(command.commandId, {"enabled": params.enabled}))


async def handle_plasma_thc_enable(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma is None:
        return _unavailable(command)
    try:
        params = PlasmaEnabledParams.model_validate(command.params)
    except ValidationError:
        return _invalid(command, 'plasma.thc_enable params: {"enabled": bool}')
    try:
        ctx.plasma.thc_enable(params.enabled)
    except PinWriteRejected as exc:
        return _rejected(command, exc)
    return DispatchResult(ack=build_ok(command.commandId, {"enabled": params.enabled}))


async def handle_plasma_height_override(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma is None:
        return _unavailable(command)
    try:
        params = PlasmaHeightOverrideParams.model_validate(command.params)
    except ValidationError:
        return _invalid(command, 'plasma.height_override params: {"volts": number}')
    try:
        ctx.plasma.height_override(params.volts)
    except PinWriteRejected as exc:
        return _rejected(command, exc)
    return DispatchResult(ack=build_ok(command.commandId, {"volts": params.volts}))


async def handle_plasma_torch_pulse(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma is None:
        return _unavailable(command)
    try:
        params = PlasmaTorchPulseParams.model_validate(command.params)
    except ValidationError:
        return _invalid(
            command,
            'plasma.torch_pulse params: {"action": "press"|"release"|"abort", '
            '"seconds": number (press only)}',
        )
    service = ctx.plasma
    try:
        action, skipped = service.torch_pulse(params.action, params.seconds)
    except PinWriteRejected as exc:
        return _rejected(command, exc)

    if action == "abort":
        # The abort pin is a pulse, not a state; drop it again without blocking the ack.
        asyncio.get_running_loop().create_task(_release_abort_pin(service))
    return DispatchResult(
        ack=build_ok(command.commandId, {"action": action, "skippedPins": skipped})
    )


async def _release_abort_pin(service: Any) -> None:
    await asyncio.sleep(_ABORT_RELEASE_DELAY_S)
    try:
        service.clear_torch_pulse_abort()
    except Exception:
        logger.exception("plasma: releasing torch-pulse-abort failed")
