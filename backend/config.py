import os
from pathlib import Path

_HOST_DEFAULT = "127.0.0.1" if os.environ.get("LCNCGUI_DISPLAY_LAUNCH") else "0.0.0.0"
HOST: str = os.environ.get("LCNCGUI_HOST", _HOST_DEFAULT)
PORT: int = int(os.environ.get("LCNCGUI_PORT", "8765"))
WEBSOCKET_PATH: str = "/ws"

# Optional override for the Vite production build (``npm run build`` → ``dist/``).
_FRONTEND_DIST_ENV = os.environ.get("LCNCGUI_FRONTEND_DIST", "").strip()
FRONTEND_DIST_DIR: Path = (
    Path(_FRONTEND_DIST_ENV).expanduser().resolve()
    if _FRONTEND_DIST_ENV
    else Path(__file__).resolve().parent.parent / "dist"
)
STATUS_POLL_INTERVAL_S: float = 1.0

# Poll-Intervall für MDI/AUTO→Manuell, sobald Interpreter und Motion frei sind
# (MdiManualRevertPoller in backend/services/mdi_manual_revert.py).
MDI_MANUAL_REVERT_POLL_INTERVAL_S: float = 0.25

# Publishes frequent coordinate "onChange" events to keep the UI responsive
# while jogging. Events are only broadcast when display coordinates changed
# (rounded to 3 decimals) since the last send.
COORDINATES_PUBLISH_INTERVAL_S: float = 0.05

# Error-Channel (linuxcnc.error_channel) für spontane NML-/Operator-Meldungen
ERROR_CHANNEL_POLL_INTERVAL_S: float = 0.15

# HAL manueller Werkzeugwechsel (iocontrol / PostGUI, vgl. gmoccapy + hal_manualtoolchange)
TOOLCHANGE_HAL_POLL_INTERVAL_S: float = float(
    os.environ.get("LCNCGUI_TOOLCHANGE_POLL_S", "0.15")
)
# Standard aus: Ohne explizites Einschalten pollt lcncgui nicht iocontrol — sonst
# zeigt die UI bei M6/Simulation u. U. den Dialog, obwohl kein HAL-Setup + Ack da ist.
TOOLCHANGE_HAL_ENABLED: bool = os.environ.get(
    "LCNCGUI_TOOLCHANGE_HAL_ENABLED", "0"
).strip().lower() in ("1", "true", "yes", "on")
# Pins lesen mit ``halcmd -s getp <pin>`` (LinuxCNC-Standard)
TOOLCHANGE_HAL_CHANGE_PIN: str = os.environ.get(
    "LCNCGUI_TOOLCHANGE_CHANGE_PIN", "iocontrol.0.tool-change"
).strip()
TOOLCHANGE_HAL_PREP_NUMBER_PIN: str = os.environ.get(
    "LCNCGUI_TOOLCHANGE_PREP_NUMBER_PIN", "iocontrol.0.tool-prep-number"
).strip()
# Eine Shell-Zeile nach Bestätigung im UI (z. B. Puls auf Ack-Pin); leer = Ack schlägt fehl
TOOLCHANGE_ACK_CMD: str = os.environ.get("LCNCGUI_TOOLCHANGE_ACK_CMD", "").strip()
# Optional nach Abort (z. B. HAL zurücksetzen); leer = nur linuxcnc.command.abort()
TOOLCHANGE_ABORT_EXTRA_CMD: str = os.environ.get(
    "LCNCGUI_TOOLCHANGE_ABORT_EXTRA_CMD", ""
).strip()
TOOLCHANGE_HALCMD_TIMEOUT_S: float = float(
    os.environ.get("LCNCGUI_HALCMD_TIMEOUT_S", "3.0")
)

# Virtual sidebar custom HAL softkeys (user labels 14, 15, 16).
# Trigger pins (lcncgui-internal) and feedback pins (user-visible) — see lcncgui-softkeys.hal.

# lcncgui-internal oneshot trigger inputs (do not wire in HAL)
HAL_SOFTKEY_TRIGGER_PINS: dict[int, str] = {
    14: os.environ.get("LCNCGUI_HAL_SOFTKEY_14_PIN", "lcncgui-sk-14.in").strip(),
    15: os.environ.get("LCNCGUI_HAL_SOFTKEY_15_PIN", "lcncgui-sk-15.in").strip(),
    16: os.environ.get("LCNCGUI_HAL_SOFTKEY_16_PIN", "lcncgui-sk-16.in").strip(),
}

# Active-state feedback (lcncgui polls via halcmd getp for green button highlight)
HAL_SOFTKEY_FEEDBACK_PINS: dict[int, str] = {
    14: os.environ.get(
        "LCNCGUI_HAL_SOFTKEY_14_FB_PIN", "lcncgui-sk-14-fb.out"
    ).strip(),
    15: os.environ.get(
        "LCNCGUI_HAL_SOFTKEY_15_FB_PIN", "lcncgui-sk-15-fb.out"
    ).strip(),
    16: os.environ.get(
        "LCNCGUI_HAL_SOFTKEY_16_FB_PIN", "lcncgui-sk-16-fb.out"
    ).strip(),
}

# MPG / jogwheel: IncrementSelector → axis.*.jog-scale (replaces gmoccapy.jog.jog-increment).
_JOG_WHEEL_SCALE_PINS_RAW = os.environ.get(
    "LCNCGUI_JOG_WHEEL_SCALE_PINS",
    "axis.x.jog-scale,axis.y.jog-scale,axis.z.jog-scale",
)
JOG_WHEEL_SCALE_PINS: list[str] = [
    p.strip() for p in _JOG_WHEEL_SCALE_PINS_RAW.split(",") if p.strip()
]

# External panel HAL trigger inputs (virtual sidebar actions via lcncgui-panel.hal).
# Poll debounced *.out pins; rising edge triggers the mapped sidebar button.
PANEL_HAL_ENABLED: bool = os.environ.get(
    "LCNCGUI_PANEL_HAL_ENABLED", "0"
).strip().lower() in ("1", "true", "yes", "on")
PANEL_HAL_POLL_INTERVAL_S: float = float(
    os.environ.get("LCNCGUI_PANEL_HAL_POLL_S", "0.05")
)
PANEL_HAL_STATUS_SYNC_INTERVAL_S: float = float(
    os.environ.get("LCNCGUI_PANEL_HAL_STATUS_SYNC_S", "1.0")
)

# Virtual sidebar button id → debounced HAL output pin (see lcncgui-panel.hal).
PANEL_HAL_TRIGGER_PINS: dict[int, str] = {
    1: os.environ.get(
        "LCNCGUI_PANEL_HAL_MACHINE_TOGGLE_PIN",
        "lcncgui-panel-machine-toggle.out",
    ).strip(),
    2: os.environ.get(
        "LCNCGUI_PANEL_HAL_HOMING_PIN", "lcncgui-panel-homing.out"
    ).strip(),
    3: os.environ.get(
        "LCNCGUI_PANEL_HAL_CYCLE_START_PIN", "lcncgui-panel-cycle-start.out"
    ).strip(),
    4: os.environ.get(
        "LCNCGUI_PANEL_HAL_ESTOP_PIN", "lcncgui-panel-estop.out"
    ).strip(),
    5: os.environ.get(
        "LCNCGUI_PANEL_HAL_AXIS_X_PIN", "lcncgui-panel-axis-x.out"
    ).strip(),
    6: os.environ.get(
        "LCNCGUI_PANEL_HAL_AXIS_Y_PIN", "lcncgui-panel-axis-y.out"
    ).strip(),
    7: os.environ.get(
        "LCNCGUI_PANEL_HAL_AXIS_Z_PIN", "lcncgui-panel-axis-z.out"
    ).strip(),
    8: os.environ.get(
        "LCNCGUI_PANEL_HAL_SOFTKEY_14_PIN", "lcncgui-panel-softkey-14.out"
    ).strip(),
    9: os.environ.get(
        "LCNCGUI_PANEL_HAL_FLOOD_PIN", "lcncgui-panel-flood.out"
    ).strip(),
    10: os.environ.get(
        "LCNCGUI_PANEL_HAL_SPINDLE_REVERSE_PIN",
        "lcncgui-panel-spindle-reverse.out",
    ).strip(),
    11: os.environ.get(
        "LCNCGUI_PANEL_HAL_SPINDLE_STOP_PIN", "lcncgui-panel-spindle-stop.out"
    ).strip(),
    12: os.environ.get(
        "LCNCGUI_PANEL_HAL_SPINDLE_FORWARD_PIN",
        "lcncgui-panel-spindle-forward.out",
    ).strip(),
    13: os.environ.get(
        "LCNCGUI_PANEL_HAL_SOFTKEY_15_PIN", "lcncgui-panel-softkey-15.out"
    ).strip(),
    14: os.environ.get(
        "LCNCGUI_PANEL_HAL_PROGRAM_PAUSE_PIN", "lcncgui-panel-program-pause.out"
    ).strip(),
    15: os.environ.get(
        "LCNCGUI_PANEL_HAL_PROGRAM_STOP_PIN", "lcncgui-panel-program-stop.out"
    ).strip(),
    16: os.environ.get(
        "LCNCGUI_PANEL_HAL_SOFTKEY_16_PIN", "lcncgui-panel-softkey-16.out"
    ).strip(),
}

# Status LED outputs (constant.value parameters; see lcncgui-panel.hal).
PANEL_HAL_STATUS_VALUE_PINS: dict[str, str] = {
    "machine_on": os.environ.get(
        "LCNCGUI_PANEL_HAL_STATUS_MACHINE_ON_PIN",
        "lcncgui-panel-status-machine-on.value",
    ).strip(),
    "estop_active": os.environ.get(
        "LCNCGUI_PANEL_HAL_STATUS_ESTOP_PIN",
        "lcncgui-panel-status-estop.value",
    ).strip(),
    "paused": os.environ.get(
        "LCNCGUI_PANEL_HAL_STATUS_PAUSED_PIN",
        "lcncgui-panel-status-paused.value",
    ).strip(),
    "flood_on": os.environ.get(
        "LCNCGUI_PANEL_HAL_STATUS_FLOOD_PIN",
        "lcncgui-panel-status-flood.value",
    ).strip(),
}

# program.read / program.write (WebSocket payload limits — keep in sync with reverse proxy if any)
PROGRAM_FILE_READ_MAX_BYTES: int = int(
    os.environ.get("LCNCGUI_PROGRAM_FILE_READ_MAX_BYTES", str(4 * 1024 * 1024))
)
PROGRAM_FILE_WRITE_MAX_BYTES: int = int(
    os.environ.get("LCNCGUI_PROGRAM_FILE_WRITE_MAX_BYTES", str(4 * 1024 * 1024))
)
