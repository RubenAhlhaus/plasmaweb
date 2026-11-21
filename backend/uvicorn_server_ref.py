"""Optional reference to the running uvicorn.Server (set from backend.main __main__)."""

from __future__ import annotations

import asyncio
import logging
import signal
from typing import Optional, Protocol

logger = logging.getLogger(__name__)


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


async def _exit_backend_after(delay_s: float) -> None:
    await asyncio.sleep(delay_s)
    if request_uvicorn_exit():
        return
    # Started as `python -m uvicorn` (bin/plasmaweb): no server ref, so stop it like Ctrl+C.
    try:
        signal.raise_signal(signal.SIGINT)
    except (ValueError, OSError) as exc:
        logger.warning("could not raise SIGINT to stop the backend (%s)", exc)


def schedule_backend_exit(delay_s: float = 0.5) -> None:
    """
    Stop the backend shortly, from inside a running event loop; the delay lets the response
    that asked for it reach the browser first.
    """
    task = asyncio.get_running_loop().create_task(_exit_backend_after(delay_s))
    _pending.add(task)
    task.add_done_callback(_pending.discard)


_pending: set[asyncio.Task[None]] = set()
