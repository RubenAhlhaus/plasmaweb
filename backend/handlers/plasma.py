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
    # QtPlasmaC remembers six of these between runs; the rest are session-only.
    if ctx.plasma_config is not None:
        ctx.plasma_config.save_enable(pin, params.enabled)
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
    if ctx.plasma_config is not None:
        ctx.plasma_config.save_enable("thc-enable", params.enabled)
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
    await _broadcast_config(ctx, materials=True, parameters=False)
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
    await _broadcast_config(ctx, materials=True, parameters=False)
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
    await _broadcast_config(ctx, materials=True, parameters=False)
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
    await _broadcast_config(ctx, materials=True, parameters=False)
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
    await _broadcast_config(ctx, materials=False, parameters=True)
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
    await _broadcast_config(ctx, materials=True, parameters=True)
    return DispatchResult(
        ack=build_ok(
            command.commandId,
            {
                "materials": ctx.plasma_config.materials_payload(),
                "parameters": ctx.plasma_config.parameters_payload(),
            },
        )
    )


async def _broadcast_config(ctx: AppContext, materials: bool, parameters: bool) -> None:
    """Tell every client what changed. A shop may well have the panel and a laptop open."""
    if ctx.plasma_config is None:
        return
    from backend.plasma.config_service import MATERIALS_EVENT, PARAMETERS_EVENT

    events = []
    if materials:
        events.append((MATERIALS_EVENT, ctx.plasma_config.materials_payload()))
    if parameters:
        events.append((PARAMETERS_EVENT, ctx.plasma_config.parameters_payload()))
    for event, payload in events:
        await ctx.manager.broadcast_json(
            {
                "type": "machine_event",
                "protocolVersion": 1,
                "event": event,
                "payload": payload,
            }
        )


class PlasmaToolpathParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    #: Defaults to whatever LinuxCNC has loaded.
    path: Optional[str] = None
    maxPoints: Optional[int] = None


class PlasmaRunFromLineParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    line: int
    runType: str = "here"
    leadinLength: float = 0.0
    leadinAngle: float = 0.0
    #: Load the generated program afterwards, as QtPlasmaC's RUN does. Off for a dry check.
    load: bool = True


async def handle_plasma_toolpath(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """Preview a program by running LinuxCNC's interpreter over it.

    The parse is CPU-bound C code, so it goes to a thread: a big program must not stall the
    event loop, and with it every other client's status stream.
    """
    from backend.plasma.toolpath import MAX_POINTS, ToolpathError, parse_toolpath

    try:
        params = PlasmaToolpathParams.model_validate(command.params or {})
    except ValidationError:
        return _invalid(command, 'plasma.toolpath params: {"path": string (optional)}')

    path = params.path or ctx.gateway.current_program_path()
    if not path:
        return DispatchResult(
            ack=build_error(command.commandId, "no_program", "No program is loaded.")
        )

    try:
        preview = await asyncio.to_thread(
            parse_toolpath,
            path,
            ctx.gateway.resolve_ini_path(),
            params.maxPoints or MAX_POINTS,
        )
    except ToolpathError as exc:
        return DispatchResult(ack=build_error(command.commandId, exc.code, exc.message))
    return DispatchResult(ack=build_ok(command.commandId, preview))


async def handle_plasma_run_from_line(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """Build (and normally load) a program that restarts at one line, QtPlasmaC's RFL."""
    import os

    from backend.plasma.run_from_line import (
        DEFAULT_OUTPUT_DIR,
        RunFromLineError,
        build_run_from_line,
    )

    try:
        params = PlasmaRunFromLineParams.model_validate(command.params)
    except ValidationError:
        return _invalid(
            command,
            'plasma.run_from_line params: {"line": int, "runType": "here"|"cut", '
            '"leadinLength": number, "leadinAngle": number}',
        )

    path = ctx.gateway.current_program_path()
    if not path:
        return DispatchResult(
            ack=build_error(command.commandId, "no_program", "No program is loaded.")
        )

    units_per_mm = 1.0
    if ctx.plasma_config is not None:
        units_per_mm = ctx.plasma_config.files.units_per_mm

    # QtPlasmaC writes its rfl.ngc under /tmp, but `program.open` only loads files under
    # [DISPLAY] PROGRAM_PREFIX — a guard worth keeping, since a browser is on the other end of
    # it. So the generated program goes into the machine's own program directory when there is
    # a writable one, which also means the operator can see and reopen it afterwards.
    output_dir = DEFAULT_OUTPUT_DIR
    for prefix in ctx.gateway.get_program_prefix_directories():
        if os.path.isdir(prefix) and os.access(prefix, os.W_OK):
            output_dir = prefix
            break

    try:
        result = await asyncio.to_thread(
            build_run_from_line,
            path,
            params.line,
            params.runType,
            units_per_mm,
            params.leadinLength,
            params.leadinAngle,
            output_dir,
        )
    except RunFromLineError as exc:
        return DispatchResult(
            ack=build_error(command.commandId, exc.code, exc.message)
        )
    except OSError as exc:
        return DispatchResult(ack=build_error(command.commandId, "write_failed", str(exc)))

    result["source"] = path
    if params.load:
        opened = ctx.gateway.program_open(result["path"])
        if not opened.ok:
            return DispatchResult(
                ack=build_error(
                    command.commandId,
                    opened.error_code or "open_failed",
                    opened.error_message or "Could not load the run-from-line program.",
                )
            )
        result["loaded"] = True
    return DispatchResult(ack=build_ok(command.commandId, result))
