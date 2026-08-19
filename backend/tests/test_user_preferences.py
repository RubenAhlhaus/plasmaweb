import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.user_preferences import create_user_preferences_router
from backend.user_preferences import UserPreferencesWriteError, read_run_linuxcnc_at_startup_preference, resolve_launch_kiosk_mode


@pytest.fixture
def prefs_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "user-preferences.json"
    monkeypatch.setenv("LCNCGUI_USER_PREFERENCES", str(path))
    return path


def test_read_kiosk_mode_preference_missing_file(prefs_file: Path) -> None:
    from backend.user_preferences import read_kiosk_mode_preference

    assert read_kiosk_mode_preference() is None


def test_write_and_read_kiosk_mode_preference(prefs_file: Path) -> None:
    from backend.user_preferences import read_kiosk_mode_preference, write_kiosk_mode_preference

    write_kiosk_mode_preference(False)
    assert prefs_file.is_file()
    assert json.loads(prefs_file.read_text(encoding="utf-8")) == {"kioskMode": False}
    assert read_kiosk_mode_preference() is False

    write_kiosk_mode_preference(True)
    assert read_kiosk_mode_preference() is True


def test_read_legacy_kiosk_key(prefs_file: Path) -> None:
    from backend.user_preferences import read_kiosk_mode_preference

    prefs_file.write_text('{"kiosk": false}\n', encoding="utf-8")
    assert read_kiosk_mode_preference() is False


def test_write_migrates_legacy_kiosk_key(prefs_file: Path) -> None:
    from backend.user_preferences import write_kiosk_mode_preference

    prefs_file.write_text('{"kiosk": false, "other": 1}\n', encoding="utf-8")
    write_kiosk_mode_preference(True)
    data = json.loads(prefs_file.read_text(encoding="utf-8"))
    assert data == {"kioskMode": True, "other": 1}


def test_read_dual_kiosk_keys_does_not_write_on_get(prefs_file: Path) -> None:
    from backend.user_preferences import read_kiosk_mode_preference

    prefs_file.write_text('{"kioskMode": true, "kiosk": false}\n', encoding="utf-8")
    assert read_kiosk_mode_preference() is True
    assert json.loads(prefs_file.read_text(encoding="utf-8")) == {
        "kioskMode": True,
        "kiosk": False,
    }


def test_write_migrates_dual_kiosk_keys(prefs_file: Path) -> None:
    from backend.user_preferences import write_kiosk_mode_preference

    prefs_file.write_text('{"kioskMode": true, "kiosk": false}\n', encoding="utf-8")
    write_kiosk_mode_preference(False)
    assert json.loads(prefs_file.read_text(encoding="utf-8")) == {"kioskMode": False}


def test_migrate_user_preferences_file_legacy_only(prefs_file: Path) -> None:
    from backend.user_preferences import migrate_user_preferences_file, read_kiosk_mode_preference

    prefs_file.write_text('{"kiosk": false, "other": 1}\n', encoding="utf-8")
    assert migrate_user_preferences_file() is True
    assert json.loads(prefs_file.read_text(encoding="utf-8")) == {
        "kioskMode": False,
        "other": 1,
    }
    assert read_kiosk_mode_preference() is False


def test_migrate_user_preferences_file_noop_when_clean(prefs_file: Path) -> None:
    from backend.user_preferences import migrate_user_preferences_file

    prefs_file.write_text('{"kioskMode": true}\n', encoding="utf-8")
    assert migrate_user_preferences_file() is False



def test_resolve_launch_kiosk_mode_prefers_user_file(tmp_path: Path, prefs_file: Path) -> None:
    config = tmp_path / "lcncgui-config.json"
    config.write_text('{"ui": {"kioskMode": true}}\n', encoding="utf-8")
    prefs_file.write_text('{"kioskMode": false}\n', encoding="utf-8")

    assert resolve_launch_kiosk_mode(config) is False


def test_resolve_launch_kiosk_mode_uses_config_when_no_pref(tmp_path: Path) -> None:
    config = tmp_path / "lcncgui-config.json"
    config.write_text('{"ui": {"kioskMode": false}}\n', encoding="utf-8")

    assert resolve_launch_kiosk_mode(config) is False


def test_resolve_launch_kiosk_mode_defaults_to_kiosk(tmp_path: Path) -> None:
    config = tmp_path / "lcncgui-config.json"
    config.write_text("{}\n", encoding="utf-8")

    assert resolve_launch_kiosk_mode(config) is True


def test_write_kiosk_mode_preference_is_atomic(prefs_file: Path) -> None:
    from backend.user_preferences import write_kiosk_mode_preference

    write_kiosk_mode_preference(False)
    assert prefs_file.is_file()
    assert json.loads(prefs_file.read_text(encoding="utf-8")) == {"kioskMode": False}
    assert list(prefs_file.parent.glob(".lcncgui_prefs_*.tmp")) == []


def test_write_linuxcnc_autostart_preference(prefs_file: Path) -> None:
    from backend.user_preferences import (
        read_linuxcnc_ini_path_preference,
        read_run_linuxcnc_at_startup_preference,
        write_linuxcnc_autostart_preference,
    )

    ini_path = str(prefs_file.parent / "test.ini")
    write_linuxcnc_autostart_preference(True, ini_path)
    assert read_run_linuxcnc_at_startup_preference() is True
    assert read_linuxcnc_ini_path_preference() == ini_path

    write_linuxcnc_autostart_preference(False)
    assert read_run_linuxcnc_at_startup_preference() is False
    assert read_linuxcnc_ini_path_preference() is None


def test_read_run_linuxcnc_at_startup_defaults_false(prefs_file: Path) -> None:
    from backend.user_preferences import read_run_linuxcnc_at_startup_preference

    assert read_run_linuxcnc_at_startup_preference() is False


def test_api_get_put_user_preferences(prefs_file: Path) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway

    app = FastAPI()
    app.include_router(create_user_preferences_router(gateway=LinuxCncGateway()))
    client = TestClient(app)

    get0 = client.get("/api/user-preferences")
    assert get0.status_code == 200
    assert get0.json() == {
        "kioskMode": None,
        "runLinuxCncAtStartup": False,
        "linuxCncIniPath": None,
        "toolInSpindle": 0,
        "reloadToolOnStartup": True,
    }

    put = client.put("/api/user-preferences", json={"kioskMode": False})
    assert put.status_code == 200
    assert put.json() == {
        "kioskMode": False,
        "runLinuxCncAtStartup": False,
        "linuxCncIniPath": None,
        "toolInSpindle": 0,
        "reloadToolOnStartup": True,
    }

    get1 = client.get("/api/user-preferences")
    assert get1.status_code == 200
    assert get1.json() == {
        "kioskMode": False,
        "runLinuxCncAtStartup": False,
        "linuxCncIniPath": None,
        "toolInSpindle": 0,
        "reloadToolOnStartup": True,
    }


def test_api_rejects_unknown_fields(prefs_file: Path) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway

    app = FastAPI()
    app.include_router(create_user_preferences_router(gateway=LinuxCncGateway()))
    client = TestClient(app)

    response = client.put("/api/user-preferences", json={"kioskMode": True, "extra": 1})
    assert response.status_code == 422


def test_api_returns_503_on_write_error(prefs_file: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway

    app = FastAPI()
    app.include_router(create_user_preferences_router(gateway=LinuxCncGateway()))
    client = TestClient(app)

    def fail_write(_: bool) -> None:
        raise UserPreferencesWriteError("disk full")

    monkeypatch.setattr(
        "backend.api.user_preferences.write_kiosk_mode_preference",
        fail_write,
    )

    response = client.put("/api/user-preferences", json={"kioskMode": True})
    assert response.status_code == 503
    assert response.json()["detail"] == "disk full"


def test_api_put_linuxcnc_autostart_enable_disable(
    prefs_file: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway

    ini = tmp_path / "machine.ini"
    ini.write_text("[DISPLAY]\n", encoding="utf-8")
    config_home = tmp_path / "config"
    monkeypatch.setenv("XDG_CONFIG_HOME", str(config_home))

    gateway = LinuxCncGateway()
    monkeypatch.setattr(gateway, "resolve_ini_path", lambda: str(ini))

    app = FastAPI()
    app.include_router(create_user_preferences_router(gateway=gateway))
    client = TestClient(app)

    enable = client.put(
        "/api/user-preferences/linuxcnc-autostart",
        json={"runLinuxCncAtStartup": True},
    )
    assert enable.status_code == 200
    assert enable.json() == {
        "kioskMode": None,
        "runLinuxCncAtStartup": True,
        "linuxCncIniPath": str(ini.resolve()),
        "toolInSpindle": 0,
        "reloadToolOnStartup": True,
    }
    assert (config_home / "autostart" / "linuxcnc-lcncgui.desktop").is_file()

    disable = client.put(
        "/api/user-preferences/linuxcnc-autostart",
        json={"runLinuxCncAtStartup": False},
    )
    assert disable.status_code == 200
    assert disable.json()["runLinuxCncAtStartup"] is False
    assert disable.json()["linuxCncIniPath"] is None
    assert not (config_home / "autostart" / "linuxcnc-lcncgui.desktop").is_file()


def test_api_put_linuxcnc_autostart_requires_ini_path(prefs_file: Path) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway

    gateway = LinuxCncGateway()

    app = FastAPI()
    app.include_router(create_user_preferences_router(gateway=gateway))
    client = TestClient(app)

    response = client.put(
        "/api/user-preferences/linuxcnc-autostart",
        json={"runLinuxCncAtStartup": True},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "ini_path_unavailable"


def test_api_put_linuxcnc_autostart_env_disabled(
    prefs_file: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway

    ini = tmp_path / "machine.ini"
    ini.write_text("[DISPLAY]\n", encoding="utf-8")
    monkeypatch.setenv("LCNCGUI_AUTOSTART", "0")

    gateway = LinuxCncGateway()
    monkeypatch.setattr(gateway, "resolve_ini_path", lambda: str(ini))

    app = FastAPI()
    app.include_router(create_user_preferences_router(gateway=gateway))
    client = TestClient(app)

    response = client.put(
        "/api/user-preferences/linuxcnc-autostart",
        json={"runLinuxCncAtStartup": True},
    )
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "autostart_env_disabled"
    assert read_run_linuxcnc_at_startup_preference() is False


def test_api_put_linuxcnc_autostart_does_not_persist_when_apply_fails(
    prefs_file: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway
    from backend.linuxcnc_autostart import AutostartSetupError

    ini = tmp_path / "machine.ini"
    ini.write_text("[DISPLAY]\n", encoding="utf-8")

    gateway = LinuxCncGateway()
    monkeypatch.setattr(gateway, "resolve_ini_path", lambda: str(ini))

    def fail_apply(*_args, **_kwargs):
        raise AutostartSetupError("simulated failure")

    monkeypatch.setattr(
        "backend.api.user_preferences.apply_autostart_preference",
        fail_apply,
    )

    app = FastAPI()
    app.include_router(create_user_preferences_router(gateway=gateway))
    client = TestClient(app)

    response = client.put(
        "/api/user-preferences/linuxcnc-autostart",
        json={"runLinuxCncAtStartup": True},
    )
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "autostart_setup_failed"
    assert read_run_linuxcnc_at_startup_preference() is False


def test_write_and_read_tool_in_spindle_preference(prefs_file: Path) -> None:
    from backend.user_preferences import (
        read_tool_in_spindle_preference,
        write_tool_in_spindle_preference,
    )

    assert read_tool_in_spindle_preference() == 0
    write_tool_in_spindle_preference(5)
    assert read_tool_in_spindle_preference() == 5
    assert json.loads(prefs_file.read_text(encoding="utf-8"))["toolInSpindle"] == 5
    write_tool_in_spindle_preference(0)
    assert read_tool_in_spindle_preference() == 0


def test_reload_tool_on_startup_defaults_true(prefs_file: Path) -> None:
    from backend.user_preferences import (
        read_reload_tool_on_startup_preference,
        write_reload_tool_on_startup_preference,
    )

    assert read_reload_tool_on_startup_preference() is True
    write_reload_tool_on_startup_preference(False)
    assert read_reload_tool_on_startup_preference() is False


def test_api_put_tool_in_spindle_and_reload_toggle(prefs_file: Path) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway

    app = FastAPI()
    app.include_router(create_user_preferences_router(gateway=LinuxCncGateway()))
    client = TestClient(app)

    tool = client.put("/api/user-preferences/tool-in-spindle", json={"toolInSpindle": 3})
    assert tool.status_code == 200
    assert tool.json()["toolInSpindle"] == 3
    assert tool.json()["reloadToolOnStartup"] is True

    reload_off = client.put(
        "/api/user-preferences/reload-tool-on-startup",
        json={"reloadToolOnStartup": False},
    )
    assert reload_off.status_code == 200
    assert reload_off.json()["reloadToolOnStartup"] is False
    assert reload_off.json()["toolInSpindle"] == 3

    get1 = client.get("/api/user-preferences")
    assert get1.json()["toolInSpindle"] == 3
    assert get1.json()["reloadToolOnStartup"] is False


def test_api_put_tool_in_spindle_rejects_negative(prefs_file: Path) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway

    app = FastAPI()
    app.include_router(create_user_preferences_router(gateway=LinuxCncGateway()))
    client = TestClient(app)

    response = client.put("/api/user-preferences/tool-in-spindle", json={"toolInSpindle": -1})
    assert response.status_code == 422
