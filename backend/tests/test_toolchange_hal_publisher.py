"""Tests for :class:`backend.services.toolchange_hal_publisher.ToolChangeHalPublisher`."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend import config
from backend.services.toolchange_hal_publisher import ToolChangeHalPublisher


class _ConnMgr:
    """Connection manager with a mutable client list and async ``broadcast_json``."""

    def __init__(self) -> None:
        self.active_connections: list[object] = []
        self.broadcast_json = AsyncMock()


def test_rising_edge_broadcasts_once_while_pin_stays_true(monkeypatch) -> None:
    monkeypatch.setattr(config, "TOOLCHANGE_HAL_ENABLED", True)
    monkeypatch.setattr(config, "TOOLCHANGE_HAL_CHANGE_PIN", "iocontrol.0.tool-change")

    mgr = _ConnMgr()
    mgr.active_connections = [object()]

    gw = MagicMock()
    gw.hal_get_bit.return_value = True
    gw.hal_get_s32.return_value = 5
    gw.get_tool_description_for_number.return_value = "endmill"

    async def _run() -> None:
        pub = ToolChangeHalPublisher(mgr, gw, poll_interval_s=0.002)
        pub.start()
        await asyncio.sleep(0.025)
        await pub.stop()

    asyncio.run(_run())

    assert mgr.broadcast_json.await_count == 1
    call = mgr.broadcast_json.await_args_list[0].args[0]
    assert call["type"] == "machine_event"
    assert call["event"] == "machine.tool_change.requested"
    assert call["payload"]["tool_number"] == 5
    assert call["payload"]["description"] == "endmill"


def test_false_then_true_broadcasts_again(monkeypatch) -> None:
    monkeypatch.setattr(config, "TOOLCHANGE_HAL_ENABLED", True)
    monkeypatch.setattr(config, "TOOLCHANGE_HAL_CHANGE_PIN", "iocontrol.0.tool-change")

    mgr = _ConnMgr()
    mgr.active_connections = [object()]

    gw = MagicMock()
    seq = iter([(False, None), (True, 1), (True, 1), (False, None), (True, 2)])

    def fake_poll() -> tuple:
        try:
            return next(seq)
        except StopIteration:
            return (False, None)

    async def _run() -> None:
        pub = ToolChangeHalPublisher(mgr, gw, poll_interval_s=0.002)
        pub._poll_once = fake_poll  # type: ignore[method-assign]
        pub.start()
        await asyncio.sleep(0.12)
        await pub.stop()

    asyncio.run(_run())

    assert mgr.broadcast_json.await_count == 2
    assert mgr.broadcast_json.await_args_list[0].args[0]["payload"]["tool_number"] == 1
    assert mgr.broadcast_json.await_args_list[1].args[0]["payload"]["tool_number"] == 2


def test_hal_read_failure_resets_edge_then_rising_edge_fires(monkeypatch) -> None:
    monkeypatch.setattr(config, "TOOLCHANGE_HAL_ENABLED", True)
    monkeypatch.setattr(config, "TOOLCHANGE_HAL_CHANGE_PIN", "iocontrol.0.tool-change")

    mgr = _ConnMgr()
    mgr.active_connections = [object()]

    gw = MagicMock()
    seq = iter([(None, None), (True, 7)])

    def fake_poll() -> tuple:
        try:
            return next(seq)
        except StopIteration:
            return (True, 7)

    async def _run() -> None:
        pub = ToolChangeHalPublisher(mgr, gw, poll_interval_s=0.002)
        pub._poll_once = fake_poll  # type: ignore[method-assign]
        pub.start()
        await asyncio.sleep(0.06)
        await pub.stop()

    asyncio.run(_run())

    assert mgr.broadcast_json.await_count == 1
    assert mgr.broadcast_json.await_args_list[0].args[0]["payload"]["tool_number"] == 7


def test_rebroadcast_after_all_clients_disconnect(monkeypatch) -> None:
    monkeypatch.setattr(config, "TOOLCHANGE_HAL_ENABLED", True)
    monkeypatch.setattr(config, "TOOLCHANGE_HAL_CHANGE_PIN", "iocontrol.0.tool-change")

    class _Mgr:
        def __init__(self) -> None:
            self._clients: list[object] = [object()]
            self.sent: list[dict] = []

        @property
        def active_connections(self) -> list[object]:
            return self._clients

        async def broadcast_json(self, msg: dict) -> None:
            self.sent.append(msg)

    mgr = _Mgr()
    gw = MagicMock()
    gw.hal_get_bit.return_value = True
    gw.hal_get_s32.return_value = 4
    gw.get_tool_description_for_number.return_value = ""

    async def _run() -> None:
        pub = ToolChangeHalPublisher(mgr, gw, poll_interval_s=0.005)
        pub.start()
        await asyncio.sleep(0.012)
        mgr._clients = []
        await asyncio.sleep(0.012)
        mgr._clients = [object()]
        await asyncio.sleep(0.02)
        await pub.stop()

    asyncio.run(_run())

    assert len(mgr.sent) == 2
