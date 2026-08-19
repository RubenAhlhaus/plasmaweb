"""REST endpoints to launch LinuxCNC HAL helper programs."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from backend.adapters.linuxcnc_gateway import LinuxCncGateway
from backend.hal_tools import (
    HAL_TOOL_CLIENT_ERROR_CODES,
    HalToolId,
    launch_hal_tool,
)


class HalToolLaunchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool: HalToolId


class HalToolLaunchResponse(BaseModel):
    ok: bool = True


def _http_status_for_error(code: str) -> int:
    if code in HAL_TOOL_CLIENT_ERROR_CODES:
        return 422
    return 503


def create_hal_tools_router(*, gateway: LinuxCncGateway) -> APIRouter:
    router = APIRouter(prefix="/api", tags=["hal-tools"])

    @router.post("/hal-tools/launch", response_model=HalToolLaunchResponse)
    async def post_hal_tool_launch(body: HalToolLaunchRequest) -> HalToolLaunchResponse:
        result = await asyncio.to_thread(
            launch_hal_tool,
            body.tool,
            resolve_ini_path=gateway.resolve_ini_path,
        )
        if not result.ok:
            raise HTTPException(
                status_code=_http_status_for_error(result.error_code or "launch_failed"),
                detail={
                    "code": result.error_code or "launch_failed",
                    "message": result.error_message or "Could not launch HAL tool.",
                },
            )
        return HalToolLaunchResponse()

    return router
