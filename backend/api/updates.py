"""``/api/update``: is a newer release out, and install it when the operator agrees."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Awaitable, Callable, List, Optional

from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from backend.updates import (
    UpdateChecker,
    UpdateCheckError,
    UpdateInstaller,
    can_install,
    install_root,
    installed_version,
    is_newer,
    source_version,
    update_helper,
)


class UpdateInfoResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: The release this backend process was started from; ``None`` in a source checkout.
    runningVersion: Optional[str]
    #: The release on disk. Differs from ``runningVersion`` once an update has been installed
    #: and LinuxCNC has not been restarted yet.
    installedVersion: Optional[str]
    #: A source checkout's ``package.json`` version, shown in place of a release version.
    #: ``None`` for a release install.
    sourceVersion: Optional[str]
    latestVersion: Optional[str]
    updateAvailable: bool
    restartRequired: bool
    releaseUrl: Optional[str]
    releaseNotes: Optional[str]
    #: Whether this backend may write its install directory (directly or via its sudoers rule).
    canInstall: bool
    #: Whether LinuxCNC can be restarted from here (plasmaweb was launched as its display).
    canRestart: bool
    #: Why the check could not be answered, e.g. no network. ``None`` when it was.
    error: Optional[str]


class UpdateInstallRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Restart LinuxCNC once the install succeeds, so the new version is running straight away.
    restart: bool = False


class UpdateInstallResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: str
    log: List[str]


_MACHINE_BUSY = {
    "code": "machine_busy",
    "message": "Stop the running program before restarting LinuxCNC.",
}
_RESTART_UNAVAILABLE = {
    "code": "restart_unavailable",
    "message": (
        "LinuxCNC cannot be restarted from here: plasmaweb was not started by LinuxCNC as its "
        "display. Restart LinuxCNC by hand."
    ),
}


def require_same_origin(request: Request) -> None:
    """
    Refuse a state-changing request sent by another site's page.

    The UI is served without authentication on the LAN, so any page open in a browser on that
    network could otherwise POST here and install an update or restart LinuxCNC. Browsers send
    ``Origin`` with every cross-origin POST (and with same-origin ones), so one that names a
    different host than the request went to is refused. Requests without ``Origin`` (curl,
    scripts on the controller) are let through.
    """
    origin = request.headers.get("origin")
    if origin is None:
        return
    host = request.headers.get("host", "")
    if origin == "null" or urlsplit(origin).netloc.lower() != host.lower():
        raise HTTPException(
            status_code=403,
            detail={"code": "cross_origin", "message": "Request refused: sent from another site."},
        )


def create_updates_router(
    *,
    machine_busy: Callable[[], bool],
    root: Optional[Path] = None,
    checker: Optional[UpdateChecker] = None,
    installer: Optional[UpdateInstaller] = None,
    can_restart: Callable[[], bool] = lambda: False,
    restart: Optional[Callable[[], Awaitable[bool]]] = None,
) -> APIRouter:
    """
    ``can_restart`` / ``restart`` restart LinuxCNC (see :mod:`backend.restart`); ``restart``
    returns False when it could not. Left out, restarting is reported as unavailable.
    """
    router = APIRouter(prefix="/api", tags=["update"])
    install_dir = root if root is not None else install_root()
    running_version = installed_version(install_dir)
    checker = checker if checker is not None else UpdateChecker()
    installer = installer if installer is not None else UpdateInstaller()

    @router.get("/update", response_model=UpdateInfoResponse)
    async def get_update(refresh: bool = False) -> UpdateInfoResponse:
        on_disk = installed_version(install_dir)
        restart_required = on_disk is not None and on_disk != running_version
        checkout_version = source_version(install_dir) if running_version is None else None
        try:
            release = await checker.latest(refresh=refresh)
        except UpdateCheckError as exc:
            return UpdateInfoResponse(
                runningVersion=running_version,
                installedVersion=on_disk,
                sourceVersion=checkout_version,
                latestVersion=None,
                updateAvailable=False,
                restartRequired=restart_required,
                releaseUrl=None,
                releaseNotes=None,
                canInstall=False,
                canRestart=can_restart(),
                error=str(exc),
            )
        # A source checkout is told what the latest release is, but is updated with git, not
        # by unpacking a release over the working tree.
        available = (
            running_version is not None
            and on_disk is not None
            and is_newer(release.version, on_disk)
        )
        return UpdateInfoResponse(
            runningVersion=running_version,
            installedVersion=on_disk,
            sourceVersion=checkout_version,
            latestVersion=release.version,
            updateAvailable=available,
            restartRequired=restart_required,
            releaseUrl=release.url or None,
            releaseNotes=release.notes or None,
            canInstall=available and await asyncio.to_thread(can_install, install_dir),
            canRestart=can_restart(),
            error=None,
        )

    @router.post(
        "/update/install",
        response_model=UpdateInstallResponse,
        status_code=202,
        dependencies=[Depends(require_same_origin)],
    )
    async def post_update_install(
        request: Optional[UpdateInstallRequest] = None,
    ) -> UpdateInstallResponse:
        want_restart = request is not None and request.restart
        if running_version is None:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "source_checkout",
                    "message": "This is a source checkout; update it with git pull.",
                },
            )
        if installer.running:
            raise HTTPException(
                status_code=409,
                detail={"code": "already_running", "message": "An update is already running."},
            )
        # Rewriting the install mid-cut is not something to find out about afterwards.
        if await asyncio.to_thread(machine_busy):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "machine_busy",
                    "message": "Stop the running program before installing an update.",
                },
            )
        helper = update_helper(install_dir)
        if helper is None or not await asyncio.to_thread(can_install, install_dir):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "not_permitted",
                    "message": (
                        "This install cannot update itself. Run once as root: "
                        f"sudo {install_dir}/install.sh --setup-update"
                    ),
                },
            )
        if want_restart and (restart is None or not can_restart()):
            raise HTTPException(status_code=409, detail=_RESTART_UNAVAILABLE)

        async def restart_unless_busy() -> bool:
            # The install takes a while; a program started meanwhile is not to be cut short.
            assert restart is not None
            if await asyncio.to_thread(machine_busy):
                return False
            return await restart()

        installer.start(helper, restart_unless_busy if want_restart else None)
        return UpdateInstallResponse(state=installer.state, log=list(installer.log))

    @router.post("/update/restart", status_code=202, dependencies=[Depends(require_same_origin)])
    async def post_restart() -> dict:
        """Restart LinuxCNC now, e.g. to run an update installed earlier."""
        if restart is None or not can_restart():
            raise HTTPException(status_code=409, detail=_RESTART_UNAVAILABLE)
        if installer.running:
            raise HTTPException(
                status_code=409,
                detail={"code": "already_running", "message": "An update is being installed."},
            )
        if await asyncio.to_thread(machine_busy):
            raise HTTPException(status_code=409, detail=_MACHINE_BUSY)
        if not await restart():
            raise HTTPException(status_code=409, detail=_RESTART_UNAVAILABLE)
        return {"state": "restarting"}

    @router.get("/update/install", response_model=UpdateInstallResponse)
    async def get_update_install() -> UpdateInstallResponse:
        return UpdateInstallResponse(state=installer.state, log=list(installer.log))

    return router
