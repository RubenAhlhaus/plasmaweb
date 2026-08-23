from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.adapters.linuxcnc_gateway import LinuxCncGateway
from backend.api.user_preferences import create_user_preferences_router
from backend.api.ws import create_ws_router
from backend.application.command_bus import CommandBus
from backend.application.context import AppContext
from backend.config import WEBSOCKET_PATH
from backend.frontend_static import mount_frontend_dist
from backend.ws.connection_manager import ConnectionManager

HTML_CACHE_CONTROL = "no-cache, no-store, must-revalidate"
ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable"


def test_mount_frontend_dist_serves_index(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html><body>plasmaweb</body></html>", encoding="utf-8")

    probe = FastAPI()
    assert mount_frontend_dist(probe, dist) is True

    client = TestClient(probe)
    response = client.get("/")
    assert response.status_code == 200
    assert "plasmaweb" in response.text
    assert response.headers["cache-control"] == HTML_CACHE_CONTROL
    assert response.headers.get("pragma") == "no-cache"


def test_mount_frontend_dist_noop_without_index(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    probe = FastAPI()
    assert mount_frontend_dist(probe, empty) is False


def test_hashed_assets_are_immutable_cached(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    assets = dist / "assets"
    assets.mkdir(parents=True)
    (dist / "index.html").write_text(
        '<html><script src="/assets/index-abc123.js"></script></html>',
        encoding="utf-8",
    )
    (assets / "index-abc123.js").write_text("console.log(1)", encoding="utf-8")
    (dist / "lcncgui-config.json").write_text('{"websocketUrl":"auto"}', encoding="utf-8")
    (dist / "favicon.svg").write_text("<svg/>", encoding="utf-8")

    probe = FastAPI()
    assert mount_frontend_dist(probe, dist) is True
    client = TestClient(probe)

    asset = client.get("/assets/index-abc123.js")
    assert asset.status_code == 200
    assert asset.headers["cache-control"] == ASSET_CACHE_CONTROL

    config = client.get("/lcncgui-config.json")
    assert config.status_code == 200
    assert config.headers["cache-control"] == HTML_CACHE_CONTROL

    # Non-hashed files outside assets/ must not get immutable caching.
    other = client.get("/favicon.svg")
    assert other.status_code == 200
    assert other.headers.get("cache-control") != ASSET_CACHE_CONTROL


def test_assets_segment_only_relative_to_dist_root(tmp_path: Path) -> None:
    """Install paths containing an unrelated 'assets' dir must not force immutable cache."""
    install_root = tmp_path / "assets" / "plasmaweb"
    dist = install_root / "dist"
    dist.mkdir(parents=True)
    (dist / "index.html").write_text("<html><body>ok</body></html>", encoding="utf-8")
    (dist / "favicon.svg").write_text("<svg/>", encoding="utf-8")

    probe = FastAPI()
    assert mount_frontend_dist(probe, dist) is True
    client = TestClient(probe)

    other = client.get("/favicon.svg")
    assert other.status_code == 200
    assert other.headers.get("cache-control") != ASSET_CACHE_CONTROL


def test_ws_and_static_together_like_main_app(tmp_path: Path) -> None:
    """WebSocket ``/ws`` and ``/api`` must stay reachable when ``dist/`` is mounted at ``/``."""
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html><body>ok</body></html>", encoding="utf-8")

    manager = ConnectionManager()
    gateway = LinuxCncGateway()
    command_bus = CommandBus()
    app_context = AppContext(manager=manager, gateway=gateway)

    app = FastAPI()
    app.include_router(create_user_preferences_router(gateway=gateway))
    app.include_router(
        create_ws_router(
            websocket_path=WEBSOCKET_PATH,
            manager=manager,
            command_bus=command_bus,
            app_context=app_context,
        )
    )
    mount_frontend_dist(app, dist)

    client = TestClient(app)
    assert client.get("/").status_code == 200
    assert client.get("/api/user-preferences").status_code == 200
    assert client.get("/api/user-preferences").json() == {
        "kioskMode": None,
        "runLinuxCncAtStartup": False,
        "linuxCncIniPath": None,
    }
    with client.websocket_connect("/ws") as websocket:
        initial = websocket.receive_json()
        assert initial["type"] == "linuxcnc_status"
