"""
Zentraler Poll-Loop: LinuxCNC in ``MODE_MDI`` oder ``MODE_AUTO`` + Interpreter/Motion frei
→ ``MODE_MANUAL``.

- **MDI:** Jede ``program.mdi``-Zeile wechselt bei Bedarf nach MDI; ist Interpreter und Motion
  frei, geht es zurück auf Manuell — die nächste MDI-Zeile schaltet wieder nach MDI.
- **AUTO:** Nach Ende eines G-Code-Laufs bleibt LinuxCNC oft in ``MODE_AUTO`` mit
  ``INTERP_IDLE``; der Poller setzt zurück auf Manuell, damit Jog/Referenz u. a. wieder
  ohne manuellen Moduswechsel nutzbar sind. Der nächste ``program.auto``-``run`` wechselt
  bei Bedarf wieder nach AUTO (Gateway).
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from typing import Optional

try:
    import linuxcnc as _lc  # type: ignore

    _STATE_ON = int(getattr(_lc, "STATE_ON", 4))
except ImportError:
    _STATE_ON = 4

from backend.application.context import AppContext
from backend.handlers.program import (
    INTERP_IDLE,
    MODE_AUTO,
    MODE_MANUAL,
    MODE_MDI,
    MOTION_TYPE_NONE,
)

logger = logging.getLogger(__name__)

# Matches GatewayCommandResult from RCS_ERROR in LinuxCncGateway._wait_motion_command_result.
_WAIT_COMPLETE_LINUXCNC_COMMAND_FAILED = "linuxcnc_command_failed"

_WAIT_COMPLETE_CAP_S = 600.0
_REVERT_WARN_THROTTLE_S = 30.0
_REVERT_DEBUG_THROTTLE_S = 30.0
_last_revert_failure_warn_monotonic: float = -1e9
_last_wait_cmd_failed_debug_monotonic: float = -1e9


def _throttled_revert_warning(loop: asyncio.AbstractEventLoop, msg: str, *args: object) -> None:
    global _last_revert_failure_warn_monotonic
    now = loop.time()
    if now - _last_revert_failure_warn_monotonic < _REVERT_WARN_THROTTLE_S:
        return
    _last_revert_failure_warn_monotonic = now
    logger.warning(msg, *args)


def _throttled_revert_debug(loop: asyncio.AbstractEventLoop, msg: str, *args: object) -> None:
    global _last_wait_cmd_failed_debug_monotonic
    now = loop.time()
    if now - _last_wait_cmd_failed_debug_monotonic < _REVERT_DEBUG_THROTTLE_S:
        return
    _last_wait_cmd_failed_debug_monotonic = now
    logger.debug(msg, *args)


def _reset_revert_warning_throttle() -> None:
    global _last_revert_failure_warn_monotonic, _last_wait_cmd_failed_debug_monotonic
    _last_revert_failure_warn_monotonic = -1e9
    _last_wait_cmd_failed_debug_monotonic = -1e9


async def mdi_manual_revert_tick(ctx: AppContext) -> None:
    """
    Wenn die Maschine in MDI oder AUTO ist und weder Interpreter noch Jog/Motion beschäftigt
    sind: Command-Kanal leeren, dann auf Manuell wechseln.
    """
    gw = ctx.gateway
    loop = asyncio.get_running_loop()

    try:
        ctx_state = gw.get_machine_task_context()
    except Exception:
        return

    if not bool(ctx_state.get("enabled", True)):
        return

    task_state = ctx_state.get("task_state")
    if task_state is not None and int(task_state) != _STATE_ON:
        return

    task_mode = int(ctx_state.get("task_mode", MODE_MANUAL))
    if task_mode not in (MODE_MDI, MODE_AUTO):
        return

    interp_state = int(ctx_state.get("interp_state", INTERP_IDLE))
    try:
        motion_type = int(ctx_state.get("motion_type", MOTION_TYPE_NONE))
    except (TypeError, ValueError):
        motion_type = MOTION_TYPE_NONE
    try:
        current_vel = float(ctx_state.get("current_vel", 0.0) or 0.0)
    except (TypeError, ValueError):
        current_vel = 0.0
    motion_quiet = abs(current_vel) <= 1e-9 and motion_type == MOTION_TYPE_NONE

    if interp_state != INTERP_IDLE or not motion_quiet:
        return

    wait_fn = getattr(gw, "wait_last_command_complete", None)
    if callable(wait_fn):
        wait_res = await loop.run_in_executor(
            None,
            lambda: wait_fn(_WAIT_COMPLETE_CAP_S),
        )
        if getattr(wait_res, "ok", False) is not True:
            code = getattr(wait_res, "error_code", None) or "unknown"
            detail = getattr(wait_res, "error_message", None) or ""
            label = "MDI" if task_mode == MODE_MDI else "AUTO"
            if code == _WAIT_COMPLETE_LINUXCNC_COMMAND_FAILED:
                # ``wait_complete`` may return RCS_ERROR after a fault even when interp/motion
                # are idle; we still attempt MODE_MANUAL (see docs/backend-mdi-manual-revert.md).
                _throttled_revert_debug(
                    loop,
                    "%s→manual: wait_last_command_complete returned %s (e.g. RCS_ERROR after "
                    "fault); attempting set_task_mode(MANUAL): %s",
                    label,
                    code,
                    detail,
                )
            else:
                _throttled_revert_warning(
                    loop,
                    "%s→Manuell: wait_last_command_complete fehlgeschlagen (%s): %s",
                    label,
                    code,
                    detail,
                )
                return

    mode_res = await loop.run_in_executor(None, gw.set_task_mode, MODE_MANUAL)
    if getattr(mode_res, "ok", False) is True:
        _reset_revert_warning_throttle()
        return

    code = getattr(mode_res, "error_code", None) or "unknown"
    detail = getattr(mode_res, "error_message", None) or ""
    label = "MDI" if task_mode == MODE_MDI else "AUTO"
    _throttled_revert_warning(
        loop,
        "%s→Manuell: set_task_mode(MANUAL) fehlgeschlagen (%s): %s",
        label,
        code,
        detail,
    )


class MdiManualRevertPoller:
    """
    Hintergrund-Poller: wechselt LinuxCNC bei freiem Interpreter und ruhender Motion
    von ``MODE_MDI`` oder ``MODE_AUTO`` nach ``MODE_MANUAL``.

    Der Klassenname bezieht sich auf die ursprüngliche MDI→Manuell-Aufgabe; das gleiche
    Intervall und dieselbe Logik gelten zusätzlich für Rückkehr aus dem Programm-Modus
    nach beendetem G-Code-Lauf (AUTO + ``INTERP_IDLE``).
    """

    def __init__(self, app_context: AppContext, poll_interval_s: float) -> None:
        self._ctx = app_context
        self._poll_interval_s = poll_interval_s
        self._task: Optional[asyncio.Task[None]] = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    async def _run(self) -> None:
        while True:
            try:
                await asyncio.sleep(self._poll_interval_s)
                await mdi_manual_revert_tick(self._ctx)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("MdiManualRevertPoller tick failed")
