"""Tests for user macros from ``[MACROS]`` + ``SUBROUTINE_PATH``."""

from __future__ import annotations

from pathlib import Path

from backend.user_macros_ini import list_user_subroutine_macros_from_ini


def test_list_user_macros_filters_to_macros_section(tmp_path: Path) -> None:
    macros = tmp_path / "macros"
    macros.mkdir()
    (macros / "go_home.ngc").write_text("O<go_home> sub\nO<go_home> endsub\n", encoding="utf-8")
    (macros / "toolprobe.ngc").write_text("O<toolprobe> sub\nO<toolprobe> endsub\n", encoding="utf-8")
    (macros / "orphan.ngc").write_text("O<orphan> sub\nO<orphan> endsub\n", encoding="utf-8")
    (macros / "lcncgui_drill.ngc").write_text("O<lcncgui_drill> sub\nO<lcncgui_drill> endsub\n", encoding="utf-8")

    builtin = tmp_path / "builtin"
    builtin.mkdir()
    (builtin / "lcncgui_plan_face.ngc").write_text("x", encoding="utf-8")

    ini = tmp_path / "machine.ini"
    ini.write_text(
        "[RS274NGC]\n"
        f"SUBROUTINE_PATH = macros:{builtin}\n"
        "[MACROS]\n"
        "MACRO = go_home\n"
        "MACRO = toolprobe\n",
        encoding="utf-8",
    )

    result = list_user_subroutine_macros_from_ini(str(ini))
    names = [m["name"] for m in result]
    assert names == ["go_home", "toolprobe"]
    assert "orphan" not in names
    assert result[0]["fileName"] == "go_home.ngc"
    assert Path(result[0]["path"]).name == "go_home.ngc"


def test_list_user_macros_empty_without_macros_section(tmp_path: Path) -> None:
    macros = tmp_path / "macros"
    macros.mkdir()
    (macros / "go_home.ngc").write_text("x", encoding="utf-8")
    ini = tmp_path / "machine.ini"
    ini.write_text("[RS274NGC]\nSUBROUTINE_PATH = macros\n", encoding="utf-8")
    assert list_user_subroutine_macros_from_ini(str(ini)) == []


def test_list_user_macros_empty_without_ini() -> None:
    assert list_user_subroutine_macros_from_ini(None) == []
    assert list_user_subroutine_macros_from_ini("/no/such/file.ini") == []


def test_list_user_macros_skips_missing_ngc_and_params_suffix(tmp_path: Path) -> None:
    macros = tmp_path / "macros"
    macros.mkdir()
    (macros / "go_home.ngc").write_text("x", encoding="utf-8")
    ini = tmp_path / "machine.ini"
    ini.write_text(
        "[RS274NGC]\nSUBROUTINE_PATH = macros\n"
        "[MACROS]\n"
        "MACRO = go_home\n"
        "MACRO = increment xinc yinc\n"
        "MACRO = missing_file\n",
        encoding="utf-8",
    )
    result = list_user_subroutine_macros_from_ini(str(ini))
    assert [m["name"] for m in result] == ["go_home"]


def test_list_user_macros_preserves_ini_order(tmp_path: Path) -> None:
    macros = tmp_path / "macros"
    macros.mkdir()
    (macros / "toolprobe.ngc").write_text("x", encoding="utf-8")
    (macros / "go_home.ngc").write_text("x", encoding="utf-8")
    ini = tmp_path / "machine.ini"
    ini.write_text(
        "[RS274NGC]\nSUBROUTINE_PATH = macros\n"
        "[MACROS]\n"
        "MACRO = toolprobe\n"
        "MACRO = go_home\n",
        encoding="utf-8",
    )
    assert [m["name"] for m in list_user_subroutine_macros_from_ini(str(ini))] == [
        "toolprobe",
        "go_home",
    ]


def test_get_ini_runtime_config_includes_user_macros(tmp_path, monkeypatch) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway

    macros = tmp_path / "macros"
    macros.mkdir()
    (macros / "go_home.ngc").write_text("O<go_home> sub\nO<go_home> endsub\n", encoding="utf-8")
    (macros / "orphan.ngc").write_text("x", encoding="utf-8")
    ini = tmp_path / "machine.ini"
    ini.write_text(
        "[DISPLAY]\nINCREMENTS = 1 mm\n"
        "[TRAJ]\nLINEAR_UNITS = mm\nANGULAR_UNITS = degree\n"
        "[RS274NGC]\nSUBROUTINE_PATH = macros\n"
        "[MACROS]\nMACRO = go_home\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("INI_FILE_NAME", str(ini))
    gateway = LinuxCncGateway()
    gateway._stat = None

    result = gateway.get_ini_runtime_config(force_reload=True)
    assert [m["name"] for m in result["user_macros"]] == ["go_home"]
