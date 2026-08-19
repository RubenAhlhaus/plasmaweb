"""Serve the built Vite frontend (``dist/``) from FastAPI when present."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from starlette.types import Scope

logger = logging.getLogger(__name__)

# HTML / config must revalidate so Chromium kiosk profiles pick up new Vite
# asset hashes after install.sh upgrades. Hashed /assets/* may be cached forever.
HTML_CACHE_CONTROL = "no-cache, no-store, must-revalidate"
ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable"


class FrontendStaticFiles(StaticFiles):
    """StaticFiles with SPA-friendly Cache-Control for Vite builds."""

    def file_response(
        self,
        full_path: os.PathLike[str] | str,
        stat_result: os.stat_result,
        scope: Scope,
        status_code: int = 200,
    ) -> Response:
        response = super().file_response(full_path, stat_result, scope, status_code)
        self._apply_frontend_cache_headers(full_path, response)
        return response

    def _apply_frontend_cache_headers(
        self,
        full_path: os.PathLike[str] | str,
        response: Response,
    ) -> None:
        path = Path(full_path)
        name = path.name

        if name == "index.html" or name.endswith(".html") or name == "lcncgui-config.json":
            response.headers["Cache-Control"] = HTML_CACHE_CONTROL
            response.headers["Pragma"] = "no-cache"
            return

        if self.directory is None:
            return

        try:
            rel = path.resolve().relative_to(Path(self.directory).resolve())
        except ValueError:
            return

        if rel.parts[:1] == ("assets",):
            response.headers["Cache-Control"] = ASSET_CACHE_CONTROL


def mount_frontend_dist(app: FastAPI, dist_dir: Path) -> bool:
    """
    Mount ``dist/`` at ``/`` when ``index.html`` exists.

    Register this **after** API/WebSocket routes so ``/ws`` keeps working.
    Returns True when the mount was added.

    Cache policy: ``index.html`` and ``lcncgui-config.json`` are never cached
    by the browser; content-hashed files under ``assets/`` are immutable.
    """
    index_html = dist_dir / "index.html"
    if not index_html.is_file():
        logger.debug(
            "Frontend not mounted: %s not found (dev: use Vite; production: npm run build)",
            index_html,
        )
        return False

    app.mount(
        "/",
        FrontendStaticFiles(directory=str(dist_dir), html=True),
        name="frontend",
    )
    logger.info("Serving frontend from %s", dist_dir)
    return True
