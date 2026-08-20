"""Broadcast plasma pin changes from the HAL bridge thread to WebSocket clients.

The bridge thread must never touch the event loop, so it only hands diffs to
:meth:`PlasmaPublisher.submit_change` via ``loop.call_soon_threadsafe``. Everything after
that is ordinary asyncio.

Diffs queued while the loop was busy are merged before sending: at 20 Hz a client cares
about the current value of a pin, not about every intermediate one.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from typing import Any, Dict, Optional

from backend.contracts.messages import EventMessage
from backend.plasma.config_service import PlasmaConfigService
from backend.plasma.hal_bridge import Snapshot
from backend.plasma.pins import PLASMAC_COMPONENT
from backend.plasma.service import PlasmaService
from backend.plasma.state import state_payload
from backend.ws.connection_manager import ConnectionManager

logger = logging.getLogger(__name__)

PINS_CHANGED_EVENT = "plasma.pins.changed"
PINS_SNAPSHOT_EVENT = "plasma.pins.snapshot"
STATE_CHANGED_EVENT = "plasma.state.changed"

#: Changing either of these means the decoded state changed too.
_STATE_PINS = ("state-out", "stop-type-out")


class PlasmaPublisher:
    def __init__(
        self,
        manager: ConnectionManager,
        service: PlasmaService,
        config: Optional[PlasmaConfigService] = None,
    ) -> None:
        self._manager = manager
        self._service = service
        #: Watches our own pins for the material-change handshake. It answers HAL itself and
        #: hands back the events to broadcast, so the protocol never touches asyncio.
        self._config = config
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._queue: "asyncio.Queue[Snapshot]" = asyncio.Queue()
        self._task: Optional[asyncio.Task[None]] = None
        self._last_state: Optional[Dict[str, Any]] = None

    # ---- lifecycle -----------------------------------------------------------------

    def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._service.bridge.set_on_change(self._on_bridge_change)
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name="plasma-publisher")

    async def stop(self) -> None:
        self._service.bridge.set_on_change(None)
        if self._task is None:
            return
        self._task.cancel()
        with suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    # ---- bridge thread -------------------------------------------------------------

    def _on_bridge_change(self, snapshot: Snapshot, diff: Snapshot) -> None:
        """Called on the HAL bridge thread. Hands the diff over and returns immediately."""
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(self.submit_change, diff)

    def submit_change(self, diff: Snapshot) -> None:
        """Event-loop side of the hand-over. Public so tests can drive it directly."""
        self._queue.put_nowait(diff)

    # ---- event loop ----------------------------------------------------------------

    async def _run(self) -> None:
        while True:
            diff = await self._queue.get()
            diff = self._merge_pending(diff)
            try:
                await self.publish_diff(diff)
            except Exception:
                logger.exception("plasma: publishing a pin diff failed")

    def _merge_pending(self, diff: Snapshot) -> Snapshot:
        merged: Snapshot = {component: dict(values) for component, values in diff.items()}
        while True:
            try:
                extra = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                return merged
            for component, values in extra.items():
                merged.setdefault(component, {}).update(values)

    async def publish_diff(self, diff: Snapshot) -> None:
        if not diff:
            return
        # The M190 handshake has to be answered whether or not a browser is listening.
        for event, payload in self._config_events(diff):
            await self._broadcast(event, payload)
        if not self._manager.active_connections:
            return
        await self._manager.broadcast_json(
            EventMessage(
                type="machine_event", event=PINS_CHANGED_EVENT, payload={"pins": diff}
            ).model_dump()
        )

        plasmac_diff = diff.get(PLASMAC_COMPONENT, {})
        if not any(name in plasmac_diff for name in _STATE_PINS):
            return
        plasmac = self._service.bridge.snapshot().get(PLASMAC_COMPONENT, {})
        payload = state_payload(plasmac.get("state-out"), plasmac.get("stop-type-out"))
        if payload == self._last_state:
            return
        self._last_state = payload
        await self._manager.broadcast_json(
            EventMessage(
                type="machine_event", event=STATE_CHANGED_EVENT, payload=payload
            ).model_dump()
        )

    # ---- connect -------------------------------------------------------------------

    def snapshot_event(self) -> Dict[str, Any]:
        """The full-snapshot event a freshly connected client receives."""
        return snapshot_event(self._service)

    async def send_snapshot(self, websocket: Any) -> None:
        await self._manager.send_json(websocket, self.snapshot_event())

    # ---- helpers -------------------------------------------------------------------

    def _config_events(self, diff: Snapshot) -> list:
        if self._config is None:
            return []
        try:
            return self._config.observe(diff)
        except Exception:
            logger.exception("plasma: handling a material pin change failed")
            return []

    async def _broadcast(self, event: str, payload: Dict[str, Any]) -> None:
        if not self._manager.active_connections:
            return
        await self._manager.broadcast_json(
            EventMessage(type="machine_event", event=event, payload=payload).model_dump()
        )


def snapshot_event(service: PlasmaService) -> Dict[str, Any]:
    """Full plasma snapshot as an event. Diffs are only meaningful on top of one of these."""
    return EventMessage(
        type="machine_event",
        event=PINS_SNAPSHOT_EVENT,
        payload=service.snapshot_payload(),
    ).model_dump()
