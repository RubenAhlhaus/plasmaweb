from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from backend import restart as restart_module


@pytest.fixture
def display_launch(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    ini = tmp_path / "Plasma.ini"
    ini.write_text("[EMC]\n")
    monkeypatch.setenv("LCNCGUI_DISPLAY_LAUNCH", "1")
    monkeypatch.setenv("INI_FILE_NAME", str(ini))
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data"))
    monkeypatch.setattr(restart_module.shutil, "which", lambda name: "/usr/bin/linuxcnc")
    return ini


def test_restart_needs_the_launcher(display_launch: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    assert restart_module.can_restart_linuxcnc() is True
    monkeypatch.delenv("LCNCGUI_DISPLAY_LAUNCH")
    assert restart_module.can_restart_linuxcnc() is False


def test_restart_needs_an_existing_ini(display_launch: Path) -> None:
    display_launch.unlink()
    assert restart_module.can_restart_linuxcnc() is False


def test_restart_turns_the_machine_off_writes_the_marker_and_stops_the_backend(
    display_launch: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []

    async def prepare(gateway: object) -> None:
        calls.append("machine off")

    monkeypatch.setattr(restart_module, "prepare_linuxcnc_for_system_shutdown", prepare)
    monkeypatch.setattr(restart_module, "schedule_backend_exit", lambda: calls.append("exit"))

    assert asyncio.run(restart_module.restart_linuxcnc(object())) is True  # type: ignore[arg-type]

    assert calls == ["machine off", "exit"]
    marker = restart_module.restart_marker_path()
    assert marker.read_text(encoding="utf-8").strip() == str(display_launch)


def test_restart_does_nothing_when_unavailable(
    display_launch: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("LCNCGUI_DISPLAY_LAUNCH")
    monkeypatch.setattr(
        restart_module, "schedule_backend_exit", lambda: pytest.fail("backend must keep running")
    )

    assert asyncio.run(restart_module.restart_linuxcnc(object())) is False  # type: ignore[arg-type]
    assert not restart_module.restart_marker_path().exists()
