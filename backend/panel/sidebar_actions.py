"""Dispatch virtual sidebar button actions from HAL panel triggers."""

from __future__ import annotations

import logging
import time
from typing import Optional

from backend import config
from backend.adapters.linuxcnc_gateway import GatewayCommandResult, LinuxCncGateway
from backend.contracts.messages import EventMessage
from backend.panel.constants import HAL_SOFTKEY_SLOT_BY_SIDEBAR_BUTTON, UI_SIDEBAR_BUTTON_IDS

logger = logging.getLogger(__name__)

STATE_ESTOP = 1
STATE_ESTOP_RESET = 2
STATE_OFF = 3
STATE_ON = 4
INTERP_PAUSED = 3

_ESTOP_RESET_VERIFY_RETRIES = 5
_ESTOP_RESET_VERIFY_INTERVAL_S = 0.05


def is_ui_sidebar_button(button_id: int) -> bool:
    return button_id in UI_SIDEBAR_BUTTON_IDS


def panel_sidebar_trigger_event(button_id: int) -> EventMessage:
    return EventMessage(
        type="machine_event",
        event="panel.sidebar.trigger",
        payload={"buttonId": button_id},
    )


def _is_program_paused(snap: dict) -> bool:
    program = snap.get("program") or {}
    if program.get("paused") is True:
        return True
    interp = program.get("interp_state")
    return interp is not None and int(interp) == INTERP_PAUSED


def _log_gateway_failure(action: str, button_id: int, result: GatewayCommandResult) -> None:
    if result.ok:
        return
    logger.warning(
        "panel sidebar action failed (%s, button=%s): %s — %s",
        action,
        button_id,
        result.error_code or "unknown",
        result.error_message or "",
    )


def _set_task_state_with_estop_reset_verify(
    gateway: LinuxCncGateway, status: int, *, button_id: int
) -> None:
    gateway.set_task_state(status)
    if status != STATE_ESTOP_RESET:
        return

    snap = gateway.get_status_snapshot()
    machine = snap.get("machine") or {}
    actual_raw = machine.get("task_state")
    actual_ts = int(actual_raw) if actual_raw is not None else None

    if actual_ts != STATE_ESTOP:
        return

    for _ in range(_ESTOP_RESET_VERIFY_RETRIES):
        time.sleep(_ESTOP_RESET_VERIFY_INTERVAL_S)
        snap = gateway.get_status_snapshot()
        machine = snap.get("machine") or {}
        actual_raw = machine.get("task_state")
        actual_ts = int(actual_raw) if actual_raw is not None else None
        if actual_ts != STATE_ESTOP:
            return

    logger.warning(
        "panel sidebar E-stop reset rejected (button=%s): hardware E-stop may still be active",
        button_id,
    )


def dispatch_machine_sidebar_button(
    button_id: int, gateway: LinuxCncGateway
) -> None:
    """
    Execute a machine/program/HAL softkey sidebar action via the gateway.

    Used when no GUI WebSocket client is connected. When the GUI is connected,
    ``PanelHalPublisher`` routes all buttons through ``panel.sidebar.trigger`` instead.
    """
    snap = gateway.get_status_snapshot()
    machine = snap.get("machine") or {}
    io = snap.get("io") or {}
    task_state = machine.get("task_state")
    hardware_estop = machine.get("error") is True

    if button_id == 1:
        if task_state == STATE_ON:
            gateway.set_task_state(STATE_OFF)
        elif task_state in (STATE_OFF, STATE_ESTOP_RESET):
            gateway.set_task_state(STATE_ON)
        return

    if button_id == 4:
        in_estop = task_state == STATE_ESTOP or hardware_estop
        if in_estop:
            _set_task_state_with_estop_reset_verify(
                gateway, STATE_ESTOP_RESET, button_id=button_id
            )
        else:
            gateway.set_task_state(STATE_ESTOP)
        return

    if button_id == 3:
        if _is_program_paused(snap):
            result = gateway.program_auto("resume")
            _log_gateway_failure("program_auto resume", button_id, result)
        else:
            result = gateway.program_auto("run", start_line=0)
            _log_gateway_failure("program_auto run", button_id, result)
        return

    if button_id == 14:
        if _is_program_paused(snap):
            result = gateway.program_auto("resume")
            _log_gateway_failure("program_auto resume", button_id, result)
        else:
            result = gateway.program_auto("pause")
            _log_gateway_failure("program_auto pause", button_id, result)
        return

    if button_id == 15:
        result = gateway.abort_program()
        _log_gateway_failure("abort_program", button_id, result)
        return

    if button_id == 9:
        if task_state != STATE_ON:
            return
        flood_on = (io.get("flood") or 0) != 0
        result = gateway.set_flood(not flood_on)
        _log_gateway_failure("set_flood", button_id, result)
        return

    if button_id == 10:
        result = gateway.set_spindle("reverse")
        _log_gateway_failure("set_spindle reverse", button_id, result)
        return

    if button_id == 11:
        result = gateway.set_spindle("stop")
        _log_gateway_failure("set_spindle stop", button_id, result)
        return

    if button_id == 12:
        result = gateway.set_spindle("forward")
        _log_gateway_failure("set_spindle forward", button_id, result)
        return

    if button_id in HAL_SOFTKEY_SLOT_BY_SIDEBAR_BUTTON:
        slot = HAL_SOFTKEY_SLOT_BY_SIDEBAR_BUTTON[button_id]
        pin = config.HAL_SOFTKEY_TRIGGER_PINS.get(slot, "").strip()
        if not pin:
            logger.warning(
                "panel HAL softkey skipped (button=%s): no trigger pin for slot %s",
                button_id,
                slot,
            )
            return
        result = gateway.hal_pulse_rising_edge(
            pin, timeout_s=config.TOOLCHANGE_HALCMD_TIMEOUT_S
        )
        _log_gateway_failure(f"hal_softkey_pulse slot {slot}", button_id, result)
        return

    raise ValueError(f"Unsupported machine sidebar button id: {button_id}")


def compute_panel_status_bits(snap: dict) -> dict[str, bool]:
    machine = snap.get("machine") or {}
    io = snap.get("io") or {}
    task_state = machine.get("task_state")
    hardware_estop = machine.get("error") is True
    return {
        "machine_on": task_state == STATE_ON,
        "estop_active": task_state == STATE_ESTOP or hardware_estop,
        "paused": _is_program_paused(snap),
        "flood_on": (io.get("flood") or 0) != 0,
    }


def sync_panel_status_hal_outputs(
    gateway: LinuxCncGateway, snap: Optional[dict] = None
) -> bool:
    """
    Mirror status snapshot onto optional HAL constant.value pins for panel LEDs.

    Returns True when at least one status pin was written successfully.
    """
    if not config.PANEL_HAL_STATUS_VALUE_PINS:
        return False
    status = compute_panel_status_bits(snap or gateway.get_status_snapshot())
    tmo = config.TOOLCHANGE_HALCMD_TIMEOUT_S
    any_ok = False
    for key, pin in config.PANEL_HAL_STATUS_VALUE_PINS.items():
        token = (pin or "").strip()
        if not token:
            continue
        value = status.get(key)
        if value is None:
            continue
        result = gateway.hal_set_bit(token, bool(value), timeout_s=tmo)
        if result.ok:
            any_ok = True
        else:
            _log_gateway_failure(f"status sync {key}", 0, result)
    return any_ok
