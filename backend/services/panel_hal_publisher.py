"""Poll external panel HAL trigger inputs and dispatch virtual sidebar actions."""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import suppress
from typing import Optional

from backend import config
from backend.adapters.linuxcnc_gateway import LinuxCncGateway
from backend.panel.sidebar_actions import (
    dispatch_machine_sidebar_button,
    is_ui_sidebar_button,
    panel_sidebar_trigger_event,
    sync_panel_status_hal_outputs,
)
from backend.ws.connection_manager import ConnectionManager

logger = logging.getLogger(__name__)


class PanelHalPublisher:
    """
    Poll debounced HAL panel trigger pins (``lcncgui-panel.hal``).

    Rising edge on a trigger pin executes the matching virtual sidebar action.
    When a GUI WebSocket client is connected, **all** actions go through
    ``panel.sidebar.trigger`` (same path as sidebar/hotkey). Without a GUI
    client, machine/program actions run directly in the backend; UI dialog
    actions are ignored.
    """

    def __init__(
        self,
        manager: ConnectionManager,
        gateway: LinuxCncGateway,
        poll_interval_s: float,
        status_sync_interval_s: float,
    ) -> None:
        self._manager = manager
        self._gateway = gateway
        self._poll_interval_s = poll_interval_s
        self._status_sync_interval_s = status_sync_interval_s
        self._task: Optional[asyncio.Task[None]] = None
        self._last_trigger: dict[int, bool] = {}
        self._had_active_connection: bool = False
        self._last_status_sync_ts: float = 0.0
        self._hal_available: bool = False
        self._exception_count: int = 0
        self._last_exception_log_ts: float = 0.0
        self._exception_log_interval_s: float = 5.0

    def start(self) -> None:
        if not config.PANEL_HAL_ENABLED:
            return
        if not any(p.strip() for p in config.PANEL_HAL_TRIGGER_PINS.values()):
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

    def _configured_button_ids(self) -> list[int]:
        return sorted(
            btn_id
            for btn_id, pin in config.PANEL_HAL_TRIGGER_PINS.items()
            if (pin or "").strip()
        )

    def _poll_trigger(self, button_id: int) -> Optional[bool]:
        pin = config.PANEL_HAL_TRIGGER_PINS.get(button_id, "").strip()
        if not pin:
            return None
        return self._gateway.hal_get_bit(
            pin, timeout_s=config.TOOLCHANGE_HALCMD_TIMEOUT_S
        )

    async def _dispatch_button(self, button_id: int, *, n_clients: int) -> None:
        if n_clients > 0:
            event = panel_sidebar_trigger_event(button_id)
            await self._manager.broadcast_json(event.model_dump())
            return
        if is_ui_sidebar_button(button_id):
            return
        await asyncio.to_thread(
            dispatch_machine_sidebar_button, button_id, self._gateway
        )

    async def _run(self) -> None:
        while True:
            try:
                await asyncio.sleep(self._poll_interval_s)
                n_clients = len(self._manager.active_connections)
                had_clients = self._had_active_connection
                self._had_active_connection = n_clients > 0

                if n_clients > 0 and not had_clients:
                    for button_id in self._configured_button_ids():
                        self._last_trigger[button_id] = False

                now = time.monotonic()
                if (
                    self._hal_available
                    and now - self._last_status_sync_ts >= self._status_sync_interval_s
                ):
                    self._last_status_sync_ts = now
                    wrote = await asyncio.to_thread(
                        sync_panel_status_hal_outputs, self._gateway
                    )
                    if wrote:
                        self._hal_available = True

                for button_id in self._configured_button_ids():
                    active = await asyncio.to_thread(self._poll_trigger, button_id)
                    if active is None:
                        self._last_trigger[button_id] = False
                        continue
                    self._hal_available = True
                    if not active:
                        self._last_trigger[button_id] = False
                        continue
                    if self._last_trigger.get(button_id, False):
                        continue
                    self._last_trigger[button_id] = True
                    await self._dispatch_button(button_id, n_clients=n_clients)
            except asyncio.CancelledError:
                raise
            except Exception:
                self._exception_count += 1
                now = time.monotonic()
                if now - self._last_exception_log_ts >= self._exception_log_interval_s:
                    self._last_exception_log_ts = now
                    logger.exception(
                        "panel_hal_publisher failed (exception_count=%s)",
                        self._exception_count,
                    )
