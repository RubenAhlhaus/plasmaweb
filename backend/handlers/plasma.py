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
from backend.plasma.materials import MaterialError

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


class PlasmaMaterialParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    number: int


class PlasmaSaveMaterialParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    number: int
    name: str
    values: dict


class PlasmaSaveParametersParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    values: dict


def _no_config(command: CommandEnvelope) -> DispatchResult:
    return DispatchResult(
        ack=build_error(
            command.commandId,
            "plasma_config_unavailable",
            "The machine's material and parameter files could not be located (no INI).",
        )
    )


def _material_error(command: CommandEnvelope, exc: MaterialError) -> DispatchResult:
    return DispatchResult(ack=build_error(command.commandId, exc.code, exc.message))


async def handle_plasma_get_materials(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma_config is None:
        return _no_config(command)
    return DispatchResult(ack=build_ok(command.commandId, ctx.plasma_config.materials_payload()))


async def handle_plasma_select_material(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma_config is None:
        return _no_config(command)
    try:
        params = PlasmaMaterialParams.model_validate(command.params)
    except ValidationError:
        return _invalid(command, 'plasma.select_material params: {"number": int}')
    try:
        refused = ctx.plasma_config.select_material(params.number)
    except MaterialError as exc:
        return _material_error(command, exc)
    return DispatchResult(
        ack=build_ok(
            command.commandId, {"number": params.number, "refusedPins": list(refused)}
        )
    )


async def handle_plasma_save_material(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma_config is None:
        return _no_config(command)
    try:
        params = PlasmaSaveMaterialParams.model_validate(command.params)
    except ValidationError:
        return _invalid(
            command,
            'plasma.save_material params: {"number": int, "name": string, "values": object}',
        )
    try:
        material = ctx.plasma_config.save_material(params.number, params.name, params.values)
    except MaterialError as exc:
        return _material_error(command, exc)
    except OSError as exc:
        return DispatchResult(ack=build_error(command.commandId, "write_failed", str(exc)))
    return DispatchResult(ack=build_ok(command.commandId, {"material": material.as_dict()}))


async def handle_plasma_delete_material(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma_config is None:
        return _no_config(command)
    try:
        params = PlasmaMaterialParams.model_validate(command.params)
    except ValidationError:
        return _invalid(command, 'plasma.delete_material params: {"number": int}')
    try:
        ctx.plasma_config.delete_material(params.number)
    except MaterialError as exc:
        return _material_error(command, exc)
    except OSError as exc:
        return DispatchResult(ack=build_error(command.commandId, "write_failed", str(exc)))
    return DispatchResult(ack=build_ok(command.commandId, {"number": params.number}))


async def handle_plasma_set_default_material(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma_config is None:
        return _no_config(command)
    try:
        params = PlasmaMaterialParams.model_validate(command.params)
    except ValidationError:
        return _invalid(command, 'plasma.set_default_material params: {"number": int}')
    try:
        ctx.plasma_config.set_default_material(params.number)
    except MaterialError as exc:
        return _material_error(command, exc)
    except OSError as exc:
        return DispatchResult(ack=build_error(command.commandId, "write_failed", str(exc)))
    return DispatchResult(ack=build_ok(command.commandId, {"number": params.number}))


async def handle_plasma_get_parameters(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma_config is None:
        return _no_config(command)
    return DispatchResult(ack=build_ok(command.commandId, ctx.plasma_config.parameters_payload()))


async def handle_plasma_save_parameters(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma_config is None:
        return _no_config(command)
    try:
        params = PlasmaSaveParametersParams.model_validate(command.params)
    except ValidationError:
        return _invalid(command, 'plasma.save_parameters params: {"values": object}')
    try:
        values = ctx.plasma_config.save_parameters(params.values)
    except (TypeError, ValueError) as exc:
        return DispatchResult(ack=build_error(command.commandId, "invalid_value", str(exc)))
    except OSError as exc:
        return DispatchResult(ack=build_error(command.commandId, "write_failed", str(exc)))
    return DispatchResult(ack=build_ok(command.commandId, {"values": values}))


async def handle_plasma_reload_config(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """QtPlasmaC's RELOAD buttons: re-read both files and put them back on the pins."""
    if ctx.plasma_config is None:
        return _no_config(command)
    try:
        PlasmaEmptyParams.model_validate(command.params or {})
    except ValidationError:
        return _invalid(command, "plasma.reload_config params: {}")
    ctx.plasma_config.reload()
    return DispatchResult(
        ack=build_ok(
            command.commandId,
            {
                "materials": ctx.plasma_config.materials_payload(),
                "parameters": ctx.plasma_config.parameters_payload(),
            },
        )
    )
