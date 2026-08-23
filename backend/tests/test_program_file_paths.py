import os

import pytest

from backend.handlers.program import _program_read_sync
from backend.program_file_paths import (
    resolve_existing_directory,
    resolve_path_for_program_read,
)


def test_resolve_path_for_program_read_prefers_editor_when_only_editor() -> None:
    expected = os.path.normpath(os.path.abspath("/config/a.ngc"))
    chosen, err = resolve_path_for_program_read("/config/a.ngc", None)
    assert err is None
    assert chosen == expected


def test_resolve_path_for_program_read_prefers_status_when_only_status() -> None:
    expected = os.path.normpath(os.path.abspath("/usr/share/a.ngc"))
    chosen, err = resolve_path_for_program_read(None, "/usr/share/a.ngc")
    assert err is None
    assert chosen == expected


def test_resolve_path_for_program_read_prefers_editor_when_same_real_file(
    tmp_path,
) -> None:
    programs = tmp_path / "programs"
    programs.mkdir()
    outside = tmp_path / "vendor_nc"
    outside.mkdir()
    (outside / "part.ngc").write_text("M2\n", encoding="utf-8")
    link = programs / "vendor"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("cannot create directory symlink")

    logical = os.path.normpath(str(programs / "vendor" / "part.ngc"))
    real = os.path.normpath(str(outside / "part.ngc"))
    chosen, err = resolve_path_for_program_read(logical, real)
    assert err is None
    assert chosen == logical


def test_resolve_path_for_program_read_prefers_status_when_files_differ(tmp_path) -> None:
    programs = tmp_path / "programs"
    programs.mkdir()
    (programs / "old.ngc").write_text("old\n", encoding="utf-8")
    (programs / "new.ngc").write_text("new\n", encoding="utf-8")
    old = os.path.normpath(str(programs / "old.ngc"))
    new = os.path.normpath(str(programs / "new.ngc"))
    chosen, err = resolve_path_for_program_read(old, new)
    assert err is None
    assert chosen == new


@pytest.mark.skipif(
    os.name == "nt",
    reason="directory symlinks on Windows are optional / need privileges",
)
def test_resolve_existing_directory_allows_lexical_subpath_when_realpath_outside(
    tmp_path,
) -> None:
    """
    A symlink under PROGRAM_PREFIX pointing outside it: the realpath is outside the prefix,
    but the path the client navigates with is still lexically under it — which is the path
    ``program.list`` hands out, so clicking that entry has to work.

    The path passed in is the **symlink**, not its target: a client can only send back what it
    was given. Sending the resolved target instead is a different request, and refused below.
    """
    programs = tmp_path / "programs"
    programs.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    link = programs / "external_sub"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("cannot create directory symlink")

    prefixes = [str(programs.resolve())]
    resolved, err = resolve_existing_directory(str(link), prefixes)
    assert err is None
    assert resolved == str(outside.resolve())


@pytest.mark.skipif(
    os.name == "nt",
    reason="directory symlinks on Windows are optional / need privileges",
)
def test_resolve_existing_directory_refuses_the_target_of_that_symlink(tmp_path) -> None:
    """Allowing the link is not allowing its target.

    The permissive rule above is about *navigation*: an entry `program.list` handed out stays
    usable. It is not an invitation to name any directory the tree happens to link to — that
    would make the prefix guard mean nothing.
    """
    programs = tmp_path / "programs"
    programs.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    link = programs / "external_sub"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("cannot create directory symlink")

    prefixes = [str(programs.resolve())]

    # The resolved target, and the same directory named directly: both outside.
    assert resolve_existing_directory(str(link.resolve()), prefixes) == (
        None,
        "outside_program_prefix",
    )
    assert resolve_existing_directory(str(outside), prefixes) == (
        None,
        "outside_program_prefix",
    )


@pytest.mark.skipif(
    os.name == "nt",
    reason="directory symlinks on Windows are optional / need privileges",
)
def test_program_read_returns_logical_path_when_target_is_outside_prefix(tmp_path) -> None:
    """
    program.read darf nicht realpath in result.path liefern: sonst schlägt program.open
    mit outside_program_prefix fehl, obwohl derselbe logische Pfad in program.read erlaubt war.
    """
    programs = tmp_path / "programs"
    programs.mkdir()
    outside = tmp_path / "vendor_nc"
    outside.mkdir()
    (outside / "part.ngc").write_text("M2\n", encoding="utf-8")
    link = programs / "vendor"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("cannot create directory symlink")

    prefixes = [str(programs.resolve())]
    logical = os.path.normpath(str(programs / "vendor" / "part.ngc"))
    dr = _program_read_sync(prefixes, logical)
    assert dr.ack.ok is True
    assert dr.ack.result is not None
    assert dr.ack.result["path"] == logical
    assert dr.ack.result["content"] == "M2\n"
    real_file = str((outside / "part.ngc").resolve())
    assert logical != real_file


def test_program_read_sync_uses_status_when_editor_path_is_stale(tmp_path) -> None:
    programs = tmp_path / "programs"
    programs.mkdir()
    (programs / "old.ngc").write_text("old\n", encoding="utf-8")
    (programs / "new.ngc").write_text("new\n", encoding="utf-8")
    prefixes = [str(programs.resolve())]
    old = os.path.normpath(str(programs / "old.ngc"))
    new = os.path.normpath(str(programs / "new.ngc"))
    dr = _program_read_sync(prefixes, old, new)
    assert dr.ack.ok is True
    assert dr.ack.result is not None
    assert dr.ack.result["path"] == new
    assert dr.ack.result["content"] == "new\n"
