"""Optional reference to the running uvicorn.Server (set from backend.main __main__)."""

from __future__ import annotations

from typing import Optional, Protocol


class SupportsUvicornShutdown(Protocol):
    """Uvicorn :class:`uvicorn.Server` exposes ``should_exit`` for graceful stop."""

    should_exit: bool


_server: Optional[SupportsUvicornShutdown] = None


def set_uvicorn_server(server: SupportsUvicornShutdown) -> None:
    """Called when starting via backend.main to allow graceful shutdown (should_exit)."""
    global _server
    _server = server


def request_uvicorn_exit() -> bool:
    """Signal uvicorn to stop. Returns True if a server instance was configured."""
    if _server is None:
        return False
    _server.should_exit = True
    return True
