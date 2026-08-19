"""Map ``GatewayCommandResult`` to a ``DispatchResult`` with only an ACK (no events)."""

from backend.adapters.linuxcnc_gateway import GatewayCommandResult
from backend.application.command_bus import DispatchResult
from backend.contracts.messages import build_error, build_ok


def gateway_result_to_dispatch(command_id: str, result: GatewayCommandResult) -> DispatchResult:
    if result.ok:
        return DispatchResult(ack=build_ok(command_id), events=[])
    return DispatchResult(
        ack=build_error(
            command_id,
            result.error_code or "handler_failed",
            result.error_message or "Gateway returned failure without error details.",
        ),
        events=[],
    )
