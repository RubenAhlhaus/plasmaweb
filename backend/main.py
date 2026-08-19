import sys
from pathlib import Path

# Running `python backend/main.py` puts `backend/` on sys.path, not the repo root — imports like
# `from backend...` then fail. Ensure repo root is importable (same effect as `python -m backend.main`).
_repo_root = Path(__file__).resolve().parent.parent
_root_str = str(_repo_root)
if _root_str not in sys.path:
    sys.path.insert(0, _root_str)

from backend.ws.connection_manager import ConnectionManager
from backend.services.status_publisher import StatusPublisher
from backend.services.mdi_manual_revert import MdiManualRevertPoller
from backend.services.error_channel_publisher import ErrorChannelPublisher
from backend.services.coordinates_change_publisher import CoordinatesChangePublisher
from backend.services.toolchange_hal_publisher import ToolChangeHalPublisher
from backend.services.panel_hal_publisher import PanelHalPublisher
from backend.handlers.motion import (
    handle_motion_home,
    handle_motion_jog,
    handle_motion_jog_stop,
    handle_motion_set_active_coordinate_system,
    handle_motion_set_axis_coordinate,
    handle_motion_set_coordinate_system_offset,
    handle_motion_unhome,
)
from backend.handlers.tool import (
    handle_tool_add_tool_table_row,
    handle_tool_delete_tool_table_row,
    handle_tool_touch_off,
    handle_tool_update_tool_table_row,
)
from backend.handlers.program import (
    handle_program_auto,
    handle_program_list,
    handle_program_load_tool_table,
    handle_program_mdi,
    handle_program_open,
    handle_program_read,
    handle_program_write,
)
from backend.handlers.app import handle_app_exit
from backend.handlers.hal import handle_hal_set_jog_wheel_scale, handle_hal_softkey_pulse
from backend.handlers.machine import (
    handle_machine_abort,
    handle_machine_feed_override,
    handle_machine_rapid_override,
    handle_machine_spindle_override,
    handle_machine_flood,
    handle_machine_get_ini_config,
    handle_machine_mist,
    handle_machine_power,
    handle_machine_set_task_state,
    handle_machine_spindle,
    handle_machine_tool_change_abort,
    handle_machine_tool_change_ack,
)
from backend.config import (
    COORDINATES_PUBLISH_INTERVAL_S,
    ERROR_CHANNEL_POLL_INTERVAL_S,
    FRONTEND_DIST_DIR,
    HOST,
    MDI_MANUAL_REVERT_POLL_INTERVAL_S,
    PANEL_HAL_POLL_INTERVAL_S,
    PANEL_HAL_STATUS_SYNC_INTERVAL_S,
    PORT,
    STATUS_POLL_INTERVAL_S,
    TOOLCHANGE_HAL_POLL_INTERVAL_S,
    WEBSOCKET_PATH,
)
from backend.application.context import AppContext
from backend.application.command_bus import CommandBus
from backend.api.hal_tools import create_hal_tools_router
from backend.api.user_preferences import create_user_preferences_router
from backend.api.ws import create_ws_router
from backend.adapters.linuxcnc_gateway import LinuxCncGateway
from backend.frontend_static import mount_frontend_dist
from fastapi.staticfiles import StaticFiles
from fastapi import FastAPI
from contextlib import asynccontextmanager

# Allow running this file both as:
# - `python -m backend.main` (repo root)
# - `python main.py` (inside `backend/`)
#
# When started from `backend/`, `sys.path[0]` points to `/.../lcncgui/backend`,
# so `from backend...` would incorrectly look for `/.../lcncgui/backend/backend/...`.
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


BACKEND_PUBLIC_DIR = BACKEND_DIR / "public"

manager = ConnectionManager()
gateway = LinuxCncGateway()
command_bus = CommandBus()
app_context = AppContext(manager=manager, gateway=gateway)
status_publisher = StatusPublisher(
    manager=manager,
    gateway=gateway,
    poll_interval_s=STATUS_POLL_INTERVAL_S,
)

coordinates_change_publisher = CoordinatesChangePublisher(
    manager=manager,
    gateway=gateway,
    poll_interval_s=COORDINATES_PUBLISH_INTERVAL_S,
)

error_channel_publisher = ErrorChannelPublisher(
    manager=manager,
    gateway=gateway,
    poll_interval_s=ERROR_CHANNEL_POLL_INTERVAL_S,
)

mdi_manual_revert_poller = MdiManualRevertPoller(
    app_context=app_context,
    poll_interval_s=MDI_MANUAL_REVERT_POLL_INTERVAL_S,
)

toolchange_hal_publisher = ToolChangeHalPublisher(
    manager=manager,
    gateway=gateway,
    poll_interval_s=TOOLCHANGE_HAL_POLL_INTERVAL_S,
)

panel_hal_publisher = PanelHalPublisher(
    manager=manager,
    gateway=gateway,
    poll_interval_s=PANEL_HAL_POLL_INTERVAL_S,
    status_sync_interval_s=PANEL_HAL_STATUS_SYNC_INTERVAL_S,
)

command_bus.register("machine", "power", handle_machine_power)
command_bus.register(
    "machine",
    "set_task_state",
    handle_machine_set_task_state,
)
command_bus.register("machine", "flood", handle_machine_flood)
command_bus.register("machine", "mist", handle_machine_mist)
command_bus.register("machine", "spindle", handle_machine_spindle)
command_bus.register("machine", "feed_override", handle_machine_feed_override)
command_bus.register("machine", "rapid_override", handle_machine_rapid_override)
command_bus.register(
    "machine", "spindle_override", handle_machine_spindle_override
)
command_bus.register("machine", "get_ini_config",
                     handle_machine_get_ini_config)
command_bus.register("machine", "abort", handle_machine_abort)
command_bus.register("hal", "softkey_pulse", handle_hal_softkey_pulse)
command_bus.register("hal", "set_jog_wheel_scale", handle_hal_set_jog_wheel_scale)
command_bus.register("machine", "tool_change_ack", handle_machine_tool_change_ack)
command_bus.register(
    "machine", "tool_change_abort", handle_machine_tool_change_abort
)
command_bus.register("program", "mdi", handle_program_mdi)
command_bus.register("program", "auto", handle_program_auto)
command_bus.register("program", "open", handle_program_open)
command_bus.register("program", "list", handle_program_list)
command_bus.register("program", "read", handle_program_read)
command_bus.register("program", "write", handle_program_write)
command_bus.register("program", "load_tool_table",
                     handle_program_load_tool_table)
command_bus.register("tool", "update_tool_table_row",
                     handle_tool_update_tool_table_row)
command_bus.register("tool", "delete_tool_table_row",
                     handle_tool_delete_tool_table_row)
command_bus.register("tool", "add_tool_table_row", handle_tool_add_tool_table_row)
command_bus.register("tool", "touch_off", handle_tool_touch_off)
command_bus.register("motion", "jog", handle_motion_jog)
command_bus.register("motion", "jog_stop", handle_motion_jog_stop)
command_bus.register("motion", "home", handle_motion_home)
command_bus.register("motion", "unhome", handle_motion_unhome)
command_bus.register("motion", "set_axis_coordinate",
                     handle_motion_set_axis_coordinate)
command_bus.register(
    "motion",
    "set_active_coordinate_system",
    handle_motion_set_active_coordinate_system,
)
command_bus.register(
    "motion",
    "set_coordinate_system_offset",
    handle_motion_set_coordinate_system_offset,
)
command_bus.register("app", "exit", handle_app_exit)


@asynccontextmanager
async def lifespan(app: FastAPI):
    status_publisher.start()
    coordinates_change_publisher.start()
    error_channel_publisher.start()
    mdi_manual_revert_poller.start()
    toolchange_hal_publisher.start()
    panel_hal_publisher.start()
    yield
    await status_publisher.stop()
    await coordinates_change_publisher.stop()
    await error_channel_publisher.stop()
    await mdi_manual_revert_poller.stop()
    await toolchange_hal_publisher.stop()
    await panel_hal_publisher.stop()
    gateway.shutdown_blocking_executor()


app = FastAPI(lifespan=lifespan)
app.include_router(create_hal_tools_router(gateway=gateway))
app.include_router(create_user_preferences_router(gateway=gateway))
app.include_router(
    create_ws_router(
        websocket_path=WEBSOCKET_PATH,
        manager=manager,
        command_bus=command_bus,
        app_context=app_context,
    )
)


app.mount(
    "/static",
    StaticFiles(directory=str(BACKEND_PUBLIC_DIR)),
    name="static",
)

mount_frontend_dist(app, FRONTEND_DIST_DIR)

if __name__ == "__main__":
    import uvicorn

    from backend.uvicorn_server_ref import set_uvicorn_server

    # Explicit Server so app.exit can set should_exit; with reload=True the worker
    # subprocess may not share this ref — ws shutdown falls back to SIGINT then.
    config = uvicorn.Config("backend.main:app", host=HOST, port=PORT, reload=True)
    server = uvicorn.Server(config)
    set_uvicorn_server(server)
    server.run()
