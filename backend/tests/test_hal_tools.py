"""Tests for HAL helper program launch (gmoccapy settings parity)."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from backend import hal_tools


def test_hal_tool_ids_json_matches_literal() -> None:
    assert hal_tools.HAL_TOOL_IDS == (
        "classicladder",
        "halscope",
        "linuxcnctop",
        "halmeter",
        "hal_calibration",
        "halshow",
    )


def test_build_halshow_uses_tcl_script(monkeypatch, tmp_path: Path) -> None:
    tcl_dir = tmp_path / "tcl"
    bin_dir = tcl_dir / "bin"
    bin_dir.mkdir(parents=True)
    script = bin_dir / "halshow.tcl"
    script.write_text("# halshow\n", encoding="utf-8")
    monkeypatch.setenv("LINUXCNC_TCL_DIR", str(tcl_dir))
    monkeypatch.setattr(hal_tools.shutil, "which", lambda name: "/usr/bin/tclsh" if name == "tclsh" else None)

    result = hal_tools.build_hal_tool_command("halshow", resolve_ini_path=lambda: None)

    assert result.ok is True
    assert "halshow.tcl" in result.command


def test_build_hal_calibration_requires_ini(monkeypatch, tmp_path: Path) -> None:
    tcl_dir = tmp_path / "tcl"
    bin_dir = tcl_dir / "bin"
    bin_dir.mkdir(parents=True)
    (bin_dir / "emccalib.tcl").write_text("# emccalib\n", encoding="utf-8")
    monkeypatch.setenv("LINUXCNC_TCL_DIR", str(tcl_dir))
    monkeypatch.setattr(hal_tools.shutil, "which", lambda name: "/usr/bin/tclsh" if name == "tclsh" else None)

    missing_ini = hal_tools.build_hal_tool_command("hal_calibration", resolve_ini_path=lambda: None)
    assert missing_ini.ok is False
    assert missing_ini.error_code == "ini_path_unavailable"

    ini = str(tmp_path / "machine.ini")
    Path(ini).write_text("[EMC]\n", encoding="utf-8")
    with_ini = hal_tools.build_hal_tool_command("hal_calibration", resolve_ini_path=lambda: ini)
    assert with_ini.ok is True
    assert "emccalib.tcl" in with_ini.command
    assert ini in with_ini.command


def test_build_classicladder_requires_rt_component(monkeypatch) -> None:
    monkeypatch.setattr(hal_tools, "hal_component_exists", lambda name: False)
    result = hal_tools.build_hal_tool_command("classicladder", resolve_ini_path=lambda: None)
    assert result.ok is False
    assert result.error_code == "classicladder_unavailable"


def test_launch_hal_tool_requires_display_on_unix(monkeypatch) -> None:
    monkeypatch.setattr(hal_tools.os, "name", "posix")
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)

    result = hal_tools.launch_hal_tool("halmeter", resolve_ini_path=lambda: None)

    assert result.ok is False
    assert result.error_code == "display_unavailable"


def test_launch_hal_tool_starts_detached_process(monkeypatch) -> None:
    calls: list[dict[str, object]] = []

    class _Proc:
        pid = 1234

        def poll(self) -> None:
            return None

    def fake_popen(cmd, **kwargs):
        calls.append({"cmd": cmd, **kwargs})
        return _Proc()

    monkeypatch.setattr(hal_tools, "_has_display_session", lambda: True)
    monkeypatch.setattr(hal_tools, "_verify_process_started", lambda _proc: None)
    monkeypatch.setattr(hal_tools.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(hal_tools.subprocess, "Popen", fake_popen)

    result = hal_tools.launch_hal_tool("halmeter", resolve_ini_path=lambda: None)

    assert result.ok is True
    assert len(calls) == 1
    assert calls[0]["cmd"] == "/usr/bin/halmeter"
    assert calls[0]["start_new_session"] is True


def test_launch_hal_tool_reports_immediate_exit(monkeypatch) -> None:
    class _Proc:
        def poll(self) -> int:
            return 1

    monkeypatch.setattr(hal_tools, "_has_display_session", lambda: True)
    monkeypatch.setattr(hal_tools.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(hal_tools.subprocess, "Popen", lambda *a, **k: _Proc())
    monkeypatch.setattr(hal_tools, "_LAUNCH_VERIFY_DELAY_S", 0.0)

    result = hal_tools.launch_hal_tool("halmeter", resolve_ini_path=lambda: None)

    assert result.ok is False
    assert result.error_code == "launch_failed"


def test_hal_component_exists_uses_halcmd(monkeypatch) -> None:
    def fake_run(args, **kwargs):
        assert args[:4] == ["/bin/halcmd", "-s", "show", "comp"]
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(hal_tools.shutil, "which", lambda name: "/bin/halcmd" if name == "halcmd" else None)
    monkeypatch.setattr(hal_tools.subprocess, "run", fake_run)

    assert hal_tools.hal_component_exists("classicladder_rt") is True
