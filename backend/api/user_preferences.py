"""REST endpoints for launcher-visible user preferences."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.adapters.linuxcnc_gateway import LinuxCncGateway
from backend.linuxcnc_autostart import (
    AutostartEnvDisabledError,
    AutostartSetupError,
    apply_autostart_preference,
)
from backend.user_preferences import (
    UserPreferencesWriteError,
    read_kiosk_mode_preference,
    read_linuxcnc_ini_path_preference,
    read_reload_tool_on_startup_preference,
    read_run_linuxcnc_at_startup_preference,
    read_tool_in_spindle_preference,
    write_kiosk_mode_preference,
    write_linuxcnc_autostart_preference,
    write_reload_tool_on_startup_preference,
    write_tool_in_spindle_preference,
)


class UserPreferencesResponse(BaseModel):
    kioskMode: bool | None
    runLinuxCncAtStartup: bool
    linuxCncIniPath: str | None
    toolInSpindle: int
    reloadToolOnStartup: bool


class UserPreferencesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kioskMode: bool


class LinuxCncAutostartUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    runLinuxCncAtStartup: bool


class ToolInSpindleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    toolInSpindle: int = Field(ge=0)


class ReloadToolOnStartupUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reloadToolOnStartup: bool


def _preferences_response() -> UserPreferencesResponse:
    return UserPreferencesResponse(
        kioskMode=read_kiosk_mode_preference(),
        runLinuxCncAtStartup=read_run_linuxcnc_at_startup_preference(),
        linuxCncIniPath=read_linuxcnc_ini_path_preference(),
        toolInSpindle=read_tool_in_spindle_preference(),
        reloadToolOnStartup=read_reload_tool_on_startup_preference(),
    )


def create_user_preferences_router(*, gateway: LinuxCncGateway) -> APIRouter:
    router = APIRouter(prefix="/api", tags=["user-preferences"])

    @router.get("/user-preferences", response_model=UserPreferencesResponse)
    def get_user_preferences() -> UserPreferencesResponse:
        return _preferences_response()

    @router.put("/user-preferences", response_model=UserPreferencesResponse)
    def put_user_preferences(body: UserPreferencesUpdate) -> UserPreferencesResponse:
        try:
            write_kiosk_mode_preference(body.kioskMode)
        except UserPreferencesWriteError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return _preferences_response()

    @router.put(
        "/user-preferences/linuxcnc-autostart",
        response_model=UserPreferencesResponse,
    )
    def put_linuxcnc_autostart(body: LinuxCncAutostartUpdate) -> UserPreferencesResponse:
        ini_path: str | None = None
        if body.runLinuxCncAtStartup:
            ini_path = gateway.resolve_ini_path()
            if not ini_path:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "code": "ini_path_unavailable",
                        "message": "LinuxCNC INI path is not available.",
                    },
                )

        try:
            stored_ini_path = apply_autostart_preference(
                body.runLinuxCncAtStartup,
                ini_path,
            )
            write_linuxcnc_autostart_preference(
                body.runLinuxCncAtStartup,
                stored_ini_path,
            )
        except AutostartEnvDisabledError as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "autostart_env_disabled",
                    "message": str(exc),
                },
            ) from exc
        except UserPreferencesWriteError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except AutostartSetupError as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "autostart_setup_failed",
                    "message": str(exc),
                },
            ) from exc

        return _preferences_response()

    @router.put(
        "/user-preferences/tool-in-spindle",
        response_model=UserPreferencesResponse,
    )
    def put_tool_in_spindle(body: ToolInSpindleUpdate) -> UserPreferencesResponse:
        try:
            write_tool_in_spindle_preference(body.toolInSpindle)
        except UserPreferencesWriteError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return _preferences_response()

    @router.put(
        "/user-preferences/reload-tool-on-startup",
        response_model=UserPreferencesResponse,
    )
    def put_reload_tool_on_startup(body: ReloadToolOnStartupUpdate) -> UserPreferencesResponse:
        try:
            write_reload_tool_on_startup_preference(body.reloadToolOnStartup)
        except UserPreferencesWriteError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return _preferences_response()

    return router
