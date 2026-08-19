"""Resolve program file paths under [DISPLAY] PROGRAM_PREFIX (same rules as LinuxCncGateway)."""

from __future__ import annotations

import os

from backend.adapters.linuxcnc_gateway import LinuxCncGateway


def default_list_directory(prefixes: list[str]) -> str:
    if prefixes:
        return prefixes[0]
    return os.getcwd()


def _under_prefix(canonical_path: str, prefixes: list[str]) -> bool:
    return LinuxCncGateway._file_path_under_program_prefix(canonical_path, prefixes)


def _lexically_under_prefix(path_abs: str, prefixes: list[str]) -> bool:
    """
    True if normpath(path_abs) equals a prefix or is a direct descendant (prefix + sep + …).
    Verhindert false positives wie /foo gegen Prefix /foo2.
    """
    if not prefixes:
        return True
    pnorm = os.path.normpath(path_abs)
    for pref in prefixes:
        prefn = os.path.normpath(os.path.abspath(pref))
        if pnorm == prefn or pnorm.startswith(prefn + os.sep):
            return True
    return False


def path_allowed_under_program_prefixes(logical_path: str, prefixes: list[str]) -> bool:
    """
    Erlaubt Pfade, deren realpath außerhalb von PROGRAM_PREFIX liegt, solange der
    (nicht aufgelöste) Pfad lexikalisch unter dem Prefix liegt — z. B. Symlinks /
    Bind-Mounts unter dem NC-Programmverzeichnis.
    """
    if not prefixes:
        return True
    p = os.path.abspath(os.path.expanduser(logical_path))
    try:
        resolved = os.path.realpath(p)
    except OSError:
        resolved = p
    if _under_prefix(resolved, prefixes):
        return True
    return _lexically_under_prefix(p, prefixes)


def resolve_existing_directory(
    raw: str | None, prefixes: list[str]
) -> tuple[str | None, str | None]:
    """
    If raw is None or blank, use default_list_directory.
    Returns (resolved_realpath, error_code).

    Erlaubt Navigation in Unterordner, die per Symlink aus dem Prefix-Baum herausführen:
    Dann liegt realpath() nicht mehr unter PROGRAM_PREFIX, der vom Client übergebene Pfad
    ist aber weiterhin lexikalisch unter dem Prefix (wie von program.list geliefert).
    """
    base = (raw or "").strip()
    if not base:
        d = default_list_directory(prefixes)
    else:
        d = os.path.abspath(os.path.expanduser(base))
    try:
        d_real = os.path.realpath(d)
    except OSError:
        d_real = d
    if not os.path.isdir(d_real):
        return None, "not_a_directory"
    if prefixes and not path_allowed_under_program_prefixes(d, prefixes):
        return None, "outside_program_prefix"
    return d_real, None


def _normalize_program_path(raw: str | None) -> str | None:
    cleaned = (raw or "").strip()
    if not cleaned:
        return None
    return os.path.normpath(os.path.abspath(os.path.expanduser(cleaned)))


def _file_realpath_if_exists(path: str) -> str | None:
    try:
        p = os.path.abspath(os.path.expanduser(path))
        if os.path.isfile(p):
            return os.path.realpath(p)
        rp = os.path.realpath(p)
        if os.path.isfile(rp):
            return rp
    except OSError:
        return None
    return None


def resolve_path_for_program_read(
    editor_path: str | None,
    status_path: str | None,
) -> tuple[str | None, str | None]:
    """
    Choose the raw path for ``program.read`` before ``resolve_existing_file``.

    When both paths are set and differ:
    - same real file (symlink under PROGRAM_PREFIX) → prefer editor (logical) path
    - different files → prefer status path (LinuxCNC is source of truth)
    """
    ed = _normalize_program_path(editor_path)
    st = _normalize_program_path(status_path)

    if not ed and not st:
        return None, "invalid_params"
    if ed and not st:
        return ed, None
    if st and not ed:
        return st, None
    if ed == st:
        return ed, None

    ed_real = _file_realpath_if_exists(ed)
    st_real = _file_realpath_if_exists(st)
    if ed_real and st_real and ed_real == st_real:
        return ed, None

    return st, None


def resolve_existing_file(raw: str, prefixes: list[str]) -> tuple[str | None, str | None]:
    """Returns (absolute path suitable for open(), error_code)."""
    p = os.path.abspath(os.path.expanduser((raw or "").strip()))
    if not p:
        return None, "invalid_params"
    try:
        p_real = os.path.realpath(p)
    except OSError:
        p_real = p
    if not os.path.isfile(p_real):
        return None, "file_not_found"
    if prefixes and not path_allowed_under_program_prefixes(p, prefixes):
        return None, "outside_program_prefix"
    return p_real, None


def resolve_write_target(raw: str, prefixes: list[str]) -> tuple[str | None, str | None]:
    """
    Target path for program.write (file may not exist yet).
    Parent directory must exist. Returns (full path, error_code).
    """
    cleaned = (raw or "").strip()
    if not cleaned:
        return None, "invalid_params"
    p = os.path.abspath(os.path.expanduser(cleaned))
    parent = os.path.dirname(p)
    bn = os.path.basename(p)
    if not bn or bn in (".", ".."):
        return None, "invalid_params"
    try:
        parent_real = os.path.realpath(parent)
    except OSError:
        return None, "parent_not_found"
    if not os.path.isdir(parent_real):
        return None, "parent_not_found"
    if prefixes and not path_allowed_under_program_prefixes(parent, prefixes):
        return None, "outside_program_prefix"
    full = os.path.join(parent_real, bn)
    if os.path.isdir(full):
        return None, "is_directory"
    if prefixes and not path_allowed_under_program_prefixes(p, prefixes):
        return None, "outside_program_prefix"
    return os.path.abspath(full), None
