import asyncio
import logging
from contextlib import suppress
from typing import Optional

from backend.adapters.linuxcnc_gateway import LinuxCncGateway
from backend.plasma.machine_log import MachineLog
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
        machine_log: Optional["MachineLog"] = None,
    ) -> None:
        self._manager = manager
        self._gateway = gateway
        self._poll_interval_s = poll_interval_s
        self._machine_log = machine_log
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
                # Drained whether or not anyone is connected: a fault that happened while
                # nobody had the page open is exactly the one somebody needs to read later,
                # and the machine log is where they will go looking for it.
                one = self._gateway.poll_error_channel_once()
                if one is None:
                    continue
                kind, message = one
                if self._machine_log is not None:
                    self._machine_log.record(kind, message)
                if not self._manager.active_connections:
                    continue
                msg = LinuxCncErrorMessage(kind=kind, message=message)
                await self._manager.broadcast_json(msg.model_dump(exclude_none=True))
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("ErrorChannelPublisher loop failed")
