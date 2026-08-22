"""WebSocket command handlers for the ``plasma`` category.

Same envelope as every other category (``backend/contracts/messages.py``); no protocol
change. Each handler validates its params, asks :class:`PlasmaService` to write, and reports
what happened. Nothing here waits on HAL: a write is queued for the bridge thread and the
resulting pin change arrives as a ``plasma.pins.changed`` event.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict, ValidationError

from backend.application.command_bus import DispatchResult
from backend.application.context import AppContext
from backend.contracts.messages import CommandEnvelope, build_error, build_ok
from backend.plasma.hal_bridge import PinWriteRejected
from backend.plasma.alignment import SECTIONS as ALIGNMENT_SECTIONS, AlignmentError
from backend.plasma.materials import MaterialError
from backend.plasma.parameters import ParameterRejected

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
    except ParameterRejected as exc:
        # Its own code, with the offending key in `path` so the UI can mark that one field.
        return DispatchResult(
            ack=build_error(command.commandId, exc.code, exc.message, path=exc.key)
        )
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

    # What the program asks the machine for, which the toolpath cannot show: tube cutting,
    # kept Z motion, hole velocity. Read from the same text the interpreter just parsed.
    preview["notes"] = _program_notes(ctx, params.gcode, path if not scratch else None)
    return DispatchResult(ack=build_ok(command.commandId, preview))


def _program_notes(
    ctx: AppContext, gcode: Optional[str], path: Optional[str]
) -> Dict[str, Any]:
    """Magic directives in a program, checked against what this machine can do."""
    from backend.plasma.program_notes import read_program_notes

    text = gcode
    if text is None and path:
        try:
            with open(path, "r", errors="replace") as handle:
                text = handle.read()
        except OSError:
            return {"directives": {}, "warnings": []}
    if not text:
        return {"directives": {}, "warnings": []}

    capabilities = None
    if ctx.plasma is not None:
        capabilities = ctx.plasma.snapshot_payload().get("capabilities")
    return read_program_notes(text, capabilities)


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
            'plasma.cut_recovery params: {"action": "move"|"offset"|"laser"|"cancel", '
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
        if params.action == "laser":
            # The laser offset comes from the machine's prefs, the same number sheet alignment
            # uses: the point of it is that the laser lands where the torch was.
            offset = {"X axis": 0.0, "Y axis": 0.0}
            if ctx.plasma_config is not None:
                offset = ctx.plasma_config.peripheral_offset("LASER_OFFSET")
            counts = service.laser_recovery(offset["X axis"], offset["Y axis"])
            if ctx.plasma_config is not None:
                ctx.plasma_config.set_laser(True)
            return DispatchResult(
                ack=build_ok(
                    command.commandId,
                    {"action": "laser", "offset": offset, "counts": list(counts)},
                )
            )
        if params.action == "cancel":
            service.cut_recovery_cancel()
            if ctx.plasma_config is not None:
                ctx.plasma_config.set_laser(False)
            return DispatchResult(ack=build_ok(command.commandId, {"action": "cancel"}))
    except PinWriteRejected as exc:
        return _rejected(command, exc)

    return _invalid(
        command, 'plasma.cut_recovery action: "move", "offset", "laser" or "cancel"'
    )


class PlasmaSingleCutParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    xLength: float = 0.0
    yLength: float = 0.0
    #: Load the generated cut, which is what QtPlasmaC's CUT button does. Off for a dry check.
    load: bool = True


class PlasmaOffsetProbingParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    values: dict


async def handle_plasma_single_cut(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """One straight cut from where the torch is standing — QtPlasmaC's SINGLE CUT."""
    import os

    from backend.plasma.single_cut import (
        OUTPUT_NAME,
        SingleCutError,
        build_single_cut,
        write_lengths,
    )

    try:
        params = PlasmaSingleCutParams.model_validate(command.params)
    except ValidationError:
        return _invalid(
            command, 'plasma.single_cut params: {"xLength": number, "yLength": number}'
        )

    position = ctx.gateway.machine_position()
    if position is None:
        return DispatchResult(
            ack=build_error(
                command.commandId, "no_position", "The machine position is not available."
            )
        )

    material = (0, "Default")
    if ctx.plasma_config is not None:
        material = ctx.plasma_config.selected_material

    try:
        gcode = build_single_cut(
            (position[0], position[1]), params.xLength, params.yLength, material
        )
    except SingleCutError as exc:
        return DispatchResult(ack=build_error(command.commandId, exc.code, exc.message))

    # Remembered for next time, as upstream does — a single cut is usually repeated.
    if ctx.plasma_config is not None:
        try:
            write_lengths(
                ctx.plasma_config.files.prefs_path, params.xLength, params.yLength
            )
        except OSError:
            logger.warning("plasma: could not remember the single cut lengths", exc_info=True)

    result: Dict[str, Any] = {
        "gcode": gcode,
        "start": [position[0], position[1]],
        "xLength": params.xLength,
        "yLength": params.yLength,
    }
    if not params.load:
        return DispatchResult(ack=build_ok(command.commandId, result))

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
                "No writable [DISPLAY] PROGRAM_PREFIX directory to save the cut into.",
            )
        )

    path = os.path.join(directory, OUTPUT_NAME)
    try:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(gcode)
    except OSError as exc:
        return DispatchResult(ack=build_error(command.commandId, "write_failed", str(exc)))

    opened = ctx.gateway.program_open(path)
    if not opened.ok:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                opened.error_code or "open_failed",
                opened.error_message or "Could not load the single cut.",
            )
        )
    result["path"] = path
    result["loaded"] = True
    return DispatchResult(ack=build_ok(command.commandId, result))


async def handle_plasma_save_offset_probing(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """Where the offset probe sits relative to the torch, and how long it takes to deploy."""
    if ctx.plasma_config is None:
        return _no_config(command)
    try:
        params = PlasmaOffsetProbingParams.model_validate(command.params)
    except ValidationError:
        return _invalid(command, 'plasma.save_offset_probing params: {"values": object}')
    try:
        values = ctx.plasma_config.save_offset_probing(params.values)
    except (TypeError, ValueError) as exc:
        return DispatchResult(ack=build_error(command.commandId, "invalid_value", str(exc)))
    except OSError as exc:
        return DispatchResult(ack=build_error(command.commandId, "write_failed", str(exc)))
    await _broadcast_config(ctx, materials=False, parameters=True)
    return DispatchResult(ack=build_ok(command.commandId, {"offsetProbing": values}))


class PlasmaAlignmentParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    #: ``laser`` or ``camera`` — which peripheral's offset the origin is set at.
    kind: str = "laser"


class PlasmaPeripheralOffsetParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str
    values: Dict[str, float]


async def handle_plasma_get_alignment(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """Where the alignment routine stands, and whether this machine has a laser or camera."""
    if ctx.plasma_alignment is None:
        return _no_config(command)
    return DispatchResult(ack=build_ok(command.commandId, ctx.plasma_alignment.status()))


async def handle_plasma_alignment_press(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """One press of QtPlasmaC's LASER / MARK EDGE / SET ORIGIN button."""
    if ctx.plasma_alignment is None:
        return _no_config(command)
    try:
        params = PlasmaAlignmentParams.model_validate(command.params or {})
    except ValidationError:
        return _invalid(command, 'plasma.alignment_press params: {"kind"?: "laser"|"camera"}')
    try:
        status = await asyncio.to_thread(ctx.plasma_alignment.press, params.kind)
    except AlignmentError as exc:
        return DispatchResult(ack=build_error(command.commandId, exc.code, exc.message))
    await _broadcast_alignment(ctx, status)
    return DispatchResult(ack=build_ok(command.commandId, status))


async def handle_plasma_alignment_cancel(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """Give up part-way through. The work offsets are left exactly as they were."""
    if ctx.plasma_alignment is None:
        return _no_config(command)
    status = ctx.plasma_alignment.cancel()
    await _broadcast_alignment(ctx, status)
    return DispatchResult(ack=build_ok(command.commandId, status))


async def handle_plasma_save_peripheral_offset(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """Where the laser or camera sits relative to the torch."""
    if ctx.plasma_config is None:
        return _no_config(command)
    try:
        params = PlasmaPeripheralOffsetParams.model_validate(command.params)
    except ValidationError:
        return _invalid(
            command,
            'plasma.save_peripheral_offset params: {"kind": "laser"|"camera", "values": object}',
        )
    section = ALIGNMENT_SECTIONS.get(params.kind)
    if section is None:
        return DispatchResult(
            ack=build_error(
                command.commandId, "unknown_peripheral", f"no peripheral named {params.kind!r}"
            )
        )
    try:
        values = ctx.plasma_config.save_peripheral_offset(section, params.values)
    except (KeyError, TypeError, ValueError) as exc:
        return DispatchResult(ack=build_error(command.commandId, "invalid_value", str(exc)))
    except OSError as exc:
        return DispatchResult(ack=build_error(command.commandId, "write_failed", str(exc)))
    if ctx.plasma_alignment is not None:
        await _broadcast_alignment(ctx, ctx.plasma_alignment.status())
    return DispatchResult(ack=build_ok(command.commandId, {"kind": params.kind, "values": values}))


#: The alignment button's state is machine state, not one client's: a shop may well have the
#: panel and a laptop open, and both must show the same step of the same routine.
ALIGNMENT_EVENT = "plasma.alignment"


async def _broadcast_alignment(ctx: AppContext, status: Dict[str, Any]) -> None:
    await ctx.manager.broadcast_json(
        {
            "type": "machine_event",
            "protocolVersion": 1,
            "event": ALIGNMENT_EVENT,
            "payload": status,
        }
    )


class PlasmaGuiOptionParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    enabled: bool


async def handle_plasma_save_gui_option(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """One ``[GUI_OPTIONS]`` switch — keyboard shortcuts, soft keyboard, flashing errors.

    Stored in the machine's own prefs file, spelled the way QtPlasmaC spells it, so whichever
    GUI the shop opens next reads the same setting.
    """
    if ctx.plasma_config is None:
        return _no_config(command)
    try:
        params = PlasmaGuiOptionParams.model_validate(command.params)
    except ValidationError:
        return _invalid(
            command, 'plasma.save_gui_option params: {"name": string, "enabled": bool}'
        )
    try:
        options = ctx.plasma_config.save_gui_option(params.name, params.enabled)
    except KeyError:
        return DispatchResult(
            ack=build_error(
                command.commandId, "unknown_option", f"no GUI option named {params.name!r}"
            )
        )
    except OSError as exc:
        return DispatchResult(ack=build_error(command.commandId, "write_failed", str(exc)))
    await _broadcast_config(ctx, materials=False, parameters=True)
    return DispatchResult(ack=build_ok(command.commandId, {"guiOptions": options}))


class PlasmaMachineLogParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    #: Newest entries only, when a client does not want the whole history.
    limit: Optional[int] = None
    #: ``critical``, ``warning`` or ``info``.
    severity: Optional[str] = None


async def handle_plasma_get_machine_log(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """What the machine said, and the last critical message it said.

    A toast that has already faded is no use to whoever comes back to a paused machine and has
    to work out why it stopped.
    """
    if ctx.machine_log is None:
        return DispatchResult(
            ack=build_error(command.commandId, "log_unavailable", "There is no machine log.")
        )
    try:
        params = PlasmaMachineLogParams.model_validate(command.params or {})
    except ValidationError:
        return _invalid(
            command, 'plasma.get_machine_log params: {"limit"?: int, "severity"?: string}'
        )
    return DispatchResult(
        ack=build_ok(
            command.commandId,
            {
                "entries": ctx.machine_log.entries(params.limit, params.severity),
                "lastCritical": ctx.machine_log.last_critical(),
                "count": len(ctx.machine_log),
            },
        )
    )


async def handle_plasma_save_machine_log(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """Write the log beside the machine's config, as QtPlasmaC does on shutdown."""
    if ctx.machine_log is None or ctx.plasma_config is None:
        return DispatchResult(
            ack=build_error(command.commandId, "log_unavailable", "There is no machine log.")
        )
    directory = os.path.dirname(os.path.abspath(ctx.plasma_config.prefs_path))
    path = await asyncio.to_thread(ctx.machine_log.save, directory)
    if path is None:
        return DispatchResult(
            ack=build_error(command.commandId, "nothing_to_save", "The machine log is empty.")
        )
    return DispatchResult(ack=build_ok(command.commandId, {"path": path}))


class PlasmaUserButtonParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    number: int
    #: Momentary codes (torch pulse) act on press and release; the rest ignore this.
    pressed: bool = True


async def handle_plasma_get_user_buttons(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """The buttons this machine's owner defined, and whether each one can be run here."""
    if ctx.plasma_config is None:
        return _no_config(command)
    from backend.plasma.user_buttons import allow_configured_pins, read_user_buttons

    buttons = read_user_buttons(ctx.plasma_config.files.prefs_path)
    if ctx.plasma is not None:
        # The pins a button may write come from the config file, not from a request.
        allow_configured_pins(ctx.plasma.bridge, buttons)
    return DispatchResult(
        ack=build_ok(
            command.commandId, {"buttons": [button.as_dict() for button in buttons]}
        )
    )


async def handle_plasma_user_button(
    command: CommandEnvelope, ctx: AppContext
) -> DispatchResult:
    """Press one of the machine's own buttons.

    The client sends a *number*; the code it runs comes from the machine's prefs file. That is
    the whole security model here: a browser can ask for button 3, it cannot say what button 3
    does.
    """
    if ctx.plasma is None:
        return _unavailable(command)
    if ctx.plasma_config is None:
        return _no_config(command)

    from backend.plasma.user_buttons import UserButtonError, latest_file, user_button

    try:
        params = PlasmaUserButtonParams.model_validate(command.params)
    except ValidationError:
        return _invalid(command, 'plasma.user_button params: {"number": int, "pressed": bool}')

    try:
        button = user_button(ctx.plasma_config.files.prefs_path, params.number)
    except KeyError:
        return DispatchResult(
            ack=build_error(
                command.commandId, "unknown_button", f"no user button {params.number}"
            )
        )
    if not button.supported:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "button_unsupported",
                button.reason or f"{button.kind} buttons are not supported yet",
            )
        )

    service = ctx.plasma
    try:
        result = await _run_user_button(ctx, service, button, params.pressed)
    except UserButtonError as exc:
        return DispatchResult(ack=build_error(command.commandId, exc.code, exc.message))
    except PinWriteRejected as exc:
        return _rejected(command, exc)

    if isinstance(result, dict) and result.get("error"):
        return DispatchResult(
            ack=build_error(command.commandId, result["error"], result.get("message", ""))
        )
    return DispatchResult(
        ack=build_ok(
            command.commandId,
            {"number": button.number, "kind": button.kind, **(result or {})},
        )
    )


async def _run_user_button(
    ctx: AppContext, service: Any, button: Any, pressed: bool
) -> Optional[Dict[str, Any]]:
    """Do what one button's code says. Returns extra payload for the ack, or an error dict."""
    import asyncio as _asyncio

    from backend.plasma.user_buttons import latest_file

    kind = button.kind
    params = button.params

    if kind == "probe-test":
        return await _dispatch_child(
            ctx, "probe_test", {"seconds": params["seconds"] if pressed else 0}
        )

    if kind == "ohmic-test":
        service.ohmic_test(pressed)
        return {"enabled": pressed}

    if kind == "torch-pulse":
        service.torch_pulse("press" if pressed else "release", params.get("seconds"))
        return {"pressed": pressed}

    if kind == "single-cut":
        # The lengths live in the prefs, as upstream's dialog leaves them.
        from backend.plasma.single_cut import read_lengths

        lengths = read_lengths(ctx.plasma_config.files.prefs_path)
        return await _dispatch_child(
            ctx,
            "single_cut",
            {"xLength": lengths["X length"], "yLength": lengths["Y length"]},
        )

    if kind == "cut-type":
        # `qtplasmac.cut_type` selects pierce-and-cut (0) or centre-line scribe/cut (1); one
        # button toggles it, and the G-code filter reads the pin.
        current = int(service.bridge.snapshot().get("qtplasmac", {}).get("cut_type", 0) or 0)
        if pressed:
            service.set_own_output("cut_type", 0 if current else 1)
        return {"cutType": 0 if current else 1}

    if kind == "toggle-halpin":
        if not pressed:
            return None
        pin = params["pin"]
        try:
            current = bool(service.bridge.external_pin_value(pin))
        except Exception:
            # A pin the config names but this machine does not have. Toggling from an unknown
            # state would be a guess, so say so instead.
            return {
                "error": "pin_not_found",
                "message": f"this machine has no HAL pin {pin}",
            }
        service.bridge.request_external_write(pin, not current)
        return {"pin": pin, "value": not current}

    if kind == "pulse-halpin":
        if not pressed:
            return None
        pin = params["pin"]
        service.bridge.request_external_write(pin, True)
        _asyncio.get_running_loop().create_task(
            _drop_pin_after(service, pin, params["seconds"])
        )
        return {"pin": pin, "seconds": params["seconds"]}

    if kind in ("load", "latest-file"):
        if not pressed:
            return None
        path = params["path"]
        if kind == "latest-file":
            path = latest_file(path)
        elif not os.path.isabs(path):
            # Upstream resolves a relative path against the program directory.
            prefixes = ctx.gateway.get_program_prefix_directories()
            if prefixes:
                path = os.path.join(prefixes[0], path)
        opened = ctx.gateway.program_open(path)
        if not opened.ok:
            return {
                "error": opened.error_code or "open_failed",
                "message": opened.error_message or "Could not load that program.",
            }
        return {"path": path, "loaded": True}

    if kind == "gcode":
        if not pressed:
            return None
        result = ctx.gateway.program_mdi(params["gcode"])
        if not result.ok:
            return {
                "error": result.error_code or "mdi_failed",
                "message": result.error_message or "The MDI command was refused.",
            }
        return {"gcode": params["gcode"]}

    if kind == "external":
        if not pressed:
            return None
        return await _run_external_command(params["command"])

    return None


async def _dispatch_child(
    ctx: AppContext, action: str, params: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """Run another plasma command's handler, so a button and a screen tap take one path."""
    handlers = {
        "probe_test": handle_plasma_probe_test,
        "single_cut": handle_plasma_single_cut,
    }
    child = CommandEnvelope(
        type="command",
        commandId="user-button",
        category="plasma",
        action=action,
        params=params,
    )
    result = await handlers[action](child, ctx)
    if result.ack.ok:
        return dict(result.ack.result or {})
    return {
        "error": result.ack.error.code if result.ack.error else "failed",
        "message": result.ack.error.message if result.ack.error else "",
    }


async def _drop_pin_after(service: Any, pin: str, seconds: float) -> None:
    """Lower a pulsed pin again. The backend owns the timer, as it does for the probe test."""
    import asyncio as _asyncio

    try:
        await _asyncio.sleep(seconds)
    except _asyncio.CancelledError:
        service.bridge.request_external_write(pin, False)
        raise
    try:
        service.bridge.request_external_write(pin, False)
    except Exception:
        logger.exception("plasma: could not lower the pulsed pin %s", pin)


async def _run_external_command(command_line: str) -> Dict[str, Any]:
    """Run a user button's external command, as the machine's own user.

    The command comes from the machine's prefs file, which only its owner edits — the same
    trust as an INI-configured macro. It is still run without a shell and with a timeout: a
    button that hangs must not take the plasma layer's event loop with it.
    """
    import asyncio as _asyncio
    import shlex

    parts = shlex.split(command_line)
    if not parts:
        return {"error": "invalid_command", "message": "the button has no command to run"}
    if parts[0].endswith(".py"):
        parts.insert(0, sys.executable)

    try:
        process = await _asyncio.create_subprocess_exec(
            *parts,
            stdout=_asyncio.subprocess.PIPE,
            stderr=_asyncio.subprocess.STDOUT,
        )
    except (OSError, ValueError) as exc:
        return {"error": "command_failed", "message": str(exc)}

    try:
        output, _ = await _asyncio.wait_for(process.communicate(), timeout=30)
    except _asyncio.TimeoutError:
        process.kill()
        return {"error": "command_timeout", "message": f"{parts[0]} did not finish in 30 s"}

    text = (output or b"").decode("utf-8", "replace").strip()
    if process.returncode:
        return {
            "error": "command_failed",
            "message": f"{parts[0]} exited {process.returncode}: {text[:500]}",
        }
    return {"command": parts[0], "output": text[:500]}
