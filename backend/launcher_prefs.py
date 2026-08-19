"""Launcher-visible preferences (kiosk mode) shared by bin/lcncgui and the web UI."""

from __future__ import annotations

import os
from pathlib import Path

from backend.user_preferences import UserPreferencesWriteError, migrate_user_preferences_file, resolve_launch_kiosk_mode


def resolve_kiosk_mode(config_path: Path | None = None) -> bool:
    """User preference file overrides config; default is kiosk (True)."""
    if config_path is None:
        config_env = os.environ.get("LCNCGUI_CONFIG", "").strip()
        config_path = Path(config_env) if config_env else Path("dist/lcncgui-config.json")
    try:
        migrate_user_preferences_file()
    except UserPreferencesWriteError:
        pass
    return resolve_launch_kiosk_mode(config_path)


def main() -> None:
    config_env = os.environ.get("LCNCGUI_CONFIG", "").strip()
    config_path = Path(config_env) if config_env else None
    print("1" if resolve_kiosk_mode(config_path) else "0")


if __name__ == "__main__":
    main()
