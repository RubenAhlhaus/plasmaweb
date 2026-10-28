"""``/api/update``: the update check and the install it guards."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.updates import create_updates_router
from backend.updates import (
    ReleaseInfo,
    UpdateChecker,
    UpdateCheckError,
    installed_version,
    is_newer,
)


@pytest.mark.parametrize(
    ("candidate", "current", "newer"),
    [
        ("1.2.0", "1.1.1", True),
        ("v1.10", "1.9.9", True),
        ("1.1", "1.1.0", False),
        ("1.1.1", "1.1.1", False),
        ("1.0.9", "1.1", False),
        ("1.2.0-rc1", "1.1", False),
    ],
)
def test_versions_compare_numerically(candidate: str, current: str, newer: bool) -> None:
    assert is_newer(candidate, current) is newer


def test_a_source_checkout_has_no_version(tmp_path: Path) -> None:
    assert installed_version(tmp_path) is None
    (tmp_path / "VERSION").write_text("1.1.1\n")
    assert installed_version(tmp_path) == "1.1.1"


class FakeInstaller:
    def __init__(self) -> None:
        self.running = False
        self.state = "idle"
        self.log: list[str] = []
        self.started_with: Path | None = None

    def start(self, helper: Path) -> None:
        self.started_with = helper
        self.state = "running"


@pytest.fixture
def install(tmp_path: Path):
    (tmp_path / "VERSION").write_text("1.1.1\n")
    helper = tmp_path / "bin" / "plasmaweb-update"
    helper.parent.mkdir()
    helper.write_text("#!/bin/sh\nexit 0\n")
    helper.chmod(0o755)
    return tmp_path


def client_for(
    root: Path,
    *,
    latest: str | Exception = "1.2.0",
    busy: bool = False,
    permitted: bool = True,
    monkeypatch: pytest.MonkeyPatch,
    installer: FakeInstaller | None = None,
) -> TestClient:
    def fetch() -> ReleaseInfo:
        if isinstance(latest, Exception):
            raise latest
        return ReleaseInfo(version=latest, url="https://example/release", notes="notes")

    monkeypatch.setattr("backend.api.updates.can_install", lambda _root: permitted)
    app = FastAPI()
    app.include_router(
        create_updates_router(
            machine_busy=lambda: busy,
            root=root,
            checker=UpdateChecker(fetch=fetch),
            installer=installer or FakeInstaller(),  # type: ignore[arg-type]
        )
    )
    return TestClient(app)


def test_a_newer_release_is_offered(install: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    body = client_for(install, monkeypatch=monkeypatch).get("/api/update").json()

    assert body["runningVersion"] == "1.1.1"
    assert body["latestVersion"] == "1.2.0"
    assert body["updateAvailable"] is True
    assert body["canInstall"] is True
    assert body["error"] is None


def test_the_same_release_is_not_offered(install: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    body = client_for(install, latest="1.1.1", monkeypatch=monkeypatch).get("/api/update").json()

    assert body["updateAvailable"] is False
    assert body["canInstall"] is False


def test_no_network_is_reported_not_raised(install: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = client_for(install, latest=UpdateCheckError("offline"), monkeypatch=monkeypatch)

    body = client.get("/api/update").json()

    assert body["updateAvailable"] is False
    assert body["error"] == "offline"


def test_a_source_checkout_shows_its_version_and_the_latest_release(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "package.json").write_text('{"name": "plasmaweb", "version": "1.1.1"}')
    client = client_for(tmp_path, monkeypatch=monkeypatch)

    body = client.get("/api/update").json()

    assert body["runningVersion"] is None
    assert body["sourceVersion"] == "1.1.1"
    assert body["latestVersion"] == "1.2.0"
    assert body["updateAvailable"] is False
    assert body["canInstall"] is False


def test_a_source_checkout_is_never_installed_over(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    installer = FakeInstaller()
    client = client_for(tmp_path, monkeypatch=monkeypatch, installer=installer)

    response = client.post("/api/update/install")

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "source_checkout"
    assert installer.started_with is None


def test_an_installed_update_asks_for_a_restart(
    install: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = client_for(install, monkeypatch=monkeypatch)
    (install / "VERSION").write_text("1.2.0\n")

    body = client.get("/api/update").json()

    assert body["runningVersion"] == "1.1.1"
    assert body["installedVersion"] == "1.2.0"
    assert body["restartRequired"] is True
    assert body["updateAvailable"] is False


def test_install_runs_the_helper(install: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    installer = FakeInstaller()
    client = client_for(install, monkeypatch=monkeypatch, installer=installer)

    response = client.post("/api/update/install")

    assert response.status_code == 202
    assert installer.started_with == install / "bin" / "plasmaweb-update"


def test_install_is_refused_while_a_program_runs(
    install: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    installer = FakeInstaller()
    client = client_for(install, busy=True, monkeypatch=monkeypatch, installer=installer)

    response = client.post("/api/update/install")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "machine_busy"
    assert installer.started_with is None


def test_install_is_refused_without_permission(
    install: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = client_for(install, permitted=False, monkeypatch=monkeypatch)

    response = client.post("/api/update/install")

    assert response.status_code == 403
    assert "--setup-update" in response.json()["detail"]["message"]
