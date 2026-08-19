"""Persistent user preferences on disk (read by the display launcher and the web UI)."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

KIOSK_MODE_KEY = "kioskMode"
LEGACY_KIOSK_KEY = "kiosk"
RUN_LINUXCNC_AT_STARTUP_KEY = "runLinuxCncAtStartup"
LINUXCNC_INI_PATH_KEY = "linuxCncIniPath"
TOOL_IN_SPINDLE_KEY = "toolInSpindle"
RELOAD_TOOL_ON_STARTUP_KEY = "reloadToolOnStartup"

DEFAULT_USER_PREFERENCES_DIR = (
    Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "lcncgui"
)
USER_PREFERENCES_FILE = DEFAULT_USER_PREFERENCES_DIR / "user-preferences.json"


class UserPreferencesWriteError(OSError):
    """Raised when user preferences cannot be written to disk."""


def user_preferences_path() -> Path:
    override = os.environ.get("LCNCGUI_USER_PREFERENCES", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return USER_PREFERENCES_FILE


def _load_raw() -> dict[str, Any]:
    """Read preferences from disk without side effects."""
    path = user_preferences_path()
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return raw


def _normalize_kiosk_keys(raw: dict[str, Any]) -> dict[str, Any]:
    """Return a copy with legacy ``kiosk`` folded into ``kioskMode`` when needed."""
    if LEGACY_KIOSK_KEY not in raw:
        return dict(raw)

    legacy = raw.get(LEGACY_KIOSK_KEY)
    if not isinstance(legacy, bool):
        data = dict(raw)
        data.pop(LEGACY_KIOSK_KEY, None)
        return data

    data = dict(raw)
    if KIOSK_MODE_KEY not in data:
        data[KIOSK_MODE_KEY] = legacy
    data.pop(LEGACY_KIOSK_KEY, None)
    return data


def _write_raw_dict(data: dict[str, Any]) -> None:
    path = user_preferences_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps(data, indent=2) + "\n").encode("utf-8")
    tmp_path: str | None = None
    try:
        fd, tmp_path = tempfile.mkstemp(
            dir=path.parent, prefix=".lcncgui_prefs_", suffix=".tmp", text=False
        )
        try:
            os.write(fd, payload)
        finally:
            os.close(fd)
        assert tmp_path is not None
        os.replace(tmp_path, path)
        tmp_path = None
    except OSError as exc:
        if tmp_path is not None:
            try:
                if os.path.isfile(tmp_path):
                    os.unlink(tmp_path)
            except OSError:
                pass
        raise UserPreferencesWriteError(str(exc)) from exc


def _parse_kiosk_mode_value(raw: dict[str, Any]) -> bool | None:
    normalized = _normalize_kiosk_keys(raw)
    value = normalized.get(KIOSK_MODE_KEY)
    if isinstance(value, bool):
        return value
    return None


def read_kiosk_mode_preference() -> bool | None:
    """Return stored kiosk-mode preference, or ``None`` when unset or invalid."""
    return _parse_kiosk_mode_value(_load_raw())


def write_kiosk_mode_preference(kiosk_mode: bool) -> None:
    data = _normalize_kiosk_keys(_load_raw())
    data[KIOSK_MODE_KEY] = kiosk_mode
    data.pop(LEGACY_KIOSK_KEY, None)
    _write_raw_dict(data)


def read_run_linuxcnc_at_startup_preference() -> bool:
    """Return stored autostart preference (default ``False`` when unset)."""
    raw = _load_raw()
    value = raw.get(RUN_LINUXCNC_AT_STARTUP_KEY)
    if isinstance(value, bool):
        return value
    return False


def read_linuxcnc_ini_path_preference() -> str | None:
    """Return stored INI path for autostart, or ``None`` when unset."""
    raw = _load_raw()
    value = raw.get(LINUXCNC_INI_PATH_KEY)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def write_linuxcnc_autostart_preference(
    enabled: bool,
    ini_path: str | None = None,
) -> None:
    """Persist autostart toggle and optional INI path."""
    data = _normalize_kiosk_keys(_load_raw())
    data[RUN_LINUXCNC_AT_STARTUP_KEY] = enabled
    if ini_path is not None:
        data[LINUXCNC_INI_PATH_KEY] = ini_path
    elif not enabled:
        data.pop(LINUXCNC_INI_PATH_KEY, None)
    _write_raw_dict(data)


def read_tool_in_spindle_preference() -> int:
    """Return last tool-in-spindle number (default ``0`` when unset/invalid)."""
    raw = _load_raw()
    value = raw.get(TOOL_IN_SPINDLE_KEY)
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value if value >= 0 else 0
    if isinstance(value, float) and value.is_integer():
        as_int = int(value)
        return as_int if as_int >= 0 else 0
    return 0


def write_tool_in_spindle_preference(tool_in_spindle: int) -> None:
    """Persist last tool-in-spindle number (non-negative integer)."""
    if tool_in_spindle < 0:
        raise ValueError("toolInSpindle must be >= 0")
    data = _normalize_kiosk_keys(_load_raw())
    data[TOOL_IN_SPINDLE_KEY] = int(tool_in_spindle)
    _write_raw_dict(data)


def read_reload_tool_on_startup_preference() -> bool:
    """Return whether to restore the last tool after homing (default ``True``)."""
    raw = _load_raw()
    value = raw.get(RELOAD_TOOL_ON_STARTUP_KEY)
    if isinstance(value, bool):
        return value
    return True


def write_reload_tool_on_startup_preference(enabled: bool) -> None:
    """Persist reload-last-tool-after-homing toggle."""
    data = _normalize_kiosk_keys(_load_raw())
    data[RELOAD_TOOL_ON_STARTUP_KEY] = enabled
    _write_raw_dict(data)


def migrate_user_preferences_file() -> bool:
    """
    Persist normalized kiosk keys when the on-disk file still uses legacy layout.

    Returns True when the file was rewritten.
    """
    raw = _load_raw()
    if not raw:
        return False
    normalized = _normalize_kiosk_keys(raw)
    if normalized == raw:
        return False
    _write_raw_dict(normalized)
    return True


def _read_config_kiosk_mode(config_path: Path) -> bool | None:
    if not config_path.is_file():
        return None
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    ui = data.get("ui")
    if not isinstance(ui, dict):
        return None
    kiosk_mode = ui.get(KIOSK_MODE_KEY)
    if isinstance(kiosk_mode, bool):
        return kiosk_mode
    return None


def resolve_launch_kiosk_mode(config_path: str | Path) -> bool:
    """
    Resolve kiosk vs windowed launch mode for ``bin/lcncgui``.

    Priority: user preferences file → ``ui.kioskMode`` in config → default kiosk.
    """
    pref = read_kiosk_mode_preference()
    if pref is not None:
        return pref
    config_value = _read_config_kiosk_mode(Path(config_path))
    if config_value is not None:
        return config_value
    return True
