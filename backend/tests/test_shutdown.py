import asyncio
import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from backend.launcher_prefs import resolve_kiosk_mode
from backend.shutdown import (
    _SHUTDOWN_ABORT_TIMEOUT_S,
    _set_power_off_with_retry,
    can_schedule_system_shutdown,
    mark_shutdown_requested,
    prepare_linuxcnc_for_system_shutdown,
    request_system_shutdown_after_linuxcnc_exit,
    shutdown_helper_path,
    shutdown_marker_path,
)


def test_shutdown_marker_path_under_data_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    assert shutdown_marker_path() == tmp_path / "plasmaweb" / "shutdown-requested"


def test_mark_shutdown_requested_creates_marker(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    marker = shutdown_marker_path()
    assert not marker.is_file()
    mark_shutdown_requested()
    assert marker.is_file()


def test_shutdown_helper_path_from_lcncgui_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    helper = tmp_path / "bin" / "plasmaweb-shutdown"
    helper.parent.mkdir(parents=True)
    helper.write_text("", encoding="utf-8")
    helper.chmod(0o755)
    monkeypatch.setenv("LCNCGUI_ROOT", str(tmp_path))
    assert shutdown_helper_path() == helper


def test_can_schedule_system_shutdown_uses_helper_dry_run(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    helper = tmp_path / "bin" / "plasmaweb-shutdown"
    helper.parent.mkdir(parents=True)
    helper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    helper.chmod(0o755)
    monkeypatch.setenv("LCNCGUI_ROOT", str(tmp_path))

    class _Result:
        returncode = 0

    monkeypatch.setattr("backend.shutdown.subprocess.run", lambda *a, **k: _Result())
    assert can_schedule_system_shutdown() is True


def test_can_schedule_system_shutdown_false_without_helper(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("LCNCGUI_ROOT", raising=False)
    assert can_schedule_system_shutdown() is False


def test_request_system_shutdown_after_linuxcnc_exit_writes_marker_only(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    popen_calls: list[list[str]] = []

    class _Popen:
        def __init__(self, args, **kwargs):
            popen_calls.append(list(args))

    monkeypatch.setattr("backend.shutdown.subprocess.Popen", _Popen)
    assert request_system_shutdown_after_linuxcnc_exit() is True
    assert popen_calls == []
    assert shutdown_marker_path().is_file()


def test_prepare_linuxcnc_for_system_shutdown_aborts_and_powers_off() -> None:
    gateway = MagicMock()
    gateway.abort_program.return_value = MagicMock(ok=True)
    gateway.get_status_snapshot.side_effect = [
        {"machine": {"powerOn": True, "task_state": 4}},
        {"machine": {"powerOn": False, "task_state": 3}},
        {"machine": {"powerOn": False, "task_state": 3}},
    ]

    asyncio.run(prepare_linuxcnc_for_system_shutdown(gateway))

    gateway.abort_program.assert_called_once_with(timeout_s=_SHUTDOWN_ABORT_TIMEOUT_S)
    gateway.set_power.assert_called_once_with(False)


def test_prepare_linuxcnc_for_system_shutdown_skips_when_already_off() -> None:
    gateway = MagicMock()
    gateway.get_status_snapshot.return_value = {
        "machine": {"powerOn": False, "task_state": 3},
    }

    asyncio.run(prepare_linuxcnc_for_system_shutdown(gateway))

    gateway.abort_program.assert_not_called()
    gateway.set_power.assert_not_called()


def test_set_power_off_with_retry_waits_for_command_lock() -> None:
    gateway = MagicMock()
    calls = {"n": 0}

    def _set_power(on: bool) -> bool:
        del on
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("command_in_progress")
        return False

    gateway.set_power.side_effect = _set_power

    async def _run() -> None:
        await _set_power_off_with_retry(gateway, asyncio.get_running_loop())

    asyncio.run(_run())
    assert calls["n"] == 2


def test_resolve_kiosk_mode_migrates_legacy_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prefs = tmp_path / "user-preferences.json"
    prefs.write_text('{"kiosk": false}\n', encoding="utf-8")
    config = tmp_path / "lcncgui-config.json"
    config.write_text('{"ui": {"kioskMode": true}}\n', encoding="utf-8")
    monkeypatch.setenv("LCNCGUI_USER_PREFERENCES", str(prefs))
    assert resolve_kiosk_mode(config) is False
    assert json.loads(prefs.read_text(encoding="utf-8")) == {"kioskMode": False}


def test_resolve_kiosk_mode_prefers_user_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prefs = tmp_path / "user-preferences.json"
    prefs.write_text('{"kiosk": false}\n', encoding="utf-8")
    config = tmp_path / "lcncgui-config.json"
    config.write_text('{"ui": {"kioskMode": true}}\n', encoding="utf-8")
    monkeypatch.setenv("LCNCGUI_USER_PREFERENCES", str(prefs))
    assert resolve_kiosk_mode(config) is False


def test_resolve_kiosk_mode_falls_back_to_config(tmp_path: Path) -> None:
    config = tmp_path / "lcncgui-config.json"
    config.write_text('{"ui": {"kioskMode": false}}\n', encoding="utf-8")
    assert resolve_kiosk_mode(config) is False


def test_resolve_kiosk_mode_defaults_to_kiosk(tmp_path: Path) -> None:
    assert resolve_kiosk_mode(tmp_path / "missing.json") is True
