"""REST tests for HAL tool launch API."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.adapters.linuxcnc_gateway import LinuxCncGateway
from backend.api.hal_tools import create_hal_tools_router
from backend.hal_tools import HalToolLaunchResult


@pytest.fixture
def gateway() -> LinuxCncGateway:
    return LinuxCncGateway()


@pytest.fixture
def client(gateway: LinuxCncGateway) -> TestClient:
    app = FastAPI()
    app.include_router(create_hal_tools_router(gateway=gateway))
    return TestClient(app)


def test_api_launch_ok(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.api.hal_tools.launch_hal_tool",
        lambda tool, resolve_ini_path: HalToolLaunchResult(ok=True),
    )

    response = client.post("/api/hal-tools/launch", json={"tool": "halshow"})
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_api_launch_client_error_422(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.api.hal_tools.launch_hal_tool",
        lambda tool, resolve_ini_path: HalToolLaunchResult(
            ok=False,
            error_code="halmeter_unavailable",
            error_message="halmeter is not installed or not in PATH.",
        ),
    )

    response = client.post("/api/hal-tools/launch", json={"tool": "halmeter"})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "halmeter_unavailable"


def test_api_launch_server_error_503(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.api.hal_tools.launch_hal_tool",
        lambda tool, resolve_ini_path: HalToolLaunchResult(
            ok=False,
            error_code="launch_failed",
            error_message="Process exited immediately.",
        ),
    )

    response = client.post("/api/hal-tools/launch", json={"tool": "halscope"})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "launch_failed"


def test_api_rejects_unknown_tool(client: TestClient) -> None:
    response = client.post("/api/hal-tools/launch", json={"tool": "unknown"})
    assert response.status_code == 422


def test_api_uses_gateway_resolve_ini_path(
    client: TestClient,
    gateway: LinuxCncGateway,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    captured: dict[str, object] = {}
    ini_path = str(tmp_path / "test.ini")

    def fake_launch(tool, resolve_ini_path):
        captured["ini"] = resolve_ini_path()
        return HalToolLaunchResult(ok=True)

    monkeypatch.setattr(gateway, "resolve_ini_path", lambda: ini_path)
    monkeypatch.setattr("backend.api.hal_tools.launch_hal_tool", fake_launch)

    response = client.post("/api/hal-tools/launch", json={"tool": "halshow"})
    assert response.status_code == 200
    assert captured["ini"] == ini_path
