"""Launch LinuxCNC HAL helper programs (gmoccapy settings parity)."""

from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal, Optional, get_args

HalToolId = Literal[
    "classicladder",
    "halscope",
    "linuxcnctop",
    "halmeter",
    "hal_calibration",
    "halshow",
]

_TYPE_HAL_TOOL_IDS: tuple[HalToolId, ...] = get_args(HalToolId)
_JSON_PATH = Path(__file__).resolve().parent.parent / "resources" / "hal-tool-ids.json"
_LOADED_HAL_TOOL_IDS: tuple[str, ...] = tuple(json.loads(_JSON_PATH.read_text(encoding="utf-8")))
if tuple(_LOADED_HAL_TOOL_IDS) != _TYPE_HAL_TOOL_IDS:
    raise RuntimeError(
        "resources/hal-tool-ids.json is out of sync with HalToolId in backend/hal_tools.py"
    )
HAL_TOOL_IDS: tuple[HalToolId, ...] = _TYPE_HAL_TOOL_IDS

HAL_TOOL_CLIENT_ERROR_CODES: frozenset[str] = frozenset(
    {
        "halshow_unavailable",
        "halmeter_unavailable",
        "halscope_unavailable",
        "linuxcnctop_unavailable",
        "hal_calibration_unavailable",
        "ini_path_unavailable",
        "classicladder_unavailable",
        "display_unavailable",
    }
)

_LAUNCH_VERIFY_DELAY_S = 0.35


@dataclass(frozen=True)
class HalToolLaunchResult:
    ok: bool
    command: str = ""
    error_code: str = ""
    error_message: str = ""


def _ok(command: str) -> HalToolLaunchResult:
    return HalToolLaunchResult(ok=True, command=command)


def _err(code: str, message: str) -> HalToolLaunchResult:
    return HalToolLaunchResult(ok=False, error_code=code, error_message=message)


def _has_display_session() -> bool:
    if os.name == "nt":
        return True
    if os.environ.get("DISPLAY", "").strip():
        return True
    if os.environ.get("WAYLAND_DISPLAY", "").strip():
        return True
    return False


def _linuxcnc_tcl_dir() -> Optional[str]:
    raw = os.environ.get("LINUXCNC_TCL_DIR", "").strip()
    if not raw:
        return None
    path = os.path.expanduser(raw)
    return path if os.path.isdir(path) else None


def _halcmd_path() -> Optional[str]:
    return shutil.which("halcmd")


def hal_component_exists(name: str, *, timeout_s: float = 3.0) -> bool:
    token = (name or "").strip()
    if not token:
        return False
    exe = _halcmd_path()
    if not exe:
        return False
    try:
        proc = subprocess.run(
            [exe, "-s", "show", "comp", token],
            capture_output=True,
            text=True,
            timeout=float(timeout_s),
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return False
    return proc.returncode == 0


def _tcl_script_command(script_name: str) -> Optional[str]:
    tcl_dir = _linuxcnc_tcl_dir()
    if not tcl_dir:
        return None
    script_path = os.path.join(tcl_dir, "bin", script_name)
    if not os.path.isfile(script_path):
        return None
    tclsh = shutil.which("tclsh")
    if not tclsh:
        return None
    return f"{shlex.quote(tclsh)} {shlex.quote(script_path)}"


def _executable_command(name: str) -> Optional[str]:
    exe = shutil.which(name)
    if not exe:
        return None
    return shlex.quote(exe)


def build_hal_tool_command(
    tool: HalToolId,
    *,
    resolve_ini_path: Callable[[], Optional[str]],
) -> HalToolLaunchResult:
    if tool == "halshow":
        cmd = _tcl_script_command("halshow.tcl")
        if cmd:
            return _ok(cmd)
        fallback = _executable_command("halshow")
        if fallback:
            return _ok(fallback)
        return _err(
            "halshow_unavailable",
            "halshow is not available (LINUXCNC_TCL_DIR or tclsh missing).",
        )

    if tool == "halmeter":
        cmd = _executable_command("halmeter")
        if cmd:
            return _ok(cmd)
        return _err(
            "halmeter_unavailable",
            "halmeter is not installed or not in PATH.",
        )

    if tool == "halscope":
        cmd = _executable_command("halscope")
        if cmd:
            return _ok(cmd)
        return _err(
            "halscope_unavailable",
            "halscope is not installed or not in PATH.",
        )

    if tool == "linuxcnctop":
        cmd = _executable_command("linuxcnctop")
        if cmd:
            return _ok(cmd)
        return _err(
            "linuxcnctop_unavailable",
            "linuxcnctop is not installed or not in PATH.",
        )

    if tool == "hal_calibration":
        cmd = _tcl_script_command("emccalib.tcl")
        if not cmd:
            return _err(
                "hal_calibration_unavailable",
                "emccalib is not available (LINUXCNC_TCL_DIR or tclsh missing).",
            )
        ini_path = resolve_ini_path()
        if not ini_path:
            return _err(
                "ini_path_unavailable",
                "LinuxCNC INI path is not available.",
            )
        return _ok(f"{cmd} -- -ini {shlex.quote(ini_path)}")

    if tool == "classicladder":
        if not hal_component_exists("classicladder_rt"):
            return _err(
                "classicladder_unavailable",
                "Classicladder real-time component not detected.",
            )
        cmd = _executable_command("classicladder")
        if cmd:
            return _ok(cmd)
        return _err(
            "classicladder_unavailable",
            "classicladder is not installed or not in PATH.",
        )

    return _err("unknown_hal_tool", f"Unknown HAL tool: {tool!r}.")


def _verify_process_started(proc: subprocess.Popen[object]) -> Optional[HalToolLaunchResult]:
    time.sleep(_LAUNCH_VERIFY_DELAY_S)
    rc = proc.poll()
    if rc is None or rc == 0:
        return None
    return _err(
        "launch_failed",
        f"Process exited immediately with code {rc} (check DISPLAY / LinuxCNC session).",
    )


def launch_hal_tool(
    tool: HalToolId,
    *,
    resolve_ini_path: Callable[[], Optional[str]],
) -> HalToolLaunchResult:
    if not _has_display_session():
        return _err(
            "display_unavailable",
            "No DISPLAY or WAYLAND_DISPLAY session (GUI tools need a running LinuxCNC display).",
        )

    built = build_hal_tool_command(tool, resolve_ini_path=resolve_ini_path)
    if not built.ok:
        return built
    try:
        proc = subprocess.Popen(  # noqa: S603
            built.command,
            shell=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError as exc:
        return _err("launch_failed", str(exc))

    verify = _verify_process_started(proc)
    if verify is not None:
        return verify
    return HalToolLaunchResult(ok=True)
