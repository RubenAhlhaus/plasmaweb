from pathlib import Path

import pytest

from backend.linuxcnc_autostart import (
    AUTOSTART_DESKTOP_FILENAME,
    AutostartEnvDisabledError,
    AutostartSetupError,
    apply_autostart_preference,
    autostart_desktop_path,
    autostart_is_installed,
    build_desktop_entry,
    install_autostart,
    remove_autostart,
    resolve_ini_path_for_autostart,
)


@pytest.fixture
def autostart_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    config_home = tmp_path / "config"
    monkeypatch.setenv("XDG_CONFIG_HOME", str(config_home))
    return config_home / "autostart"


def test_build_desktop_entry_quotes_ini_path(tmp_path: Path) -> None:
    ini = tmp_path / "my config.ini"
    ini.write_text("[DISPLAY]\n", encoding="utf-8")
    entry = build_desktop_entry(str(ini.resolve()))
    assert "Exec=linuxcnc " in entry
    assert "my config.ini" in entry
    assert entry.endswith("\n")


def test_resolve_ini_path_for_autostart_returns_absolute(tmp_path: Path) -> None:
    ini = tmp_path / "machine.ini"
    ini.write_text("[DISPLAY]\n", encoding="utf-8")
    assert resolve_ini_path_for_autostart(str(ini)) == str(ini.resolve())


def test_install_and_remove_autostart(autostart_dir: Path, tmp_path: Path) -> None:
    ini = tmp_path / "machine.ini"
    ini.write_text("[DISPLAY]\n", encoding="utf-8")

    install_autostart(str(ini))
    desktop = autostart_dir / AUTOSTART_DESKTOP_FILENAME
    assert desktop.is_file()
    assert autostart_is_installed()
    content = desktop.read_text(encoding="utf-8")
    assert "linuxcnc" in content
    assert "machine.ini" in content

    remove_autostart()
    assert not desktop.is_file()
    assert not autostart_is_installed()


def test_install_autostart_missing_ini_raises(tmp_path: Path) -> None:
    missing = tmp_path / "missing.ini"
    with pytest.raises(AutostartSetupError, match="does not exist"):
        install_autostart(str(missing))


def test_apply_autostart_preference_enable_disable(
    autostart_dir: Path,
    tmp_path: Path,
) -> None:
    ini = tmp_path / "machine.ini"
    ini.write_text("[DISPLAY]\n", encoding="utf-8")

    stored = apply_autostart_preference(True, str(ini))
    assert stored == str(ini.resolve())
    assert autostart_is_installed()

    assert apply_autostart_preference(False, None) is None
    assert not autostart_is_installed()


def test_apply_autostart_preference_requires_ini_path() -> None:
    with pytest.raises(AutostartSetupError, match="INI path is required"):
        apply_autostart_preference(True, None)


def test_install_autostart_respects_env_disable(
    autostart_dir: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ini = tmp_path / "machine.ini"
    ini.write_text("[DISPLAY]\n", encoding="utf-8")
    monkeypatch.setenv("LCNCGUI_AUTOSTART", "0")

    with pytest.raises(AutostartEnvDisabledError, match="LCNCGUI_AUTOSTART"):
        install_autostart(str(ini))
    assert not autostart_is_installed()


def test_autostart_desktop_path_uses_xdg_config_home(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "cfg"))
    assert autostart_desktop_path() == tmp_path / "cfg" / "autostart" / AUTOSTART_DESKTOP_FILENAME
