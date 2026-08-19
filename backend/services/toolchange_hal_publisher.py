import asyncio
import logging
import time
from contextlib import suppress
from typing import Optional

from backend import config
from backend.adapters.linuxcnc_gateway import LinuxCncGateway
from backend.contracts.messages import EventMessage
from backend.ws.connection_manager import ConnectionManager

logger = logging.getLogger(__name__)


class ToolChangeHalPublisher:
    """
    Polls HAL (via ``halcmd``) for manual tool-change request (iocontrol-style).
    On rising edge of the change pin, broadcasts ``machine.tool_change.requested``.
    """

    def __init__(
        self,
        manager: ConnectionManager,
        gateway: LinuxCncGateway,
        poll_interval_s: float,
    ) -> None:
        self._manager = manager
        self._gateway = gateway
        self._poll_interval_s = poll_interval_s
        self._task: Optional[asyncio.Task[None]] = None
        self._last_change: bool = False
        self._had_active_connection: bool = False
        self._exception_count: int = 0
        self._last_exception_log_ts: float = 0.0
        self._exception_log_interval_s: float = 5.0

    def start(self) -> None:
        if not config.TOOLCHANGE_HAL_ENABLED:
            return
        if not config.TOOLCHANGE_HAL_CHANGE_PIN.strip():
            return
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    def _poll_once(self) -> tuple[Optional[bool], Optional[int]]:
        tmo = config.TOOLCHANGE_HALCMD_TIMEOUT_S
        chg = self._gateway.hal_get_bit(
            config.TOOLCHANGE_HAL_CHANGE_PIN, timeout_s=tmo
        )
        if chg is None:
            return None, None
        if not chg:
            return False, None
        num = self._gateway.hal_get_s32(
            config.TOOLCHANGE_HAL_PREP_NUMBER_PIN, timeout_s=tmo
        )
        return True, num if num is not None else 0

    async def _run(self) -> None:
        while True:
            try:
                await asyncio.sleep(self._poll_interval_s)
                n_clients = len(self._manager.active_connections)
                had_clients = self._had_active_connection
                self._had_active_connection = n_clients > 0
                # Nach komplettem Wegfall aller WebSocket-Clients: Flanke neu scharf
                # schalten, damit nach Reconnect erneut ein Event geht, solange der
                # HAL-Pin noch TRUE ist (sonst kein zweiter Dialog).
                if n_clients > 0 and not had_clients:
                    self._last_change = False

                if not n_clients:
                    continue

                change_active, tool_number = await asyncio.to_thread(self._poll_once)
                if change_active is None:
                    # Lesefehler: Zustand nicht als synchron mit HAL ansehen
                    self._last_change = False
                    continue

                if not change_active:
                    self._last_change = False
                    continue

                # Rising edge: only emit once per tool-change cycle
                if not self._last_change:
                    self._last_change = True
                    tno = int(tool_number) if tool_number is not None else 0
                    description = await asyncio.to_thread(
                        self._gateway.get_tool_description_for_number, tno
                    )
                    event = EventMessage(
                        type="machine_event",
                        event="machine.tool_change.requested",
                        payload={
                            "tool_number": tno,
                            "description": description or "",
                        },
                    )
                    await self._manager.broadcast_json(event.model_dump())
            except asyncio.CancelledError:
                raise
            except Exception:
                self._exception_count += 1
                now = time.monotonic()
                if now - self._last_exception_log_ts >= self._exception_log_interval_s:
                    self._last_exception_log_ts = now
                    logger.exception(
                        "toolchange_hal_publisher failed (exception_count=%s)",
                        self._exception_count,
                    )
