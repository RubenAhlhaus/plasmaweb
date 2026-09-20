"""The default HTTP bind, which decides who can reach the machine.

Pinned by a test because it is a security-relevant default that reads like a detail: the
controller is normally headless and driven from another machine, so it binds every interface,
and nothing authenticates the interface behind it. A change back to loopback breaks every
remote panel; a change here in either direction should be deliberate.
"""

from __future__ import annotations

import importlib
import subprocess
from pathlib import Path

import pytest

import backend.config

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
LAUNCHER = REPO_ROOT / "bin" / "plasmaweb"


@pytest.fixture
def config(monkeypatch: pytest.MonkeyPatch):
    def _reload(**env: str):
        for name in ("LCNCGUI_HOST", "LCNCGUI_PORT", "LCNCGUI_DISPLAY_LAUNCH"):
            monkeypatch.delenv(name, raising=False)
        for name, value in env.items():
            monkeypatch.setenv(name, value)
        return importlib.reload(backend.config)

    yield _reload
    # Leave the module as the rest of the session expects to find it.
    for name in ("LCNCGUI_HOST", "LCNCGUI_PORT", "LCNCGUI_DISPLAY_LAUNCH"):
        monkeypatch.delenv(name, raising=False)
    importlib.reload(backend.config)


def test_the_backend_binds_every_interface_by_default(config) -> None:
    assert config().HOST == "0.0.0.0"


def test_a_display_launch_does_not_quietly_fall_back_to_loopback(config) -> None:
    """The launcher sets this; it used to mean "loopback", and no longer does."""
    assert config(LCNCGUI_DISPLAY_LAUNCH="1").HOST == "0.0.0.0"


def test_the_bind_can_still_be_taken_back_to_this_machine_only(config) -> None:
    assert config(LCNCGUI_HOST="127.0.0.1").HOST == "127.0.0.1"


@pytest.mark.skipif(not LAUNCHER.exists(), reason="launcher not present in this checkout")
def test_the_launcher_agrees_with_the_backend_about_the_default_bind() -> None:
    """They must match: the launcher is what actually passes ``--host`` to uvicorn."""
    script = subprocess.run(
        ["bash", "-c", f'source <(sed -n "1,30p" {LAUNCHER!s}); echo "$HTTP_HOST|$LOCAL_HOST"'],
        capture_output=True,
        text=True,
        check=True,
    )
    http_host, local_host = script.stdout.strip().split("|")

    assert http_host == importlib.reload(backend.config).HOST == "0.0.0.0"
    # A wildcard bind is not an address a browser can open, so the launcher dials loopback.
    assert local_host == "127.0.0.1"


@pytest.mark.skipif(not LAUNCHER.exists(), reason="launcher not present in this checkout")
def test_the_launcher_never_points_the_kiosk_browser_at_the_wildcard() -> None:
    """``http://0.0.0.0:8765/`` is not a URL; every self-directed use must be LOCAL_HOST."""
    body = LAUNCHER.read_text()

    assert 'app_url="http://${LOCAL_HOST}:${HTTP_PORT}/"' in body
    assert 'http://${HTTP_HOST}:' not in body

