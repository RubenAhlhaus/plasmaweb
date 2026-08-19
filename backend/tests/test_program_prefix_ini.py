"""Tests for PROGRAM_PREFIX resolution (INI-directory-relative, like LinuxCNC)."""

from pathlib import Path

from backend.program_prefix_ini import program_prefix_directories_from_ini


def test_relative_segment_resolved_against_ini_directory(tmp_path: Path) -> None:
    cfg = tmp_path / "configs"
    cfg.mkdir()
    ini = cfg / "machine.ini"
    ini.write_text("[DISPLAY]\nPROGRAM_PREFIX = nc_files\n", encoding="utf-8")
    nc = cfg / "nc_files"
    nc.mkdir()
    paths = program_prefix_directories_from_ini("nc_files", str(ini))
    assert paths == [str(nc.resolve())]


def test_absolute_segment_unchanged(tmp_path: Path) -> None:
    ini = tmp_path / "any.ini"
    ini.write_text("", encoding="utf-8")
    target = tmp_path / "abs_nc"
    target.mkdir()
    paths = program_prefix_directories_from_ini(str(target), str(ini))
    assert paths == [str(target.resolve())]


def test_colon_separated_multiple_relative(tmp_path: Path) -> None:
    cfg = tmp_path / "machine_dir"
    cfg.mkdir()
    ini = cfg / "x.ini"
    ini.write_text("", encoding="utf-8")
    p1 = cfg / "first"
    p2 = cfg / "second"
    p1.mkdir()
    p2.mkdir()
    paths = program_prefix_directories_from_ini("first:second", str(ini))
    assert paths == [str(p1.resolve()), str(p2.resolve())]


def test_empty_and_whitespace_returns_empty() -> None:
    assert program_prefix_directories_from_ini("", "/tmp/x.ini") == []
    assert program_prefix_directories_from_ini("  \t  ", "/tmp/x.ini") == []
