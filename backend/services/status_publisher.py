import asyncio
from contextlib import suppress
from typing import Optional

from backend.adapters.linuxcnc_gateway import LinuxCncGateway
from backend.contracts.messages import EventMessage
from backend.ws.connection_manager import ConnectionManager


class StatusPublisher:
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
            if self._manager.active_connections:
                event = EventMessage(
                    type="linuxcnc_status",
                    event="status.snapshot",
                    payload=self._gateway.get_status_snapshot(),
                )
                await self._manager.broadcast_json(event.model_dump())
            await asyncio.sleep(self._poll_interval_s)
