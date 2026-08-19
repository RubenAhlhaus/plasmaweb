from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

PROTOCOL_VERSION: Literal[1] = 1


class CommandEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["command"]
    protocolVersion: Literal[1] = PROTOCOL_VERSION
    commandId: str
    category: str
    action: str
    params: Dict[str, Any] = Field(default_factory=dict)


class ErrorDetails(BaseModel):
    code: str
    message: str
    #: Optional filesystem path for program.* path validation errors (UI i18n).
    path: Optional[str] = None


class CommandResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["command_result"] = "command_result"
    protocolVersion: Literal[1] = PROTOCOL_VERSION
    commandId: str
    #: Gesetzt vom CommandBus — erlaubt dem Client, Toasts zu unterdrücken, wenn die Fehleranzeige lokal erfolgt.
    category: Optional[str] = None
    action: Optional[str] = None
    ok: bool
    error: Optional[ErrorDetails] = None
    #: True = Kommando akzeptiert, Ergebnis folgt als :class:`CommandCompletion` (gleiche ``commandId``).
    asyncPending: Optional[bool] = None
    #: Erfolgsdaten (z. B. ``program.list`` / ``program.read`` / ``program.write``).
    result: Optional[Dict[str, Any]] = None


class CommandCompletion(BaseModel):
    """Abschluss eines zuvor mit ``asyncPending: true`` bestätigten Kommandos."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["command_completion"] = "command_completion"
    protocolVersion: Literal[1] = PROTOCOL_VERSION
    commandId: str
    category: str
    action: str
    ok: bool
    error: Optional[ErrorDetails] = None


class LinuxCncErrorMessage(BaseModel):
    """Spontaner LinuxCNC-Fehler-/Text vom Error-Channel (ohne zugehöriges WebSocket-Kommando)."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["linuxcnc_error"] = "linuxcnc_error"
    protocolVersion: Literal[1] = PROTOCOL_VERSION
    #: Kurzname, z. B. ``nml_error``, ``operator_error``, ``operator_text``
    kind: str
    message: str


class EventMessage(BaseModel):
    """Generisches Envelope für Status- und Ereignis-Streams.

    Bekannte ``event``-Strings für ``type == "machine_event"`` (siehe auch
    ``docs/backend-frontend-messages.md``), u. a.:

    - ``motion.coordinates.changed``
    - ``machine.tool_change.requested`` — Payload: ``tool_number`` (int),
      ``description`` (str, aus ``stat`` bzw. TOOL_TABLE-Datei). Nach erneutem
      WebSocket-Connect kann dieselbe HAL-Anforderung erneut gemeldet werden
      (Flanke nach Client-Leerlauf).
    - ``panel.sidebar.trigger`` — Payload: ``buttonId`` (int, 1–16). Wenn ein GUI-WebSocket-
      Client verbunden ist, für alle Panel-HAL-Trigger; Frontend nutzt
      ``dispatchVirtualSidebarButton``. Ohne GUI nur Headless-Fallback für Maschinenaktionen
      in ``backend/panel/sidebar_actions.py``. Siehe ``docs/features/15_PANEL_HAL_INPUTS.md``.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["machine_event", "linuxcnc_status"]
    protocolVersion: Literal[1] = PROTOCOL_VERSION
    event: str
    payload: Dict[str, Any] = Field(default_factory=dict)


def build_ok(command_id: str, result: Optional[Dict[str, Any]] = None) -> CommandResult:
    return CommandResult(commandId=command_id, ok=True, result=result)


def build_async_accepted(command_id: str) -> CommandResult:
    """Sofort-ACK: Kommando wird ausgeführt; Ergebnis folgt per :class:`CommandCompletion`."""
    return CommandResult(commandId=command_id, ok=True, asyncPending=True)


def build_error(
    command_id: str,
    code: str,
    message: str,
    *,
    path: str | None = None,
) -> CommandResult:
    return CommandResult(
        commandId=command_id,
        ok=False,
        error=ErrorDetails(code=code, message=message, path=path),
    )


def build_command_completion(
    command_id: str,
    category: str,
    action: str,
    *,
    ok: bool,
    error: Optional[ErrorDetails] = None,
) -> CommandCompletion:
    return CommandCompletion(
        commandId=command_id,
        category=category,
        action=action,
        ok=ok,
        error=error,
    )
