from pydantic import BaseModel, ConfigDict, ValidationError

from backend.application.command_bus import DispatchResult
from backend.application.context import AppContext
from backend.contracts.messages import CommandEnvelope, build_error, build_ok
from backend.shutdown import (
    can_schedule_system_shutdown,
    prepare_linuxcnc_for_system_shutdown,
    request_system_shutdown_after_linuxcnc_exit,
)


class AppExitParams(BaseModel):
    """app.exit params: optional system shutdown after closing the UI."""

    shutdown: bool = False

    model_config = ConfigDict(extra="forbid")


async def handle_app_exit(command: CommandEnvelope, ctx: AppContext) -> DispatchResult:
    try:
        params = AppExitParams.model_validate(command.params)
    except ValidationError:
        return DispatchResult(
            ack=build_error(
                command.commandId,
                "invalid_params",
                "Expected params: {} or {\"shutdown\": boolean}.",
            )
        )

    if params.shutdown:
        if not can_schedule_system_shutdown():
            return DispatchResult(
                ack=build_error(
                    command.commandId,
                    "shutdown_unavailable",
                    "System shutdown is not configured. Run: sudo ./install.sh --setup-shutdown",
                )
            )
        await prepare_linuxcnc_for_system_shutdown(ctx.gateway)
        request_system_shutdown_after_linuxcnc_exit()

    return DispatchResult(ack=build_ok(command.commandId))
