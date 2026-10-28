"""Is there a newer plasmaweb release on GitHub, and install it when the operator says so.

The check asks GitHub's public API for the latest release; prereleases are not "latest", so
a ``v0.x`` or ``-rc`` tag never prompts anybody. The install itself is ``bin/plasmaweb-update``:
it downloads and verifies the tarball and runs the new release's ``install.sh``, the same
steps an operator takes by hand, so there is one install path rather than two.

Installing rewrites the install directory under the running backend. Python has already
imported what it needs and the browser has the page it loaded, so the session carries on,
but nothing new is picked up until LinuxCNC restarts — which is what the UI tells the
operator once the install has finished.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import subprocess
import time
import urllib.request
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Deque, Literal, Optional, Tuple

logger = logging.getLogger(__name__)

GITHUB_REPO = "RubenAhlhaus/plasmaweb"
LATEST_RELEASE_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"

#: GitHub allows 60 unauthenticated API calls an hour per address, and a shop may have several
#: machines behind one. Every open browser asks on load, so the answer is shared for a while.
_CHECK_TTL_S = 6 * 60 * 60
_CHECK_TIMEOUT_S = 10.0
_RELEASE_NOTES_MAX_CHARS = 4000
_INSTALL_LOG_LINES = 200

_VERSION_RE = re.compile(r"^v?(\d+(?:\.\d+)*)$")


class UpdateCheckError(RuntimeError):
    pass


def install_root() -> Path:
    """The install directory: what the launcher exports, else the parent of ``backend/``."""
    for name in ("PLASMAWEB_ROOT", "LCNCGUI_ROOT"):
        value = os.environ.get(name, "").strip()
        if value:
            return Path(value).resolve()
    return Path(__file__).resolve().parents[1]


def installed_version(root: Path) -> Optional[str]:
    """The release this install came from, or ``None`` for a source checkout.

    ``VERSION`` is written by ``scripts/build-release.sh``; a development tree has none, and
    that is also what keeps a developer's checkout from offering to overwrite itself.
    """
    try:
        text = (root / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return text if parse_version(text) is not None else None


def source_version(root: Path) -> Optional[str]:
    """The version a source checkout's ``package.json`` declares — shown, never installed over."""
    try:
        raw = json.loads((root / "package.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    version = raw.get("version") if isinstance(raw, dict) else None
    return version if isinstance(version, str) and parse_version(version) is not None else None


def parse_version(text: str) -> Optional[Tuple[int, ...]]:
    match = _VERSION_RE.match(text.strip())
    if match is None:
        return None
    return tuple(int(part) for part in match.group(1).split("."))


def is_newer(candidate: str, current: str) -> bool:
    new, old = parse_version(candidate), parse_version(current)
    if new is None or old is None:
        return False
    width = max(len(new), len(old))
    return new + (0,) * (width - len(new)) > old + (0,) * (width - len(old))


@dataclass(frozen=True)
class ReleaseInfo:
    version: str
    url: str
    notes: str


def fetch_latest_release(timeout_s: float = _CHECK_TIMEOUT_S) -> ReleaseInfo:
    request = urllib.request.Request(
        LATEST_RELEASE_URL,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "plasmaweb-update-check"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            raw = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError) as exc:
        raise UpdateCheckError(f"Could not reach GitHub: {exc}") from exc

    tag = raw.get("tag_name") if isinstance(raw, dict) else None
    if not isinstance(tag, str) or parse_version(tag) is None:
        raise UpdateCheckError(f"Unexpected release tag: {tag!r}")
    notes = raw.get("body") if isinstance(raw.get("body"), str) else ""
    url = raw.get("html_url") if isinstance(raw.get("html_url"), str) else ""
    return ReleaseInfo(
        version=tag.lstrip("v"),
        url=url,
        notes=notes[:_RELEASE_NOTES_MAX_CHARS],
    )


class UpdateChecker:
    """The latest release, asked of GitHub at most once per TTL unless forced."""

    def __init__(self, fetch=fetch_latest_release, ttl_s: float = _CHECK_TTL_S) -> None:
        self._fetch = fetch
        self._ttl_s = ttl_s
        self._cached: Optional[ReleaseInfo] = None
        self._cached_at = 0.0
        self._lock = asyncio.Lock()

    async def latest(self, *, refresh: bool = False) -> ReleaseInfo:
        async with self._lock:
            fresh = self._cached is not None and time.monotonic() - self._cached_at < self._ttl_s
            if fresh and not refresh:
                assert self._cached is not None
                return self._cached
            release = await asyncio.to_thread(self._fetch)
            self._cached = release
            self._cached_at = time.monotonic()
            return release


def update_helper(root: Path) -> Optional[Path]:
    helper = root / "bin" / "plasmaweb-update"
    if helper.is_file() and os.access(helper, os.X_OK):
        return helper
    return None


def can_install(root: Path) -> bool:
    """Whether ``plasmaweb-update`` may write the install: directly, or via its sudoers rule."""
    helper = update_helper(root)
    if helper is None:
        return False
    try:
        result = subprocess.run(
            [str(helper), "--dry-run"], capture_output=True, timeout=5, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("Update dry-run failed: %s", exc)
        return False
    return result.returncode == 0


InstallState = Literal["idle", "running", "succeeded", "failed"]


class UpdateInstaller:
    """Runs ``plasmaweb-update`` once at a time and keeps the tail of what it printed."""

    def __init__(self) -> None:
        self.state: InstallState = "idle"
        self.log: Deque[str] = deque(maxlen=_INSTALL_LOG_LINES)
        self._task: Optional[asyncio.Task[None]] = None

    @property
    def running(self) -> bool:
        return self.state == "running"

    def start(self, helper: Path) -> None:
        if self.running:
            raise RuntimeError("An update is already being installed.")
        self.state = "running"
        self.log.clear()
        self._task = asyncio.create_task(self._run(helper))

    async def _run(self, helper: Path) -> None:
        try:
            process = await asyncio.create_subprocess_exec(
                str(helper),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                stdin=asyncio.subprocess.DEVNULL,
            )
            assert process.stdout is not None
            async for line in process.stdout:
                self.log.append(line.decode("utf-8", errors="replace").rstrip())
            code = await process.wait()
        except Exception as exc:  # the operator sees this in the dialog, not just the log
            logger.exception("Update install failed to run")
            self.log.append(f"plasmaweb-update could not run: {exc}")
            self.state = "failed"
            return
        self.state = "succeeded" if code == 0 else "failed"
        logger.info("Update install finished with exit code %s", code)
