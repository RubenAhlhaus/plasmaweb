import asyncio
import json
import logging
import signal

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from backend.application.command_bus import CommandBus
from backend.application.context import AppContext
from backend.contracts.messages import CommandEnvelope, build_error
from backend.ws.connection_manager import ConnectionManager

logger = logging.getLogger(__name__)


async def _shutdown_backend_after_ack() -> None:
    """Run after command_result was sent so the client receives the ACK first."""
    try:
        await asyncio.sleep(0.05)
        from backend.uvicorn_server_ref import request_uvicorn_exit

        if request_uvicorn_exit():
            return
        try:
            signal.raise_signal(signal.SIGINT)
        except (ValueError, OSError) as exc:
            logger.warning(
                "app.exit: could not raise SIGINT for shutdown (%s); "
                "backend process may keep running after the client disconnects.",
                exc,
            )
    except Exception:
        logger.exception("app.exit: shutdown task failed unexpectedly")


def _log_shutdown_task_done(task: asyncio.Task[None]) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("app.exit: background shutdown task failed", exc_info=exc)


def create_ws_router(
    websocket_path: str,
    manager: ConnectionManager,
    command_bus: CommandBus,
    app_context: AppContext,
) -> APIRouter:
    router = APIRouter()

    @router.websocket(websocket_path)
    async def websocket_endpoint(websocket: WebSocket) -> None:
        await manager.connect(websocket)

        initial_event = {
            "type": "linuxcnc_status",
            "protocolVersion": 1,
            "event": "status.snapshot",
            "payload": app_context.gateway.get_status_snapshot(),
        }
        await manager.send_json(websocket, initial_event)

        # A pin diff only makes sense against a full snapshot, so every new client gets one
        # before the publisher starts sending plasma.pins.changed.
        if app_context.plasma is not None:
            from backend.services.plasma_publisher import snapshot_event

            await manager.send_json(websocket, snapshot_event(app_context.plasma))

        try:
            while True:
                data_text = await websocket.receive_text()
                try:
                    raw = json.loads(data_text)
                except json.JSONDecodeError:
                    await manager.send_json(
                        websocket,
                        build_error(
                            command_id="unknown",
                            code="invalid_json",
                            message="Message must be valid JSON.",
                        ).model_dump(),
                    )
                    continue

                try:
                    envelope = CommandEnvelope.model_validate(raw)
                except ValidationError as exc:
                    command_id = (
                        raw.get("commandId")
                        if (
                            isinstance(raw, dict)
                            and isinstance(raw.get("commandId"), str)
                        )
                        else "unknown"
                    )
                    await manager.send_json(
                        websocket,
                        build_error(
                            command_id=command_id,
                            code="invalid_command_envelope",
                            message=str(exc),
                        ).model_dump(),
                    )
                    continue

                result = await command_bus.dispatch(envelope, app_context)
                await manager.send_json(
                    websocket, result.ack.model_dump(exclude_none=True)
                )
                for event in result.events:
                    await manager.broadcast_json(event.model_dump())
                if (
                    envelope.category == "app"
                    and envelope.action == "exit"
                    and result.ack.ok
                ):
                    t = asyncio.create_task(_shutdown_backend_after_ack())
                    t.add_done_callback(_log_shutdown_task_done)
        except WebSocketDisconnect:
            pass
        finally:
            manager.disconnect(websocket)

    return router
