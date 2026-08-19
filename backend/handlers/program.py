import asyncio
import os
import tempfile
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from backend.adapters.linuxcnc_gateway import GatewayCommandResult
from backend.application.command_bus import DispatchResult
from backend.application.context import AppContext
from backend.config import PROGRAM_FILE_READ_MAX_BYTES, PROGRAM_FILE_WRITE_MAX_BYTES
from backend.contracts.messages import build_error, build_ok
from backend.handlers.gateway_ack import gateway_result_to_dispatch
from backend.program_file_paths import (
    default_list_directory,
    resolve_existing_directory,
    resolve_existing_file,
    resolve_path_for_program_read,
    resolve_write_target,
)

try:
    import linuxcnc as _linuxcnc  # type: ignore

    _INTERP_IDLE = int(_linuxcnc.INTERP_IDLE)
    _INTERP_READING = int(getattr(_linuxcnc, "INTERP_READING", 2))
    _MOTION_TYPE_NONE = int(getattr(_linuxcnc, "MOTION_TYPE_NONE", 0))
except ImportError:
    _linuxcnc = None
    _INTERP_IDLE = 1
    _INTERP_READING = 2
    _MOTION_TYPE_NONE = 0


# Note: linuxcnc task mode constants match the frontend's TaskMode enum values.
MODE_MANUAL = 1
MODE_AUTO = 2
MODE_MDI = 3
INTERP_IDLE = _INTERP_IDLE
INTERP_READING = _INTERP_READING
MOTION_TYPE_NONE = _MOTION_TYPE_NONE


class ProgramMdiParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_text(self) -> "ProgramMdiParams":
        cleaned = (self.text or "").strip()
        if not cleaned:
            raise ValueError("text must be non-empty")
        # LinuxCNC limits a single MDI command line length (254 chars).
        if len(cleaned) > 254:
            raise ValueError("text exceeds max length 254")
        self.text = cleaned
        return self


class ProgramOpenParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_path(self) -> "ProgramOpenParams":
        cleaned = (self.path or "").strip()
        if not cleaned:
            raise ValueError("path must be non-empty")
        self.path = cleaned
        return self


class ProgramAutoParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command: Literal["run", "pause", "resume"]
    startLine: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def start_line_only_for_run(self) -> "ProgramAutoParams":
        if self.command != "run" and self.startLine != 0:
            raise ValueError("startLine may only be set when command is run")
        return self


class ProgramListParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str | None = None


class ProgramReadParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1)
    statusPath: str | None = None

    @model_validator(mode="after")
    def validate_paths(self) -> "ProgramReadParams":
        cleaned = (self.path or "").strip()
        if not cleaned:
            raise ValueError("path must be non-empty")
        self.path = cleaned
        if self.statusPath is not None:
            sp = self.statusPath.strip()
            self.statusPath = sp if sp else None
        return self


class ProgramWriteParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1)
    content: str

    @model_validator(mode="after")
    def validate_path(self) -> "ProgramWriteParams":
        cleaned = (self.path or "").strip()
        if not cleaned:
            raise ValueError("path must be non-empty")
        self.path = cleaned
        return self


def _error_message_for_path_code(code: str) -> str:
    """Short English fallback; user-facing copy lives in frontend i18n (`programPathErrors.*`)."""
    return {
        "not_a_directory": "NC program directory does not exist",
        "outside_program_prefix": "Path outside PROGRAM_PREFIX",
        "file_not_found": "File not found or not readable",
        "parent_not_found": "Parent directory does not exist",
        "is_directory": "Path is a directory, not a file",
        "invalid_params": "Invalid path",
    }.get(code, code)


def _path_error(code: str, *, path: str | None = None) -> DispatchResult:
    return DispatchResult(
        ack=build_error("", code, _error_message_for_path_code(code), path=path),
        events=[],
    )


def _program_list_sync(prefixes: list[str], path_raw: str | None) -> DispatchResult:
    base = (path_raw or "").strip()
    if not base:
        parent_logical = os.path.abspath(default_list_directory(prefixes))
    else:
        parent_logical = os.path.abspath(os.path.expanduser(base))
    parent_logical = os.path.normpath(parent_logical)

    d_res, err = resolve_existing_directory(path_raw, prefixes)
    if err:
        return _path_error(err, path=parent_logical)

    entries: list[dict[str, Any]] = []
    try:
        with os.scandir(d_res) as it:
            for e in it:
                try:
                    # follow_symlinks=True: Verzeichnis-Symlinks als Ordner (Navigation),
                    # sonst liefert is_dir(False) nur den Symlink-Typ → UI würde program.read triggern.
                    is_dir = e.is_dir(follow_symlinks=True)
                    if is_dir:
                        size = None
                    else:
                        st = e.stat(follow_symlinks=True)
                        size = int(st.st_size)
                except OSError:
                    continue
                # Logische Pfade (unter PROGRAM_PREFIX), damit Navigation in der Tiefe nicht
                # realpath-Einträge außerhalb des Prefix bekommt (Symlinks/Mounts).
                logical_path = os.path.normpath(os.path.join(parent_logical, e.name))
                entries.append(
                    {
                        "name": e.name,
                        "path": logical_path,
                        "isDir": is_dir,
                        "size": size,
                    }
                )
    except OSError as exc:
        return DispatchResult(
            ack=build_error("", "list_failed", f"Cannot list directory: {exc}"),
            events=[],
        )

    entries.sort(key=lambda x: (not x["isDir"], x["name"].casefold()))

    parent_path: str | None = None
    parent_of_logical = os.path.dirname(parent_logical)
    if parent_of_logical and parent_of_logical != parent_logical:
        _, perr = resolve_existing_directory(parent_of_logical, prefixes)
        if perr is None:
            parent_path = os.path.normpath(parent_of_logical)

    # commandId filled by caller — path = logisches aktuelles Verzeichnis (wie Einträge)
    return DispatchResult(
        ack=build_ok("", {"path": parent_logical, "parentPath": parent_path, "entries": entries}),
        events=[],
    )


def _program_read_sync(
    prefixes: list[str], path: str, status_path: str | None = None
) -> DispatchResult:
    chosen, pick_err = resolve_path_for_program_read(path, status_path)
    if pick_err or not chosen:
        logical = os.path.normpath(os.path.abspath(os.path.expanduser(path or status_path or "")))
        return _path_error(pick_err or "invalid_params", path=logical or None)
    # Denselben logischen Pfad wie bei resolve_existing_file (nicht realpath) an den Client
    # zurückgeben, damit program.open dieselbe Prefix-Prüfung besteht wie program.read
    # (Symlink/Mount: realpath kann außerhalb von PROGRAM_PREFIX liegen).
    logical = os.path.normpath(os.path.abspath(os.path.expanduser(chosen)))
    fpath, err = resolve_existing_file(chosen, prefixes)
    if err:
        return _path_error(err, path=logical)
    try:
        sz = os.path.getsize(fpath)
    except OSError as exc:
        return DispatchResult(
            ack=build_error("", "file_not_found", f"Cannot stat file: {exc}"),
            events=[],
        )
    if sz > PROGRAM_FILE_READ_MAX_BYTES:
        return DispatchResult(
            ack=build_error(
                "",
                "payload_too_large",
                f"File exceeds max size ({PROGRAM_FILE_READ_MAX_BYTES} bytes).",
            ),
            events=[],
        )
    try:
        with open(fpath, encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError as exc:
        return DispatchResult(
            ack=build_error("", "read_failed", f"Cannot read file: {exc}"),
            events=[],
        )
    return DispatchResult(
        ack=build_ok("", {"path": logical, "content": text}),
        events=[],
    )


def _program_write_sync(prefixes: list[str], path: str, content: str) -> DispatchResult:
    if len(content.encode("utf-8")) > PROGRAM_FILE_WRITE_MAX_BYTES:
        return DispatchResult(
            ack=build_error(
                "",
                "payload_too_large",
                f"Content exceeds max size ({PROGRAM_FILE_WRITE_MAX_BYTES} bytes).",
            ),
            events=[],
        )
    target, err = resolve_write_target(path, prefixes)
    if err:
        logical = os.path.normpath(os.path.abspath(os.path.expanduser(path)))
        return _path_error(err, path=logical)
    parent = os.path.dirname(target)
    tmp_path: str | None = None
    try:
        fd, tmp_path = tempfile.mkstemp(
            dir=parent, prefix=".lcncgui_", suffix=".tmp", text=False
        )
        try:
            data = content.encode("utf-8")
            os.write(fd, data)
        finally:
            os.close(fd)
        assert tmp_path is not None
        os.replace(tmp_path, target)
        tmp_path = None
    except OSError as exc:
        if tmp_path is not None:
            try:
                if os.path.isfile(tmp_path):
                    os.unlink(tmp_path)
            except OSError:
                pass
        return DispatchResult(
            ack=build_error("", "write_failed", f"Cannot write file: {exc}"),
            events=[],
        )
    return DispatchResult(ack=build_ok("", {"path": target}), events=[])


def _with_command_id(dr: DispatchResult, command_id: str) -> DispatchResult:
    ack = dr.ack.model_copy(update={"commandId": command_id})
    return DispatchResult(ack=ack, events=dr.events)


async def handle_program_mdi(command, ctx: AppContext) -> DispatchResult:  # type: ignore[no-untyped-def]
    try:
        params = ProgramMdiParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                "Expected params: {\"text\": string} (non-empty, max length 254).",
            ),
            events=[],
        )

    result = ctx.gateway.program_mdi(params.text)
    return gateway_result_to_dispatch(command.commandId, result)


async def handle_program_open(command, ctx: AppContext) -> DispatchResult:  # type: ignore[no-untyped-def]
    try:
        params = ProgramOpenParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected params: {"path": string} (non-empty).',
            ),
            events=[],
        )

    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, ctx.gateway.program_open, params.path)
    return gateway_result_to_dispatch(command.commandId, result)


async def handle_program_load_tool_table(
    command, ctx: AppContext
) -> DispatchResult:  # type: ignore[no-untyped-def]
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, ctx.gateway.load_tool_table)
    return gateway_result_to_dispatch(command.commandId, result)


async def handle_program_auto(command, ctx: AppContext) -> DispatchResult:  # type: ignore[no-untyped-def]
    try:
        params = ProgramAutoParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected params: {"command": "run"|"pause"|"resume", '
                '"startLine"?: int >= 0 (only for run).',
            ),
            events=[],
        )

    loop = asyncio.get_running_loop()

    def _run() -> GatewayCommandResult:
        return ctx.gateway.program_auto(params.command, params.startLine)

    result = await loop.run_in_executor(None, _run)
    return gateway_result_to_dispatch(command.commandId, result)


async def handle_program_list(command, ctx: AppContext) -> DispatchResult:  # type: ignore[no-untyped-def]
    try:
        params = ProgramListParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected params: {"path"?: string} (optional directory under PROGRAM_PREFIX).',
            ),
            events=[],
        )

    prefixes = ctx.gateway.get_program_prefix_directories()

    def _run() -> DispatchResult:
        return _program_list_sync(prefixes, params.path)

    loop = asyncio.get_running_loop()
    dr = await loop.run_in_executor(None, _run)
    return _with_command_id(dr, command.commandId)


async def handle_program_read(command, ctx: AppContext) -> DispatchResult:  # type: ignore[no-untyped-def]
    try:
        params = ProgramReadParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected params: {"path": string, "statusPath"?: string}.',
            ),
            events=[],
        )

    prefixes = ctx.gateway.get_program_prefix_directories()

    def _run() -> DispatchResult:
        return _program_read_sync(prefixes, params.path, params.statusPath)

    loop = asyncio.get_running_loop()
    dr = await loop.run_in_executor(None, _run)
    return _with_command_id(dr, command.commandId)


async def handle_program_write(command, ctx: AppContext) -> DispatchResult:  # type: ignore[no-untyped-def]
    try:
        params = ProgramWriteParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                'Expected params: {"path": string, "content": string}.',
            ),
            events=[],
        )

    prefixes = ctx.gateway.get_program_prefix_directories()

    def _run() -> DispatchResult:
        return _program_write_sync(prefixes, params.path, params.content)

    loop = asyncio.get_running_loop()
    dr = await loop.run_in_executor(None, _run)
    return _with_command_id(dr, command.commandId)
