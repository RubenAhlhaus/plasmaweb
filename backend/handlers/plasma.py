"""WebSocket command handlers for the ``plasma`` category.

Same envelope as every other category (``backend/contracts/messages.py``); no protocol
change. Each handler validates its params, asks :class:`PlasmaService` to write, and reports
what happened. Nothing here waits on HAL: a write is queued for the bridge thread and the
resulting pin change arrives as a ``plasma.pins.changed`` event.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict, ValidationError

from backend.application.command_bus import DispatchResult
from backend.application.context import AppContext
from backend.contracts.messages import CommandEnvelope, build_error, build_ok
from backend.plasma.hal_bridge import PinWriteRejected
from backend.plasma.materials import MaterialError

logger = logging.getLogger(__name__)

#: QtPlasmaC drops ``torch-pulse-abort`` again 50 ms after raising it.
_ABORT_RELEASE_DELAY_S = 0.05

#: Where a saved conversational job goes, under the machine's program directory.
CONVERSATIONAL_JOB_NAME = "conversational.ngc"


def parse_toolpath_text(gcode: str, ini_path: Optional[str]) -> Any:
    """Preview program text: the interpreter parses files, so the text gets one."""
    import os
    import tempfile

    from backend.plasma.toolpath import parse_toolpath

    handle, path = tempfile.mkstemp(prefix="lcncgui-preview-", suffix=".ngc")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as sink:
            sink.write(gcode)
        return parse_toolpath(path, ini_path)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


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
    #: Program text to preview instead of a file — a conversational job that is not saved yet.
    gcode: Optional[str] = None
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

    import os
    import tempfile

    scratch = None
    if params.gcode is not None:
        # The interpreter parses files, so unsaved text gets one — which is also how the
        # conversational screen previews a shape before anyone decides to keep it.
        handle, scratch = tempfile.mkstemp(prefix="lcncgui-preview-", suffix=".ngc")
        with os.fdopen(handle, "w", encoding="utf-8") as sink:
            sink.write(params.gcode)
        path: Optional[str] = scratch
    else:
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
    finally:
        if scratch:
            try:
                os.unlink(scratch)
            except OSError:
                pass
    if scratch:
        # Do not hand back a path that no longer exists.
        preview["path"] = ""
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


class PlasmaConversationalParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    shape: str
    params: dict
    #: The job the shape is added to; omit to start a new one.
    job: Optional[str] = None
    #: Write the job to this path and load it, the way QtPlasmaC's SAVE does.
    save: bool = False


async def handle_plasma_conversational_shapes(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """What this LinuxCNC can generate: the shapes, the line segments and the array.

    All three lists come from the installed modules' own signatures, because the two LinuxCNC
    generations differ — 2.9.4's array takes ``cOffset``/``convMirror``, 2.10's takes
    ``cSpacing``/``doMirror`` — and a UI built from the list works against both.
    """
    from backend.plasma.conversational import (
        ConversationalError,
        block_parameters,
        line_segment_kinds,
        shapes,
    )

    payload: Dict[str, Any] = {"shapes": shapes()}
    for key, reader in (("line", line_segment_kinds), ("block", block_parameters)):
        try:
            payload[key] = list(reader()) if key == "block" else reader()
        except ConversationalError as exc:
            logger.info("plasma: conversational %s unavailable: %s", key, exc.message)
            payload[key] = None
    return DispatchResult(ack=build_ok(command.commandId, payload))


async def handle_plasma_conversational_generate(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """Generate a shape through LinuxCNC's own conversational modules."""
    import os

    from backend.plasma.conversational import ConversationalError, generate

    try:
        params = PlasmaConversationalParams.model_validate(command.params)
    except ValidationError:
        return _invalid(
            command,
            'plasma.conversational params: {"shape": string, "params": object, '
            '"job": string (optional), "save": bool}',
        )

    material = (0, "Default")
    preamble = None
    postamble = None
    units = "mm"
    defaults: dict = {}
    if ctx.plasma_config is not None:
        material = ctx.plasma_config.selected_material
        preamble, postamble = ctx.plasma_config.conversational_ambles()
        units = "inch" if ctx.plasma_config.files.units_per_mm != 1.0 else "mm"
        # Machine-supplied values (kerf from the material, leadin from the prefs), so a form
        # only has to carry the shape's geometry. Anything the form does send wins.
        defaults = ctx.plasma_config.conversational_defaults()

    try:
        result = await asyncio.to_thread(
            generate,
            params.shape,
            params.params,
            params.job,
            material,
            preamble,
            postamble,
            units,
            defaults,
        )
    except ConversationalError as exc:
        return DispatchResult(ack=build_error(command.commandId, exc.code, exc.message))

    if result.get("error") or not params.save:
        return DispatchResult(ack=build_ok(command.commandId, result))

    # Saving means writing the job where the machine can open it, then opening it — the same
    # place run-from-line writes for the same reason (program.open only loads files there).
    directory = None
    for prefix in ctx.gateway.get_program_prefix_directories():
        if os.path.isdir(prefix) and os.access(prefix, os.W_OK):
            directory = prefix
            break
    if directory is None:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "no_program_directory",
                "No writable [DISPLAY] PROGRAM_PREFIX directory to save the job into.",
            )
        )

    path = os.path.join(directory, CONVERSATIONAL_JOB_NAME)
    try:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(result["gcode"])
    except OSError as exc:
        return DispatchResult(ack=build_error(command.commandId, "write_failed", str(exc)))

    opened = ctx.gateway.program_open(path)
    if not opened.ok:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                opened.error_code or "open_failed",
                opened.error_message or "Could not load the conversational job.",
            )
        )
    result["path"] = path
    result["loaded"] = True
    return DispatchResult(ack=build_ok(command.commandId, result))


class PlasmaConversationalLineParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    segments: list
    startX: float = 0.0
    startY: float = 0.0
    job: Optional[str] = None
    save: bool = False


class PlasmaConversationalBlockParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    params: dict
    #: The job to array. Defaults to the loaded program, which is how QtPlasmaC's block works.
    job: Optional[str] = None
    save: bool = False


async def _save_job(ctx: AppContext, gcode: str) -> Any:
    """Write a job where the machine can open it and load it. Returns the path or an error dict."""
    import os

    directory = None
    for prefix in ctx.gateway.get_program_prefix_directories():
        if os.path.isdir(prefix) and os.access(prefix, os.W_OK):
            directory = prefix
            break
    if directory is None:
        return {
            "code": "no_program_directory",
            "message": "No writable [DISPLAY] PROGRAM_PREFIX directory to save the job into.",
        }

    path = os.path.join(directory, CONVERSATIONAL_JOB_NAME)
    try:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(gcode)
    except OSError as exc:
        return {"code": "write_failed", "message": str(exc)}

    opened = ctx.gateway.program_open(path)
    if not opened.ok:
        return {
            "code": opened.error_code or "open_failed",
            "message": opened.error_message or "Could not load the job.",
        }
    return path


async def handle_plasma_conversational_line(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """Build a multi-segment cut of lines and arcs through LinuxCNC's own line module."""
    from backend.plasma.conversational import ConversationalError, generate_line

    try:
        params = PlasmaConversationalLineParams.model_validate(command.params)
    except ValidationError:
        return _invalid(
            command,
            'plasma.conversational_line params: {"segments": [{"kind": …}], '
            '"startX": number, "startY": number}',
        )

    material = (0, "Default")
    preamble = postamble = None
    units = "mm"
    if ctx.plasma_config is not None:
        material = ctx.plasma_config.selected_material
        preamble, postamble = ctx.plasma_config.conversational_ambles()
        units = "inch" if ctx.plasma_config.files.units_per_mm != 1.0 else "mm"

    try:
        result = await asyncio.to_thread(
            generate_line,
            params.segments,
            (params.startX, params.startY),
            params.job,
            material,
            preamble,
            postamble,
            units,
        )
    except ConversationalError as exc:
        return DispatchResult(ack=build_error(command.commandId, exc.code, exc.message))

    if result.get("error") or not params.save:
        return DispatchResult(ack=build_ok(command.commandId, result))

    saved = await _save_job(ctx, result["gcode"])
    if isinstance(saved, dict):
        return DispatchResult(
            ack=build_error(command.commandId, saved["code"], saved["message"])
        )
    result["path"] = saved
    result["loaded"] = True
    return DispatchResult(ack=build_ok(command.commandId, result))


async def handle_plasma_conversational_block(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """Array, rotate, scale, mirror or flip a job — QtPlasmaC's block operations."""
    from backend.plasma.conversational import ConversationalError, generate_block
    from backend.plasma.toolpath import ToolpathError, parse_toolpath

    try:
        params = PlasmaConversationalBlockParams.model_validate(command.params)
    except ValidationError:
        return _invalid(command, 'plasma.conversational_block params: {"params": object}')

    job = params.job
    if job is None:
        path = ctx.gateway.current_program_path()
        if not path:
            return DispatchResult(
                ack=build_error(command.commandId, "no_program", "No program is loaded.")
            )
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as handle:
                job = handle.read()
        except OSError as exc:
            return DispatchResult(ack=build_error(command.commandId, "read_failed", str(exc)))

    # Upstream measures the shape's centre off its preview widget; we measure it off the
    # toolpath, which is the same measurement taken from the same interpreter output.
    try:
        preview = await asyncio.to_thread(
            parse_toolpath_text, job, ctx.gateway.resolve_ini_path()
        )
    except ToolpathError as exc:
        return DispatchResult(ack=build_error(command.commandId, exc.code, exc.message))

    extents = preview.get("extents")
    if not extents:
        return DispatchResult(
            ack=build_error(
                command.commandId, "empty_program", "That program has nothing to array."
            )
        )
    midpoint = (
        (extents["min"][0] + extents["max"][0]) / 2,
        (extents["min"][1] + extents["max"][1]) / 2,
    )

    try:
        result = await asyncio.to_thread(generate_block, job, params.params, midpoint)
    except ConversationalError as exc:
        return DispatchResult(ack=build_error(command.commandId, exc.code, exc.message))

    if result.get("error") or not params.save:
        return DispatchResult(ack=build_ok(command.commandId, result))

    saved = await _save_job(ctx, result["gcode"])
    if isinstance(saved, dict):
        return DispatchResult(
            ack=build_error(command.commandId, saved["code"], saved["message"])
        )
    result["path"] = saved
    result["loaded"] = True
    return DispatchResult(ack=build_ok(command.commandId, result))


class PlasmaConversationalSettingsParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    values: dict


async def handle_plasma_get_conversational_settings(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma_config is None:
        return _no_config(command)
    return DispatchResult(
        ack=build_ok(
            command.commandId, {"settings": ctx.plasma_config.conversational_settings()}
        )
    )


async def handle_plasma_save_conversational_settings(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """Store the conversational settings; they take effect on the next generated shape."""
    if ctx.plasma_config is None:
        return _no_config(command)
    try:
        params = PlasmaConversationalSettingsParams.model_validate(command.params)
    except ValidationError:
        return _invalid(command, 'plasma.save_conversational_settings params: {"values": object}')
    try:
        settings = ctx.plasma_config.save_conversational_settings(params.values)
    except (TypeError, ValueError) as exc:
        return DispatchResult(ack=build_error(command.commandId, "invalid_value", str(exc)))
    except OSError as exc:
        return DispatchResult(ack=build_error(command.commandId, "write_failed", str(exc)))
    return DispatchResult(ack=build_ok(command.commandId, {"settings": settings}))


class PlasmaProbeTestParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    #: 0 stops a running test, which is also what a second press does upstream.
    seconds: float = 0.0


class PlasmaCutRecoveryParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str
    #: `move`: -1 back, 0 stop, +1 forward, at `speedPercent` of the cut feed rate.
    direction: int = 0
    speedPercent: float = 100.0
    #: `offset`: whole kerf widths sideways.
    x: int = 0
    y: int = 0


async def handle_plasma_probe_test(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """Timed probe test. The timer lives here, so a closed browser cannot leave it probing.

    A request while one is already running **aborts** it rather than starting another, which is
    what upstream's second press does — and what keeps one shared pin from being owned by two
    timers at once. The service owns the countdown, because it owns the pin.
    """
    if ctx.plasma is None:
        return _unavailable(command)
    try:
        params = PlasmaProbeTestParams.model_validate(command.params or {})
    except ValidationError:
        return _invalid(command, 'plasma.probe_test params: {"seconds": number}')

    service = ctx.plasma
    was_running = service.probe_test_running()
    if params.seconds <= 0 or was_running:
        service.probe_test_stop()
        return DispatchResult(
            ack=build_ok(command.commandId, {"running": False, "aborted": was_running})
        )

    try:
        seconds = service.probe_test(params.seconds)
    except PinWriteRejected as exc:
        return _rejected(command, exc)

    service.set_probe_test_timer(
        asyncio.get_running_loop().create_task(_stop_probe_test_after(service, seconds))
    )
    return DispatchResult(
        ack=build_ok(command.commandId, {"running": True, "seconds": seconds})
    )


async def _stop_probe_test_after(service: Any, seconds: float) -> None:
    try:
        await asyncio.sleep(seconds)
    except asyncio.CancelledError:
        # Cancelled because something else stopped the test — a second press, a probe error,
        # or the process going down. The pin is lowered here too: a shutdown that never got
        # round to it would leave the torch probing.
        service.probe_test_stop()
        raise
    try:
        service.probe_test_stop()
    except Exception:
        logger.exception("plasma: stopping the probe test failed")


async def handle_plasma_ohmic_test(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma is None:
        return _unavailable(command)
    try:
        params = PlasmaEnabledParams.model_validate(command.params)
    except ValidationError:
        return _invalid(command, 'plasma.ohmic_test params: {"enabled": bool}')
    try:
        ctx.plasma.ohmic_test(params.enabled)
    except PinWriteRejected as exc:
        return _rejected(command, exc)
    return DispatchResult(ack=build_ok(command.commandId, {"enabled": params.enabled}))


async def handle_plasma_consumable_change(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    if ctx.plasma is None:
        return _unavailable(command)
    try:
        params = PlasmaEnabledParams.model_validate(command.params)
    except ValidationError:
        return _invalid(command, 'plasma.consumable_change params: {"enabled": bool}')
    try:
        ctx.plasma.consumable_change(params.enabled)
    except PinWriteRejected as exc:
        return _rejected(command, exc)
    return DispatchResult(ack=build_ok(command.commandId, {"enabled": params.enabled}))


async def handle_plasma_cut_recovery(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """Move the torch while paused — along the path, or sideways in kerf widths."""
    if ctx.plasma is None:
        return _unavailable(command)
    try:
        params = PlasmaCutRecoveryParams.model_validate(command.params)
    except ValidationError:
        return _invalid(
            command,
            'plasma.cut_recovery params: {"action": "move"|"offset"|"cancel", '
            '"direction": -1|0|1, "speedPercent": number, "x": int, "y": int}',
        )

    service = ctx.plasma
    try:
        if params.action == "move":
            service.cut_recovery_move(params.direction, params.speedPercent)
            return DispatchResult(
                ack=build_ok(command.commandId, {"action": "move", "direction": params.direction})
            )
        if params.action == "offset":
            # One press is one kerf width, and the kerf comes from the selected material — the
            # same number the cut itself was made with.
            kerf = 1.0
            if ctx.plasma_config is not None:
                kerf = float(ctx.plasma_config.conversational_defaults().get("kerfWidth", 1.0))
            counts = service.cut_recovery_offset(params.x, params.y, kerf)
            return DispatchResult(
                ack=build_ok(
                    command.commandId,
                    {"action": "offset", "kerfWidth": kerf, "counts": list(counts)},
                )
            )
        if params.action == "cancel":
            service.cut_recovery_cancel()
            return DispatchResult(ack=build_ok(command.commandId, {"action": "cancel"}))
    except PinWriteRejected as exc:
        return _rejected(command, exc)

    return _invalid(command, 'plasma.cut_recovery action: "move", "offset" or "cancel"')
