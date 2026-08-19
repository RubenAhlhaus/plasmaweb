"""Tests for :mod:`backend.panel.sidebar_actions`."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from backend import config
from backend.adapters.linuxcnc_gateway import GatewayCommandResult
from backend.panel.constants import HAL_SOFTKEY_SLOT_BY_SIDEBAR_BUTTON
from backend.panel.sidebar_actions import (
    compute_panel_status_bits,
    dispatch_machine_sidebar_button,
    is_ui_sidebar_button,
    panel_sidebar_trigger_event,
    sync_panel_status_hal_outputs,
)


def test_hal_softkey_mapping_matches_frontend_contract() -> None:
    # Keep in sync with HAL_SOFTKEY_DISPLAY_SLOT_BY_BUTTON_ID in virtualSidebarButtons.ts
    assert HAL_SOFTKEY_SLOT_BY_SIDEBAR_BUTTON == {8: 14, 13: 15, 16: 16}


def test_is_ui_sidebar_button() -> None:
    assert is_ui_sidebar_button(2) is True
    assert is_ui_sidebar_button(5) is True
    assert is_ui_sidebar_button(1) is False


def test_panel_sidebar_trigger_event_payload() -> None:
    event = panel_sidebar_trigger_event(2)
    assert event.event == "panel.sidebar.trigger"
    assert event.payload == {"buttonId": 2}


def test_machine_toggle_on_to_off() -> None:
    gw = MagicMock()
    gw.get_status_snapshot.return_value = {"machine": {"task_state": 4}}
    dispatch_machine_sidebar_button(1, gw)
    gw.set_task_state.assert_called_once_with(3)


def test_machine_toggle_off_to_on() -> None:
    gw = MagicMock()
    gw.get_status_snapshot.return_value = {"machine": {"task_state": 3}}
    dispatch_machine_sidebar_button(1, gw)
    gw.set_task_state.assert_called_once_with(4)


def test_estop_toggle_to_estop() -> None:
    gw = MagicMock()
    gw.get_status_snapshot.return_value = {"machine": {"task_state": 4, "error": False}}
    dispatch_machine_sidebar_button(4, gw)
    gw.set_task_state.assert_called_once_with(1)


def test_estop_reset_still_estop_after_verify(monkeypatch) -> None:
    monkeypatch.setattr("backend.panel.sidebar_actions.time.sleep", lambda _: None)
    gw = MagicMock()
    gw.get_status_snapshot.return_value = {"machine": {"task_state": 1, "error": False}}
    dispatch_machine_sidebar_button(4, gw)
    gw.set_task_state.assert_called_once_with(2)


def test_program_pause_when_running() -> None:
    gw = MagicMock()
    gw.get_status_snapshot.return_value = {"program": {"interp_state": 1}}
    gw.program_auto.return_value = GatewayCommandResult(ok=True)
    dispatch_machine_sidebar_button(14, gw)
    gw.program_auto.assert_called_once_with("pause")


def test_program_run_logs_failure(monkeypatch, caplog) -> None:
    import logging

    caplog.set_level(logging.WARNING)
    gw = MagicMock()
    gw.get_status_snapshot.return_value = {"program": {"interp_state": 1}}
    gw.program_auto.return_value = GatewayCommandResult(
        ok=False,
        error_code="interpreter_busy",
        error_message="busy",
    )
    dispatch_machine_sidebar_button(3, gw)
    assert "interpreter_busy" in caplog.text


def test_hal_softkey_pulse_uses_config_pin(monkeypatch) -> None:
    monkeypatch.setitem(config.HAL_SOFTKEY_TRIGGER_PINS, 14, "lcncgui-sk-14.in")
    gw = MagicMock()
    gw.get_status_snapshot.return_value = {}
    gw.hal_pulse_rising_edge.return_value = GatewayCommandResult(ok=True)
    dispatch_machine_sidebar_button(8, gw)
    gw.hal_pulse_rising_edge.assert_called_once()


def test_compute_panel_status_bits() -> None:
    bits = compute_panel_status_bits(
        {
            "machine": {"task_state": 4, "error": False},
            "program": {"interp_state": 3},
            "io": {"flood": 1},
        }
    )
    assert bits == {
        "machine_on": True,
        "estop_active": False,
        "paused": True,
        "flood_on": True,
    }


def test_sync_panel_status_returns_false_when_all_writes_fail(monkeypatch) -> None:
    monkeypatch.setattr(
        config,
        "PANEL_HAL_STATUS_VALUE_PINS",
        {"machine_on": "lcncgui-panel-status-machine-on.value"},
    )
    gw = MagicMock()
    gw.get_status_snapshot.return_value = {"machine": {"task_state": 4, "error": False}}
    gw.hal_set_bit.return_value = GatewayCommandResult(
        ok=False, error_code="hal_set_failed", error_message="missing pin"
    )
    assert sync_panel_status_hal_outputs(gw) is False


def test_unsupported_button_raises() -> None:
    gw = MagicMock()
    with pytest.raises(ValueError, match="Unsupported"):
        dispatch_machine_sidebar_button(2, gw)
