"""``/api/update``: is a newer release out, and install it when the operator agrees."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Callable, List, Optional

from fastapi import APIRouter, HTTPException
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
    #: Why the check could not be answered, e.g. no network. ``None`` when it was.
    error: Optional[str]


class UpdateInstallResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: str
    log: List[str]


def create_updates_router(
    *,
    machine_busy: Callable[[], bool],
    root: Optional[Path] = None,
    checker: Optional[UpdateChecker] = None,
    installer: Optional[UpdateInstaller] = None,
) -> APIRouter:
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
            error=None,
        )

    @router.post("/update/install", response_model=UpdateInstallResponse, status_code=202)
    async def post_update_install() -> UpdateInstallResponse:
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
        installer.start(helper)
        return UpdateInstallResponse(state=installer.state, log=list(installer.log))

    @router.get("/update/install", response_model=UpdateInstallResponse)
    async def get_update_install() -> UpdateInstallResponse:
        return UpdateInstallResponse(state=installer.state, log=list(installer.log))

    return router
