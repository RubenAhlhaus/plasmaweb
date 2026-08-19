from dataclasses import dataclass, field
from typing import Awaitable, Callable, Dict, List, Tuple

from backend.application.context import AppContext
from backend.contracts.messages import (
    CommandEnvelope,
    CommandResult,
    EventMessage,
    build_error,
)

CommandHandler = Callable[[CommandEnvelope, AppContext], Awaitable["DispatchResult"]]


def _attach_command_metadata(ack: CommandResult, command: CommandEnvelope) -> CommandResult:
    return ack.model_copy(update={"category": command.category, "action": command.action})


@dataclass
class DispatchResult:
    ack: CommandResult
    events: List[EventMessage] = field(default_factory=list)


class CommandBus:
    def __init__(self) -> None:
        self._handlers: Dict[Tuple[str, str], CommandHandler] = {}

    def register(self, category: str, action: str, handler: CommandHandler) -> None:
        self._handlers[(category, action)] = handler

    async def dispatch(self, command: CommandEnvelope, ctx: AppContext) -> DispatchResult:
        key = (command.category, command.action)
        handler = self._handlers.get(key)
        if handler is None:
            return DispatchResult(
                ack=_attach_command_metadata(
                    build_error(
                        command.commandId,
                        "unknown_command",
                        f"Unknown command '{command.category}.{command.action}'.",
                    ),
                    command,
                )
            )

        try:
            result = await handler(command, ctx)
            return DispatchResult(
                ack=_attach_command_metadata(result.ack, command),
                events=result.events,
            )
        except Exception as exc:  # noqa: BLE001
            return DispatchResult(
                ack=_attach_command_metadata(
                    build_error(command.commandId, "handler_failed", str(exc)),
                    command,
                )
            )
