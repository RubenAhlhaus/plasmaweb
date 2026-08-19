import asyncio
import logging
from contextlib import suppress
from typing import Optional

from backend.adapters.linuxcnc_gateway import LinuxCncGateway
from backend.contracts.messages import LinuxCncErrorMessage
from backend.ws.connection_manager import ConnectionManager

logger = logging.getLogger(__name__)


class ErrorChannelPublisher:
    """
    Polls ``linuxcnc.error_channel`` and broadcasts :class:`LinuxCncErrorMessage`
    to all WebSocket clients (spontaneous NML/operator messages).

    Command-correlated failures (e.g. homing) may also post here; the UI may
    receive both ``linuxcnc_error`` and ``command_completion`` for the same fault.
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
                if not self._manager.active_connections:
                    continue
                one = self._gateway.poll_error_channel_once()
                if one is None:
                    continue
                kind, message = one
                msg = LinuxCncErrorMessage(kind=kind, message=message)
                await self._manager.broadcast_json(msg.model_dump(exclude_none=True))
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("ErrorChannelPublisher loop failed")
