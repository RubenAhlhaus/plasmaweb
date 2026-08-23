"""Launcher-visible preferences (kiosk mode) shared by bin/plasmaweb and the web UI."""

from __future__ import annotations

import os
from pathlib import Path

from backend.user_preferences import UserPreferencesWriteError, migrate_user_preferences_file, resolve_launch_kiosk_mode


#: Both spellings of the environment override and of the file, new name first.
CONFIG_ENV = ("PLASMAWEB_CONFIG", "LCNCGUI_CONFIG")
CONFIG_NAMES = ("dist/plasmaweb-config.json", "dist/lcncgui-config.json")


def _config_env() -> str:
    for name in CONFIG_ENV:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def resolve_kiosk_mode(config_path: Path | None = None) -> bool:
    """User preference file overrides config; default is kiosk (True)."""
    if config_path is None:
        config_env = _config_env()
        if config_env:
            config_path = Path(config_env)
        else:
            # The new name, unless only the old one is on disk — a machine installed before
            # the rename must keep launching the way it did.
            config_path = next(
                (Path(name) for name in CONFIG_NAMES if Path(name).is_file()),
                Path(CONFIG_NAMES[0]),
            )
    try:
        migrate_user_preferences_file()
    except UserPreferencesWriteError:
        pass
    return resolve_launch_kiosk_mode(config_path)


def main() -> None:
    config_env = _config_env()
    config_path = Path(config_env) if config_env else None
    print("1" if resolve_kiosk_mode(config_path) else "0")


if __name__ == "__main__":
    main()
