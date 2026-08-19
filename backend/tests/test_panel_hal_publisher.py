"""Tests for :mod:`backend.services.panel_hal_publisher.PanelHalPublisher`."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend import config
from backend.services.panel_hal_publisher import PanelHalPublisher


class _ConnMgr:
    def __init__(self) -> None:
        self.active_connections: list[object] = []
        self.broadcast_json = AsyncMock()


def test_machine_action_runs_without_websocket_clients(monkeypatch) -> None:
    monkeypatch.setattr(config, "PANEL_HAL_ENABLED", True)
    monkeypatch.setattr(
        config,
        "PANEL_HAL_TRIGGER_PINS",
        {1: "lcncgui-panel-machine-toggle.out"},
    )
    monkeypatch.setattr(config, "PANEL_HAL_STATUS_VALUE_PINS", {})

    mgr = _ConnMgr()
    gw = MagicMock()
    gw.get_status_snapshot.return_value = {"machine": {"task_state": 4, "error": False}}
    seq = iter([False, True, True, False, True, True])

    def fake_poll(button_id: int):
        try:
            return next(seq)
        except StopIteration:
            return False

    async def _run() -> None:
        pub = PanelHalPublisher(mgr, gw, poll_interval_s=0.002, status_sync_interval_s=999)
        pub._poll_trigger = fake_poll  # type: ignore[method-assign]
        pub.start()
        await asyncio.sleep(0.03)
        await pub.stop()

    asyncio.run(_run())

    assert mgr.broadcast_json.await_count == 0
    assert gw.set_task_state.call_count >= 1
    assert gw.set_task_state.call_args.args == (3,)


def test_gui_connected_routes_machine_action_via_panel_event(monkeypatch) -> None:
    monkeypatch.setattr(config, "PANEL_HAL_ENABLED", True)
    monkeypatch.setattr(
        config,
        "PANEL_HAL_TRIGGER_PINS",
        {1: "lcncgui-panel-machine-toggle.out"},
    )
    monkeypatch.setattr(config, "PANEL_HAL_STATUS_VALUE_PINS", {})

    mgr = _ConnMgr()
    mgr.active_connections = [object()]
    gw = MagicMock()
    seq = iter([False, True, False, True])

    def fake_poll(button_id: int):
        try:
            return next(seq)
        except StopIteration:
            return False

    async def _run() -> None:
        pub = PanelHalPublisher(mgr, gw, poll_interval_s=0.002, status_sync_interval_s=999)
        pub._poll_trigger = fake_poll  # type: ignore[method-assign]
        pub.start()
        await asyncio.sleep(0.03)
        await pub.stop()

    asyncio.run(_run())

    assert mgr.broadcast_json.await_count >= 1
    call = mgr.broadcast_json.await_args_list[0].args[0]
    assert call["event"] == "panel.sidebar.trigger"
    assert call["payload"]["buttonId"] == 1
    gw.set_task_state.assert_not_called()


def test_ui_action_broadcasts_panel_event(monkeypatch) -> None:
    monkeypatch.setattr(config, "PANEL_HAL_ENABLED", True)
    monkeypatch.setattr(config, "PANEL_HAL_TRIGGER_PINS", {2: "lcncgui-panel-homing.out"})
    monkeypatch.setattr(config, "PANEL_HAL_STATUS_VALUE_PINS", {})

    mgr = _ConnMgr()
    mgr.active_connections = [object()]
    gw = MagicMock()
    seq = iter([False, True, False, True])

    def fake_poll(button_id: int):
        try:
            return next(seq)
        except StopIteration:
            return False

    async def _run() -> None:
        pub = PanelHalPublisher(mgr, gw, poll_interval_s=0.002, status_sync_interval_s=999)
        pub._poll_trigger = fake_poll  # type: ignore[method-assign]
        pub.start()
        await asyncio.sleep(0.03)
        await pub.stop()

    asyncio.run(_run())

    assert mgr.broadcast_json.await_count >= 1
    call = mgr.broadcast_json.await_args_list[0].args[0]
    assert call["event"] == "panel.sidebar.trigger"
    assert call["payload"]["buttonId"] == 2


def test_ui_action_skipped_without_clients(monkeypatch) -> None:
    monkeypatch.setattr(config, "PANEL_HAL_ENABLED", True)
    monkeypatch.setattr(config, "PANEL_HAL_TRIGGER_PINS", {2: "lcncgui-panel-homing.out"})
    monkeypatch.setattr(config, "PANEL_HAL_STATUS_VALUE_PINS", {})

    mgr = _ConnMgr()
    gw = MagicMock()
    seq = iter([False, True, False, True])

    def fake_poll(button_id: int):
        try:
            return next(seq)
        except StopIteration:
            return False

    async def _run() -> None:
        pub = PanelHalPublisher(mgr, gw, poll_interval_s=0.002, status_sync_interval_s=999)
        pub._poll_trigger = fake_poll  # type: ignore[method-assign]
        pub.start()
        await asyncio.sleep(0.03)
        await pub.stop()

    asyncio.run(_run())

    assert mgr.broadcast_json.await_count == 0
