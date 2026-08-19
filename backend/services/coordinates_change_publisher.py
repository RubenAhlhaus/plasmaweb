import asyncio
from contextlib import suppress
import logging
from typing import Dict, Optional
import time

from backend.adapters.linuxcnc_gateway import LinuxCncGateway
from backend.contracts.messages import EventMessage
from backend.ws.connection_manager import ConnectionManager

logger = logging.getLogger(__name__)


class CoordinatesChangePublisher:
    """
    Publishes frequent coordinate "onChange"-style events so the frontend
    updates immediately while jogging.
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
        self._last_rounded: Optional[Dict[str, float]] = None
        self._exception_count: int = 0
        self._last_exception_log_ts: float = 0.0
        # Avoid log spam for a high-frequency stream.
        self._exception_log_interval_s: float = 5.0

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

    def _round_coordinates(self, coords: Dict[str, float]) -> Dict[str, float]:
        # Coordinatendisplay rendert aktuell mit toFixed(3), daher vergleichen wir
        # gerundete Werte um unnötige Events zu vermeiden.
        return {k: round(float(v), 3) for k, v in coords.items()}

    async def _run(self) -> None:
        while True:
            if self._manager.active_connections:
                try:
                    # Offload the blocking LinuxCNC poll + coordinate computation
                    # to avoid stalling the asyncio event loop.
                    coords = await asyncio.to_thread(
                        self._gateway.get_display_coordinates
                    )
                    rounded = self._round_coordinates(coords)

                    if (
                        self._last_rounded is None
                        or any(
                            self._last_rounded.get(axis) != rounded.get(axis)
                            for axis in rounded.keys()
                        )
                    ):
                        self._last_rounded = rounded
                        event = EventMessage(
                            type="machine_event",
                            event="motion.coordinates.changed",
                            payload={"coordinates": coords},
                        )
                        await self._manager.broadcast_json(event.model_dump())
                except Exception:
                    # Keep the publisher alive; losing the high-frequency stream
                    # should never kill the entire WS session.
                    # But do not completely swallow exceptions: log them (rate-limited)
                    # so issues can be diagnosed.
                    self._exception_count += 1
                    now = time.monotonic()
                    if now - self._last_exception_log_ts >= self._exception_log_interval_s:
                        self._last_exception_log_ts = now
                        logger.exception(
                            "coordinates_change_publisher failed (exception_count=%s)",
                            self._exception_count,
                        )

            await asyncio.sleep(self._poll_interval_s)

