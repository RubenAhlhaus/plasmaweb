"""XDG autostart integration for launching LinuxCNC at graphical session login."""

from __future__ import annotations

import os
import shlex
import tempfile
from pathlib import Path

AUTOSTART_DESKTOP_FILENAME = "linuxcnc-plasmaweb.desktop"

#: What this file was called before the project had its own name. Removed when autostart is
#: turned off or re-applied, so a machine does not end up launching LinuxCNC twice.
LEGACY_AUTOSTART_DESKTOP_FILENAME = "linuxcnc-lcncgui.desktop"
LINUXCNC_COMMAND = "linuxcnc"


class AutostartSetupError(OSError):
    """Raised when the autostart desktop entry cannot be installed or removed."""


class AutostartEnvDisabledError(AutostartSetupError):
    """Raised when ``PLASMAWEB_AUTOSTART`` disables applying autostart."""


def _autostart_dir() -> Path:
    config_home = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return config_home / "autostart"


def autostart_desktop_path() -> Path:
    return _autostart_dir() / AUTOSTART_DESKTOP_FILENAME


def legacy_autostart_desktop_path() -> Path:
    return _autostart_dir() / LEGACY_AUTOSTART_DESKTOP_FILENAME


def is_autostart_env_disabled() -> bool:
    """Return True when ``PLASMAWEB_AUTOSTART=0`` disables applying autostart.

    The pre-rename spelling is still honoured: a machine that disabled autostart through its
    environment must stay disabled.
    """
    raw = ""
    for name in ("PLASMAWEB_AUTOSTART", "LCNCGUI_AUTOSTART"):
        raw = os.environ.get(name, "").strip().lower()
        if raw:
            break
    return raw in {"0", "false", "no", "off"}


def build_desktop_entry(ini_path: str) -> str:
    resolved = Path(ini_path).expanduser().resolve()
    exec_line = f"{LINUXCNC_COMMAND} {shlex.quote(str(resolved))}"
    lines = [
        "[Desktop Entry]",
        "Type=Application",
        "Version=1.0",
        "Name=LinuxCNC (plasmaweb)",
        "Comment=Start LinuxCNC with the configured INI at graphical session login",
        f"Exec={exec_line}",
        "Terminal=false",
        "Categories=Utility;",
        "X-GNOME-Autostart-enabled=true",
        "",
    ]
    return "\n".join(lines)


def autostart_is_installed() -> bool:
    """Either name counts: a machine set up before the rename is still set to autostart."""
    return autostart_desktop_path().is_file() or legacy_autostart_desktop_path().is_file()


def resolve_ini_path_for_autostart(ini_path: str) -> str:
    """Return an absolute, expanded INI path suitable for storage and autostart."""
    resolved = Path(ini_path).expanduser().resolve()
    if not resolved.is_file():
        raise AutostartSetupError(f"INI file does not exist: {resolved}")
    return str(resolved)


def install_autostart(ini_path: str) -> None:
    """Write the XDG autostart desktop entry for the given INI path."""
    if is_autostart_env_disabled():
        raise AutostartEnvDisabledError(
            "Autostart is disabled by PLASMAWEB_AUTOSTART environment variable"
        )

    resolved = resolve_ini_path_for_autostart(ini_path)

    desktop_path = autostart_desktop_path()
    desktop_path.parent.mkdir(parents=True, exist_ok=True)
    payload = build_desktop_entry(resolved).encode("utf-8")
    tmp_path: str | None = None
    try:
        fd, tmp_path = tempfile.mkstemp(
            dir=desktop_path.parent,
            prefix=".lcncgui_autostart_",
            suffix=".tmp",
            text=False,
        )
        try:
            os.write(fd, payload)
        finally:
            os.close(fd)
        assert tmp_path is not None
        os.replace(tmp_path, desktop_path)
        tmp_path = None
        # One entry, not two: leaving the old one behind would start LinuxCNC twice.
        _remove_legacy_autostart()
    except OSError as exc:
        if tmp_path is not None:
            try:
                if os.path.isfile(tmp_path):
                    os.unlink(tmp_path)
            except OSError:
                pass
        raise AutostartSetupError(str(exc)) from exc


def _remove_legacy_autostart() -> None:
    legacy = legacy_autostart_desktop_path()
    if legacy.is_file():
        try:
            legacy.unlink()
        except OSError:
            # Not worth failing an install over; the worst case is a stale entry.
            pass


def remove_autostart() -> None:
    """Remove the XDG autostart desktop entry when present, under either name."""
    _remove_legacy_autostart()
    desktop_path = autostart_desktop_path()
    if not desktop_path.is_file():
        return
    try:
        desktop_path.unlink()
    except OSError as exc:
        raise AutostartSetupError(str(exc)) from exc


def apply_autostart_preference(enabled: bool, ini_path: str | None) -> str | None:
    """
    Install or remove autostart according to the user preference.

    Returns the normalized absolute INI path when enabling, else ``None``.
    """
    if enabled:
        if not ini_path:
            raise AutostartSetupError("INI path is required to enable autostart")
        normalized = resolve_ini_path_for_autostart(ini_path)
        install_autostart(normalized)
        return normalized
    remove_autostart()
    return None
