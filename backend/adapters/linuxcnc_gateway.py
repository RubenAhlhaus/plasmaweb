import threading
import os
import re
import subprocess
import shutil
import configparser
import tempfile
from concurrent.futures import ThreadPoolExecutor
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Any, Callable, Dict, MutableMapping, Optional, Tuple

try:
    import linuxcnc  # type: ignore
except ImportError:
    linuxcnc = None

try:
    from backend.coordinate_systems import (
        SYSTEM_ID_TO_P,
        display_totals_to_g5x_offsets,
        ensure_stored_offsets_hydrated_from_ini,
        get_active_coordinate_system_offsets,
        get_active_system_id,
        list_coordinate_systems,
        mdi_line_for_active_coordinate_system,
    )
except ImportError:
    SYSTEM_ID_TO_P = None
    display_totals_to_g5x_offsets = None
    ensure_stored_offsets_hydrated_from_ini = None
    get_active_coordinate_system_offsets = None
    get_active_system_id = None
    list_coordinate_systems = None
    mdi_line_for_active_coordinate_system = None

from backend.coordinate_system_ids import normalize_coordinate_system_id
from backend.program_prefix_ini import program_prefix_directories_from_ini
from backend.user_macros_ini import list_user_subroutine_macros_from_ini
from backend.services.tool_sidecar import (
    MISSING,
    load_tool_sidecar,
    pop_lcncgui_params,
    remove_tool_from_sidecar,
    rename_tool_keys_in_tools_mut,
    save_tool_sidecar_atomic,
    short_table_comment_from_meta,
    sidecar_entry_substantive,
    sidecar_meta_name,
    upsert_tool_entry_in_tools_mut,
    upsert_tool_in_sidecar,
)


# Default S when interpreter has S0 (matches gmoccapy "spindle_start_rpm" fallback idea).
_DEFAULT_SPINDLE_SPEED_RPM = 1000.0
_MAX_SPINDLE_COMMAND_RPM = 1e9

# `command.wait_complete()` after home/unhome — homing can take a long time; unhome is usually fast.
_HOME_WAIT_TIMEOUT_S = 3600.0
_UNHOME_WAIT_TIMEOUT_S = 120.0
_PROGRAM_OPEN_WAIT_TIMEOUT_S = 120.0
_LOAD_TOOL_TABLE_WAIT_TIMEOUT_S = 60.0
_ABORT_WAIT_TIMEOUT_S = 30.0
_TOOL_TOUCH_OFF_MDI_WAIT_TIMEOUT_S = 120.0
_TOOLCHANGE_SHELL_TIMEOUT_S = 15.0
_COORD_AXES = ("x", "y", "z", "a", "b", "c", "u", "v", "w")


def _stat_gcode_labels(s: Any) -> list[str]:
    """
    Format ``stat.gcodes`` like gmoccapy ``_update_active_gcodes`` (for G41/G42/G43 checks).
    """
    gc = getattr(s, "gcodes", None) or ()
    labels: list[str] = []
    try:
        seq = list(gc[1:]) if len(gc) > 1 else []
    except (TypeError, IndexError):
        seq = []
    for code in sorted(seq):
        try:
            c = int(code)
        except (TypeError, ValueError):
            continue
        if c == -1:
            continue
        if c % 10 == 0:
            labels.append(f"G{c // 10}")
        else:
            labels.append(f"G{c // 10}.{c % 10}")
    return labels


def _tool_touch_off_gcode_flags(s: Any) -> tuple[bool, bool]:
    """
    Returns ``(cutter_comp_active, g43_refresh_desired)`` for gmoccapy-style tool touch-off.
    Cutter comp blocks touch-off; G43 (any form) means we should re-issue ``G43`` after ``G10 L10``.
    """
    labels = _stat_gcode_labels(s)
    cutter = any(
        x in ("G41", "G42") or x.startswith("G41.") or x.startswith("G42.")
        for x in labels
    )
    g43_on = any(x == "G43" or x.startswith("G43.") for x in labels)
    return cutter, g43_on
_DEFAULT_JOG_INCREMENTS_SPEC = "1 mm, 0.5 mm, 0.1 in, 1/16 in"
_INI_ENV_KEYS = ("INI_FILE_NAME", "LINUXCNC_INI", "INI_FILE")


def _coerce_json_scalar(val: Any) -> Any:
    """Make linuxcnc stat values JSON-safe (ctypes/numpy-ish → plain Python)."""
    if val is None or isinstance(val, bool):
        return val
    if isinstance(val, float):
        return float(val)
    if isinstance(val, int):
        return int(val)
    if isinstance(val, str):
        return val
    if hasattr(val, "item"):
        try:
            return _coerce_json_scalar(val.item())
        except (AttributeError, TypeError, ValueError, RuntimeError):
            pass
    try:
        return float(val)
    except (TypeError, ValueError):
        return val


def _boolish_to_int(val: Any) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return 0


def _optional_stat_int(s: Any, attr: str) -> int | None:
    """linuxcnc.stat line counters etc. → JSON-safe int or None."""
    v = getattr(s, attr, None)
    if v is None:
        return None
    coerced = _coerce_json_scalar(v)
    if isinstance(coerced, bool):
        return None
    try:
        return int(coerced)
    except (TypeError, ValueError, OverflowError):
        return None


def _display_lathe_truthy(val: Any) -> bool:
    """Parse [DISPLAY] LATHE like common LinuxCNC GUIs (1, TRUE, 0, …)."""
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val != 0
    s = str(val).strip().lower()
    if s in ("", "0", "false", "no", "off", "n"):
        return False
    if s in ("1", "true", "yes", "on", "y"):
        return True
    try:
        return float(s) != 0.0
    except ValueError:
        return False


#: ``#INCLUDE`` nesting limit — guards against an include cycle.
_INI_INCLUDE_MAX_DEPTH = 8


def _scan_ini_options(
    ini_path: str,
    wanted: Mapping[str, Collection[str]],
    *,
    _depth: int = 0,
) -> Dict[str, Dict[str, list[str]]]:
    """
    Read selected INI options without ConfigParser and without the ``linuxcnc`` module.

    Needed because ConfigParser rejects the duplicate keys LinuxCNC INIs use (multiple
    ``HALFILE``, ``POSTGUI_HALFILE``, ``PROGRAM_EXTENSION``), and because some builds return
    empty from ``linuxcnc.ini().find`` for a few keys.

    Follows ``#INCLUDE`` (LinuxCNC's own include directive), which QtPlasmaC configs rely on
    to keep ``[KINS]``, ``[TRAJ]`` and ``[JOINT_n]`` in a shared ``*_ini.inc`` file — a flat
    line scan of the top-level INI finds none of them.

    Section and option names are matched case-insensitively; values keep their order, so
    duplicate keys are preserved.
    """
    found: Dict[str, Dict[str, list[str]]] = {
        section: {option: [] for option in options} for section, options in wanted.items()
    }
    if _depth > _INI_INCLUDE_MAX_DEPTH:
        return found

    wanted_upper = {
        section.upper(): {option.upper(): option for option in options}
        for section, options in wanted.items()
    }
    section_by_upper = {section.upper(): section for section in wanted}

    try:
        with open(ini_path, encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except OSError:
        return found

    ini_dir = os.path.dirname(os.path.abspath(ini_path))
    current: Optional[str] = None
    for line in lines:
        stripped = line.strip()
        if stripped.upper().startswith("#INCLUDE"):
            include_name = stripped[len("#INCLUDE"):].strip().strip('"').strip("'")
            if not include_name:
                continue
            include_path = (
                include_name
                if os.path.isabs(include_name)
                else os.path.join(ini_dir, include_name)
            )
            for section, options in _scan_ini_options(
                include_path, wanted, _depth=_depth + 1
            ).items():
                for option, values in options.items():
                    found[section][option].extend(values)
            continue

        main = stripped.split(";", 1)[0].strip()
        if not main:
            continue
        if main.startswith("[") and main.endswith("]"):
            current = main[1:-1].strip().upper()
            continue
        if current is None or current not in wanted_upper or "=" not in main:
            continue
        key, val = main.split("=", 1)
        option = wanted_upper[current].get(key.strip().upper())
        if option is None:
            continue
        value = val.strip().strip('"').strip("'")
        if value:
            found[section_by_upper[current]][option].append(value)

    return found


def _first_ini_option(
    scanned: Mapping[str, Mapping[str, list[str]]], section: str, option: str
) -> Optional[str]:
    values = scanned.get(section, {}).get(option, [])
    return values[0] if values else None


def _read_traj_coordinates_line_scan(ini_path: str) -> Optional[str]:
    """Read ``[TRAJ] COORDINATES``, following ``#INCLUDE``. See :func:`_scan_ini_options`."""
    scanned = _scan_ini_options(ini_path, {"TRAJ": {"COORDINATES"}})
    return _first_ini_option(scanned, "TRAJ", "COORDINATES")


def _read_joint_home_sequences(ini_path: str, max_joints: int = 16) -> list[str]:
    """
    ``[JOINT_n] HOME_SEQUENCE`` for joints 0..n, ordered by joint index.

    Stops at the first joint section that declares no HOME_SEQUENCE, so the list length is
    the joint count as far as homing is concerned. A negative value means the joint homes as
    part of a synchronised set (LinuxCNC homing docs).
    """
    sections = {f"JOINT_{n}": {"HOME_SEQUENCE"} for n in range(max_joints)}
    scanned = _scan_ini_options(ini_path, sections)
    sequences: list[str] = []
    for n in range(max_joints):
        value = _first_ini_option(scanned, f"JOINT_{n}", "HOME_SEQUENCE")
        if value is None:
            break
        sequences.append(value)
    return sequences


def _serialize_spindle_list(stat: Any) -> list[Dict[str, Any]]:
    """
    LinuxCNC liefert `stat.spindle` als Tuple von Dicts (siehe Python-Interface-Doku).
    Explizit kopieren, damit `json.dumps` keine ctypes-/Randtypen übergibt.
    `collections.abc.Mapping` deckt `dict` und andere Mapping-ähnliche Einträge ab.
    """
    raw = getattr(stat, "spindle", ()) or ()
    out: list[Dict[str, Any]] = []
    attr_keys = (
        "brake",
        "direction",
        "enabled",
        "homed",
        "increasing",
        "orient_fault",
        "orient_state",
        "override",
        "override_enabled",
        "speed",
    )
    for sp in raw:
        if isinstance(sp, Mapping):
            out.append({str(k): _coerce_json_scalar(v) for k, v in sp.items()})
            continue
        row: Dict[str, Any] = {}
        for k in attr_keys:
            if hasattr(sp, k):
                row[k] = _coerce_json_scalar(getattr(sp, k))
        out.append(row)
    return out


_TOOL_TABLE_ATTRS = (
    "toolno",
    "id",
    "pocket",
    # linuxcnc.stat.tool_table / toolinfo() use this name in several versions
    "pocketno",
    "diameter",
    "xoffset",
    "yoffset",
    "zoffset",
    "aoffset",
    "boffset",
    "coffset",
    "uoffset",
    "voffset",
    "woffset",
    "frontangle",
    "backangle",
    "orientation",
    "comment",
)

# linuxcnc.org/docs/.../python-interface.html — tool_table entries as sequences:
# id, offsets (9), diameter, frontangle, backangle, orientation (no pocket in row).
_TOOL_TABLE_SEQUENCE_FIELDS = (
    "id",
    "xoffset",
    "yoffset",
    "zoffset",
    "aoffset",
    "boffset",
    "coffset",
    "uoffset",
    "voffset",
    "woffset",
    "diameter",
    "frontangle",
    "backangle",
    "orientation",
)

# Mill-style lines: T<tool> P<pocket> … ; comment (see LinuxCNC tool table format docs).
_RE_TOOL_TABLE_TP_LINE_START = re.compile(r"^\s*T\s*(\d+)\s+P\s*(\d+)\b", re.I)

# plasmaweb stores JSON after this marker in the `;` comment suffix (see docs/features/05_TOOL_TABLE.md).
# LinuxCNC's stat.tool_table comment often contains only the text *before* the first `|`, so we must
# merge from the on-disk line when the file still has the full `|LCNCGUI|` payload.
_LCNC_GUI_COMMENT_DELIM = "|LCNCGUI|"

# Web/API field names → single-letter codes in the on-disk tool table (lathe: I/J/Q per LinuxCNC convention).
_TOOL_PARAM_TO_FILE_LETTER: Dict[str, str] = {
    "xoffset": "X",
    "yoffset": "Y",
    "zoffset": "Z",
    "aoffset": "A",
    "boffset": "B",
    "coffset": "C",
    "uoffset": "U",
    "voffset": "V",
    "woffset": "W",
    "diameter": "D",
    "frontangle": "I",
    "backangle": "J",
    "orientation": "Q",
}

# When new numeric tokens appear from the API but were absent on disk, append in this order.
_CANONICAL_TOOL_FILE_LETTER_ORDER = tuple(_TOOL_PARAM_TO_FILE_LETTER[k] for k in (
    "xoffset",
    "yoffset",
    "zoffset",
    "aoffset",
    "boffset",
    "coffset",
    "uoffset",
    "voffset",
    "woffset",
    "diameter",
    "frontangle",
    "backangle",
    "orientation",
))

_RE_TOOL_TABLE_DATA_TOKEN = re.compile(r"([A-Za-z])([+-]?\d+(?:\.\d*)?)")


def _tool_table_line_body_and_newline(line: str) -> tuple[str, str]:
    if line.endswith("\r\n"):
        return line[:-2], "\r\n"
    if line.endswith("\n"):
        return line[:-1], "\n"
    return line, ""


def _find_last_tool_table_line_index_for_toolno(lines: list[str], toolno: int) -> Optional[int]:
    """Index of the last non-comment line matching ``T<toolno> P<int>`` (same rule as :func:`_parse_tool_table_maps`)."""
    last: Optional[int] = None
    for i, raw in enumerate(lines):
        body, _ = _tool_table_line_body_and_newline(raw)
        s = body.strip()
        if not s or s.startswith(";"):
            continue
        m = _RE_TOOL_TABLE_TP_LINE_START.match(s)
        if not m:
            continue
        try:
            t = int(m.group(1))
        except ValueError:
            continue
        if t == toolno:
            last = i
    return last


def _tool_table_line_exists_for_toolno(lines: list[str], toolno: int) -> bool:
    """True if at least one non-comment line matches ``T<toolno> P<int>`` (gleiche Regel wie „letzte Zeile gewinnt“)."""
    return _find_last_tool_table_line_index_for_toolno(lines, toolno) is not None


def _parse_tool_table_data_tokens(data_part: str) -> tuple[list[str], dict[str, float]]:
    ordered: list[str] = []
    values: dict[str, float] = {}
    for m in _RE_TOOL_TABLE_DATA_TOKEN.finditer(data_part.strip()):
        letter = m.group(1).upper()
        try:
            val = float(m.group(2))
        except ValueError:
            continue
        if letter not in values:
            ordered.append(letter)
        values[letter] = val
    return ordered, values


def _format_tool_table_file_token(letter: str, value: float) -> str:
    return f"{letter}{value:+.6f}"


def _rewrite_tool_table_line_content(
    body: str,
    toolno: int,
    params: Mapping[str, Any],
    *,
    output_toolno: Optional[int] = None,
) -> Optional[str]:
    """
    Build a new logical line (no trailing newline) for ``T{output}`` from an existing table row
    body and partial API ``params`` (merge: only keys present in ``params`` override disk tokens).

    ``toolno`` selects the row to parse (must match the line's T number). ``output_toolno`` sets
    the T number in the output; defaults to ``toolno`` when omitted (no rename).
    """
    existing_comment_tail: Optional[str] = None
    if ";" in body:
        main_raw, tail_raw = body.split(";", 1)
        existing_comment_tail = tail_raw.strip()
        main = main_raw.strip()
    else:
        main = body.strip()

    m = _RE_TOOL_TABLE_TP_LINE_START.match(main)
    if not m:
        return None
    try:
        row_t = int(m.group(1))
        row_p = int(m.group(2))
    except ValueError:
        return None
    if row_t != toolno:
        return None

    pocket = int(params["pocket"]) if "pocket" in params else row_p
    data_part = main[m.end() :].strip()
    order, vals = _parse_tool_table_data_tokens(data_part)
    merged: dict[str, float] = dict(vals)
    for api_key, letter in _TOOL_PARAM_TO_FILE_LETTER.items():
        if api_key in params:
            merged[letter] = float(params[api_key])  # type: ignore[arg-type]

    out_order: list[str] = []
    seen: set[str] = set()
    for letter in order:
        if letter in merged:
            out_order.append(letter)
            seen.add(letter)
    for letter in _CANONICAL_TOOL_FILE_LETTER_ORDER:
        if letter in merged and letter not in seen:
            out_order.append(letter)
            seen.add(letter)
    for letter in sorted(merged.keys()):
        if letter not in seen:
            out_order.append(letter)
            seen.add(letter)

    out_t = int(output_toolno) if output_toolno is not None else toolno

    token_str = " ".join(_format_tool_table_file_token(L, merged[L]) for L in out_order)
    if token_str:
        new_main = f"T{out_t} P{pocket} {token_str}"
    else:
        new_main = f"T{out_t} P{pocket}"

    if "comment" in params:
        c_raw = params["comment"]
        c = "" if c_raw is None else str(c_raw)
        return f"{new_main} ; {c}"
    if existing_comment_tail is not None:
        return f"{new_main} ; {existing_comment_tail}"
    return new_main


def _atomic_write_text_file(path: str, content: str) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    if not directory:
        directory = "."
    fd, tmp_path = tempfile.mkstemp(prefix=".plasmaweb-tooltbl-", dir=directory, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as tmp:
            tmp.write(content)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _apply_tool_table_row_update_to_disk(
    path: str,
    toolno: int,
    params: Mapping[str, Any],
    *,
    new_toolno: Optional[int] = None,
) -> Optional[tuple[str, str]]:
    """Return ``(error_code, error_message)`` on failure, ``None`` on success."""
    if not os.path.isfile(path):
        return ("file_not_found", f"Tool table file not found: {path}")
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError as exc:
        return ("handler_failed", str(exc))

    lines = text.splitlines(keepends=True)
    if new_toolno is not None and int(new_toolno) != int(toolno):
        if _tool_table_line_exists_for_toolno(lines, int(new_toolno)):
            return (
                "tool_already_exists",
                f"Tool table already has a line for T{int(new_toolno)} in {path}.",
            )

    idx = _find_last_tool_table_line_index_for_toolno(lines, toolno)
    if idx is None:
        return (
            "tool_line_not_found",
            f"No T… P… line for tool number {toolno} in {path}.",
        )

    body, nl = _tool_table_line_body_and_newline(lines[idx])
    out_t: Optional[int] = (
        int(new_toolno) if new_toolno is not None and int(new_toolno) != int(toolno) else None
    )
    new_body = _rewrite_tool_table_line_content(body, toolno, params, output_toolno=out_t)
    if new_body is None:
        return (
            "tool_line_not_found",
            f"Cannot parse or rewrite tool table line for T{toolno} in {path}.",
        )
    lines[idx] = new_body + nl
    new_text = "".join(lines)
    try:
        _atomic_write_text_file(path, new_text)
    except OSError as exc:
        return ("handler_failed", str(exc))
    return None


def _apply_tool_table_row_delete_from_disk(
    path: str, toolno: int
) -> Optional[tuple[str, str]]:
    """Remove the **last** ``T… P…`` line for ``toolno`` (same duplicate rule as update)."""
    if not os.path.isfile(path):
        return ("file_not_found", f"Tool table file not found: {path}")
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError as exc:
        return ("handler_failed", str(exc))

    lines = text.splitlines(keepends=True)
    idx = _find_last_tool_table_line_index_for_toolno(lines, toolno)
    if idx is None:
        return (
            "tool_line_not_found",
            f"No T… P… line for tool number {toolno} in {path}.",
        )

    del lines[idx]
    new_text = "".join(lines)
    try:
        _atomic_write_text_file(path, new_text)
    except OSError as exc:
        return ("handler_failed", str(exc))
    return None


def _format_new_tool_table_line(toolno: int, params: Mapping[str, Any]) -> str:
    """
    Build a new ``T… P…`` line from API params (no existing disk row).
    Pocket defaults to ``toolno`` when omitted.
    """
    pocket = int(params["pocket"]) if "pocket" in params else toolno
    merged: dict[str, float] = {}
    for api_key, letter in _TOOL_PARAM_TO_FILE_LETTER.items():
        if api_key in params:
            merged[letter] = float(params[api_key])  # type: ignore[arg-type]

    out_order: list[str] = []
    seen: set[str] = set()
    for letter in _CANONICAL_TOOL_FILE_LETTER_ORDER:
        if letter in merged:
            out_order.append(letter)
            seen.add(letter)
    for letter in sorted(merged.keys()):
        if letter not in seen:
            out_order.append(letter)
            seen.add(letter)

    token_str = " ".join(_format_tool_table_file_token(L, merged[L]) for L in out_order)
    if token_str:
        new_main = f"T{toolno} P{pocket} {token_str}"
    else:
        new_main = f"T{toolno} P{pocket}"

    if "comment" in params:
        c_raw = params["comment"]
        c = "" if c_raw is None else str(c_raw)
        if c.strip():
            return f"{new_main} ; {c.strip()}"
    return new_main


def _apply_tool_table_row_append_to_disk(
    path: str, toolno: int, params: Mapping[str, Any]
) -> Optional[tuple[str, str]]:
    """Append a new row if no ``T<toolno>`` line exists yet; otherwise ``tool_already_exists``."""
    if not os.path.isfile(path):
        return ("file_not_found", f"Tool table file not found: {path}")
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError as exc:
        return ("handler_failed", str(exc))

    lines = text.splitlines(keepends=True)
    if _tool_table_line_exists_for_toolno(lines, toolno):
        return (
            "tool_already_exists",
            f"Tool table already has a line for T{toolno} in {path}.",
        )

    new_body = _format_new_tool_table_line(toolno, params)
    nl = "\n"
    if lines:
        last = lines[-1]
        if last.endswith("\r\n"):
            nl = "\r\n"
        elif last.endswith("\r"):
            nl = "\r"
    new_line = new_body + nl
    new_text = "".join(lines)
    if new_text and not new_text.endswith(("\n", "\r")):
        new_text += nl
    new_text += new_line
    try:
        _atomic_write_text_file(path, new_text)
    except OSError as exc:
        return ("handler_failed", str(exc))
    return None


def _parse_tool_table_maps(path: str) -> tuple[dict[int, int], dict[int, str]]:
    """
    From the on-disk tool table: tool number -> pocket, and tool number -> comment
    text after `;` (includes plasmaweb `|LCNCGUI|` JSON). stat.tool_table often omits
    comment entirely (14-tuple API). Later lines with the same T win.
    """
    pockets: dict[int, int] = {}
    comments: dict[int, str] = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith(";"):
                    continue
                m = _RE_TOOL_TABLE_TP_LINE_START.match(line)
                if not m:
                    continue
                try:
                    tno = int(m.group(1))
                    pocket = int(m.group(2))
                except ValueError:
                    continue
                if tno <= 0:
                    continue
                pockets[tno] = pocket
                if ";" in line:
                    _before, tail = line.split(";", 1)
                    c = tail.strip()
                    if c:
                        comments[tno] = c
    except OSError:
        return {}, {}
    return pockets, comments


def _parse_tool_table_pocket_by_toolno(path: str) -> dict[int, int]:
    """Backward-compatible wrapper; prefer :func:`_parse_tool_table_maps` internally."""
    p, _ = _parse_tool_table_maps(path)
    return p


def _resolve_tool_table_path_from_ini(ini_path: str) -> Optional[str]:
    """Absolute path to [EMCIO] TOOL_TABLE, like gmoccapy CONFIG_DIR + TOOL_TABLE."""
    if linuxcnc is None:
        return None
    try:
        inf = linuxcnc.ini(ini_path)
        rel = inf.find("EMCIO", "TOOL_TABLE")
    except Exception:
        return None
    if rel is None:
        return None
    rel_s = str(rel).strip().strip('"').strip("'")
    if not rel_s:
        return None
    exp = os.path.expanduser(rel_s)
    if os.path.isabs(exp):
        return exp if os.path.isfile(exp) else None
    config_dir = os.environ.get("CONFIG_DIR")
    if config_dir:
        cand = os.path.normpath(os.path.join(os.path.expanduser(config_dir), rel_s))
        if os.path.isfile(cand):
            return cand
    cand2 = os.path.normpath(os.path.join(os.path.dirname(ini_path), rel_s))
    if os.path.isfile(cand2):
        return cand2
    return None


def _normalize_tool_row_pocket(row: Dict[str, Any]) -> None:
    """Expose pocket under `pocket`; LinuxCNC often uses `pocketno` only."""
    if row.get("pocket") is not None:
        return
    alt = row.get("pocketno")
    if alt is not None:
        row["pocket"] = _coerce_json_scalar(alt)


def _tool_number_from_tool_row(row: Mapping[str, Any]) -> Optional[int]:
    """Best-effort tool number T… from a serialized tool_table row."""
    for key in ("toolno", "tool", "tool_id", "number", "id"):
        v = row.get(key)
        if v is None:
            continue
        try:
            n = int(v)
        except (TypeError, ValueError):
            continue
        if n > 0:
            return n
    return None


def _pocket_from_toolinfo_result(info: Any) -> Any:
    """
    Pocket from linuxcnc stat.toolinfo(toolno) return value.

    Aligns with gmoccapy tooledit `get_toolinfo(toolnumber)` layout (see gmoccapy
    `_update_toolinfo`): index 0 toggle, 1 tool#, 2 pocket#.

    Newer docs use a dict with `pocketno` / `pocket` keys instead.
    """
    if info is None:
        return None
    if isinstance(info, Mapping):
        p = info.get("pocketno")
        if p is None:
            p = info.get("pocket")
        return p
    if isinstance(info, (list, tuple)):
        if len(info) > 2:
            return info[2]
        return None
    if isinstance(info, (str, bytes)):
        return None
    for attr in ("pocketno", "pocket"):
        if hasattr(info, attr):
            try:
                return getattr(info, attr)
            except Exception:
                pass
    try:
        return info[2]  # type: ignore[index]
    except (TypeError, IndexError, KeyError):
        return None


def _enrich_tool_table_pockets_from_toolinfo(
    stat: Any, rows: list[Dict[str, Any]]
) -> None:
    """
    linuxcnc.stat.tool_table rows often omit pocket data (see Python-Interface-Doku:
    documented fields are id/offsets/diameter/… only). Pocket comes from the tool file
    (T… P…) but matches gmoccapy: use stat.toolinfo(toolno) — dict (`pocketno`) or
    sequence like tooledit get_toolinfo (pocket at index 2).
    """
    toolinfo: Any = getattr(stat, "toolinfo", None)
    if not callable(toolinfo):
        return
    ti_fn: Callable[..., Any] = toolinfo  # type: ignore[assignment]
    for row in rows:
        if row.get("pocket") is not None:
            continue
        tno = _tool_number_from_tool_row(row)
        if tno is None:
            continue
        try:
            info = ti_fn(tno)
        except Exception:
            continue
        p = _pocket_from_toolinfo_result(info)
        if p is not None:
            row["pocket"] = _coerce_json_scalar(p)


def _enrich_tool_table_pockets_from_disk_map(
    rows: list[Dict[str, Any]], pocket_by_tool: Mapping[int, int]
) -> None:
    """Fill missing pocket from T/P lines in the INI tool table file (T1 P101 …)."""
    if not pocket_by_tool:
        return
    for row in rows:
        if row.get("pocket") is not None:
            continue
        tno = _tool_number_from_tool_row(row)
        if tno is None:
            continue
        p = pocket_by_tool.get(tno)
        if p is not None:
            row["pocket"] = int(p)


def _enrich_tool_table_comments_from_disk_map(
    rows: list[Dict[str, Any]], comment_by_tool: Mapping[int, str]
) -> None:
    """
    Fill `comment` from text after `;` on each tool line in the file.

    LinuxCNC often omits the comment entirely (tuple API), exposes only the substring before the
    first ``|``, or returns a truncated buffer that still contains ``|LCNCGUI|`` but not valid
    JSON. The on-disk line is authoritative for the full plasmaweb suffix: whenever the file
    comment contains ``|LCNCGUI|``, it replaces the stat value for that tool number.
    """
    if not comment_by_tool:
        return
    for row in rows:
        tno = _tool_number_from_tool_row(row)
        if tno is None:
            continue
        c_disk = comment_by_tool.get(tno)
        if c_disk is None:
            continue
        c_disk_s = str(c_disk).strip()
        if _LCNC_GUI_COMMENT_DELIM in c_disk_s:
            row["comment"] = c_disk_s
            continue
        c0 = row.get("comment")
        c_stat = "" if c0 is None else str(c0)
        if c_stat.strip() != "":
            continue
        row["comment"] = c_disk_s


def _enrich_tool_table_from_sidecar(
    rows: list[Dict[str, Any]], sidecar_doc: Mapping[str, Any]
) -> None:
    """Attach ``lcncgui_meta`` / ``lcncgui_presets`` from the lcncgui sidecar JSON (keyed by T)."""
    tools = sidecar_doc.get("tools")
    if not isinstance(tools, dict):
        return
    for row in rows:
        tno = _tool_number_from_tool_row(row)
        if tno is None:
            continue
        key = str(int(tno))
        if key not in tools:
            continue
        raw = tools[key]
        if not isinstance(raw, dict):
            continue
        meta = raw.get("meta")
        row["lcncgui_meta"] = meta if isinstance(meta, dict) else {}
        presets = raw.get("presets")
        row["lcncgui_presets"] = presets if isinstance(presets, list) else []


def _serialize_tool_table_entry(entry: Any) -> Dict[str, Any]:
    """Map one linuxcnc stat.tool_table row to a JSON-safe dict."""
    if isinstance(entry, Mapping):
        row: Dict[str, Any] = {}
        for k, v in entry.items():
            key = str(k)
            if key == "comment":
                row[key] = "" if v is None else str(v)
            else:
                row[key] = _coerce_json_scalar(v)
        _normalize_tool_row_pocket(row)
        return row
    if isinstance(entry, (list, tuple)) and not isinstance(entry, (str, bytes)):
        row = {}
        for i, name in enumerate(_TOOL_TABLE_SEQUENCE_FIELDS):
            if i >= len(entry):
                break
            val = entry[i]
            if name == "comment":
                row[name] = "" if val is None else str(val)
            else:
                row[name] = _coerce_json_scalar(val)
        if "id" in row and "toolno" not in row:
            row["toolno"] = row["id"]
        _normalize_tool_row_pocket(row)
        return row
    row = {}
    for attr in _TOOL_TABLE_ATTRS:
        if hasattr(entry, attr):
            val = getattr(entry, attr)
            if attr == "comment":
                row[attr] = "" if val is None else str(val)
            else:
                row[attr] = _coerce_json_scalar(val)
    _normalize_tool_row_pocket(row)
    return row


def _serialize_tool_table(
    stat: Any,
    pocket_by_tool: Optional[Mapping[int, int]] = None,
    comment_by_tool: Optional[Mapping[int, str]] = None,
    sidecar_doc: Optional[Mapping[str, Any]] = None,
) -> list[Dict[str, Any]]:
    """Serialize ``stat.tool_table`` to a list of JSON-safe dicts."""
    raw = getattr(stat, "tool_table", None)
    if not raw:
        return []
    out: list[Dict[str, Any]] = []
    for entry in raw:
        try:
            out.append(_serialize_tool_table_entry(entry))
        except (TypeError, ValueError, AttributeError):
            continue
    _enrich_tool_table_pockets_from_toolinfo(stat, out)
    if pocket_by_tool:
        _enrich_tool_table_pockets_from_disk_map(out, pocket_by_tool)
    if comment_by_tool:
        _enrich_tool_table_comments_from_disk_map(out, comment_by_tool)
    if sidecar_doc:
        _enrich_tool_table_from_sidecar(out, sidecar_doc)
    return out


@dataclass(frozen=True)
class GatewayCommandResult:
    """Result of a LinuxCNC command attempted through the gateway."""

    ok: bool
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    #: True when no NML command was sent (e.g. flood already in desired state).
    noop: bool = False
    #: Optional JSON-serializable payload on success (e.g. tool table reload deferred).
    result: Optional[Dict[str, Any]] = None


def normalize_task_state_param(status: int | str) -> int:
    """
    Map API / frontend task state to linuxcnc integer constants.
    Matches TaskState in src/store/types.ts: 1=ESTOP, 2=ESTOP_RESET, 3=OFF, 4=ON.
    """
    if isinstance(status, str):
        s = status.strip().upper()
        mapping: dict[str, int] = {
            "STATE_ESTOP": 1,
            "ESTOP": 1,
            "STATE_ESTOP_RESET": 2,
            "ESTOP_RESET": 2,
            "STATE_OFF": 3,
            "OFF": 3,
            "STATE_ON": 4,
            "ON": 4,
        }
        return mapping.get(s, 4)
    return int(status)


def _linuxcnc_error_kind_slug(kind_int: int, lc: Any) -> str:
    """Map linuxcnc error_channel kind integer to a short stable string."""
    pairs = (
        ("NML_ERROR", "nml_error"),
        ("OPERATOR_ERROR", "operator_error"),
        ("NML_TEXT", "nml_text"),
        ("OPERATOR_TEXT", "operator_text"),
        ("NML_DISPLAY", "nml_display"),
        ("OPERATOR_DISPLAY", "operator_display"),
    )
    for attr, slug in pairs:
        if hasattr(lc, attr) and int(getattr(lc, attr)) == kind_int:
            return slug
    return f"kind_{kind_int}"


class LinuxCncGateway:
    def __init__(self) -> None:
        self._power_on = False
        self._cmd = linuxcnc.command() if linuxcnc is not None else None
        self._stat = linuxcnc.stat() if linuxcnc is not None else None
        # Error text after failed motion commands (see python-interface.html §6).
        self._ec = linuxcnc.error_channel() if linuxcnc is not None else None
        # Serialize access to the (non-async) LinuxCNC status channel.
        # We poll in multiple background loops (status stream + coordinate "onChange").
        self._stat_lock = threading.Lock()
        # linuxcnc.command() is not thread-safe; single lock for all command-channel usage.
        self._cmd_lock = threading.RLock()
        # Only one consumer should poll error_channel at a time (docs: first reader wins).
        self._ec_lock = threading.Lock()
        # Long-running home/unhome runs in this single-worker pool (see async command protocol).
        self._blocking_executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="lcnc_blocking"
        )

        # Prevent overlapping async homing jobs coming from WebSocket commands.
        # Reservation is done in the *_precheck() calls; cleared in execute methods.
        self._homing_job_lock = threading.Lock()
        self._homing_job_active = False
        self._homing_job_action: Optional[str] = None
        # INI runtime config is static for process lifetime; populate lazily once.
        self._ini_runtime_config_lock = threading.Lock()
        self._ini_runtime_config_cache: Optional[Dict[str, Any]] = None

    @property
    def blocking_executor(self) -> ThreadPoolExecutor:
        return self._blocking_executor

    def shutdown_blocking_executor(self) -> None:
        """Call on app shutdown; waits for pending home/unhome work."""
        self._blocking_executor.shutdown(wait=True, cancel_futures=False)

    def _reserve_homing_job(
        self, action: str
    ) -> GatewayCommandResult | None:
        """Reserve a home/unhome job slot (async command protocol)."""
        with self._homing_job_lock:
            if self._homing_job_active:
                return GatewayCommandResult(
                    ok=False,
                    error_code="homing_job_active",
                    error_message=(
                        f"Cannot start motion.{action}: another homing/unhome job is already running."
                    ),
                )
            self._homing_job_active = True
            self._homing_job_action = action
        return None

    def _clear_homing_job(self) -> None:
        with self._homing_job_lock:
            self._homing_job_active = False
            self._homing_job_action = None

    def _try_acquire_cmd_lock(self) -> bool:
        # Never block the event loop on the command-channel lock.
        return self._cmd_lock.acquire(blocking=False)

    def _release_cmd_lock(self) -> None:
        self._cmd_lock.release()

    def get_program_prefix_directories(self) -> list[str]:
        """Public accessor for ``[DISPLAY] PROGRAM_PREFIX`` dirs (same as internal helper)."""
        return self._get_display_program_prefix_dirs()

    def _get_display_program_prefix_dirs(self) -> list[str]:
        """
        Return normalized directory paths from [DISPLAY] PROGRAM_PREFIX in the active INI.
        Empty list if unset or INI unreadable (caller may skip prefix enforcement).
        """
        ini_path = self._resolve_ini_path()
        if not ini_path:
            return []

        if linuxcnc is not None:
            try:
                inifile = linuxcnc.ini(ini_path)
            except Exception:
                inifile = None
            if inifile is not None:
                try:
                    raw = inifile.find("DISPLAY", "PROGRAM_PREFIX")
                except Exception:
                    raw = None
                if raw and str(raw).strip():
                    paths = program_prefix_directories_from_ini(str(raw).strip(), ini_path)
                    return paths

        # `strict=False`: a repeated key anywhere in the INI — `[MACROS] MACRO`, an
        # `EMBED_TAB_NAME`, a second `APP` — makes a strict parser raise, and this would
        # return no prefixes at all. PROGRAM_PREFIX is the guard on opening and writing
        # programs, so failing it open is not something to do over a duplicate line.
        parser = configparser.ConfigParser(interpolation=None, strict=False)
        parser.optionxform = str.lower
        try:
            parser.read(ini_path, encoding="utf-8")
        except Exception:
            return []
        if not parser.has_option("DISPLAY", "PROGRAM_PREFIX"):
            return []
        raw = parser.get("DISPLAY", "PROGRAM_PREFIX", fallback="").strip()
        if not raw:
            return []
        return program_prefix_directories_from_ini(raw, ini_path)

    @staticmethod
    def _file_path_under_program_prefix(file_path: str, prefixes: list[str]) -> bool:
        if not prefixes:
            return True
        try:
            f_real = os.path.realpath(file_path)
        except OSError:
            f_real = os.path.abspath(file_path)
        for pref in prefixes:
            try:
                p_real = os.path.realpath(pref) if os.path.exists(pref) else os.path.abspath(pref)
            except OSError:
                p_real = os.path.abspath(pref)
            if f_real == p_real or f_real.startswith(p_real + os.sep):
                return True
        return False

    def resolve_ini_path(self) -> Optional[str]:
        """Active LinuxCNC INI path from stat or environment (public API)."""
        return self._resolve_ini_path()

    def machine_position(self) -> Optional[Tuple[float, float, float]]:
        """XYZ in *machine* coordinates (``stat.actual_position``), or ``None`` without a stat.

        Machine coordinates on purpose: the callers that want this — a single cut, a probe at an
        offset — put ``G53`` in front of the move, so the number has to be the one the machine
        measures rather than one a work offset has shifted.
        """
        if self._stat is None:
            return None
        with self._stat_lock:
            try:
                self._stat.poll()
                position = getattr(self._stat, "actual_position", None)
            except Exception:
                return None
        if not position or len(position) < 3:
            return None
        try:
            return (float(position[0]), float(position[1]), float(position[2]))
        except (TypeError, ValueError):
            return None

    def current_program_path(self) -> Optional[str]:
        """The program LinuxCNC has loaded (``stat.file``), or ``None`` when there is none."""
        if self._stat is None:
            return None
        with self._stat_lock:
            try:
                self._stat.poll()
                raw = getattr(self._stat, "file", None)
            except Exception:
                return None
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
        return None

    def _resolve_ini_path(self) -> Optional[str]:
        """Resolve active LinuxCNC INI path from stat or environment."""
        # 1) linuxcnc.stat().ini_filename (preferred if available)
        if self._stat is not None:
            with self._stat_lock:
                try:
                    self._stat.poll()
                except Exception:
                    pass
                ini_from_stat = getattr(self._stat, "ini_filename", None)
            if isinstance(ini_from_stat, str) and ini_from_stat.strip():
                p = os.path.expanduser(ini_from_stat.strip())
                if os.path.isfile(p):
                    return p

        # 2) Typical LinuxCNC env vars
        for key in _INI_ENV_KEYS:
            raw = os.environ.get(key)
            if not raw:
                continue
            p = os.path.expanduser(raw.strip())
            if os.path.isfile(p):
                return p
        return None

    def _load_tool_table_maps_from_disk(self) -> tuple[dict[int, int], dict[int, str]]:
        """Pocket and comment per tool number from [EMCIO] TOOL_TABLE (see `_parse_tool_table_maps`)."""
        ini_path = self._resolve_ini_path()
        if not ini_path:
            return {}, {}
        tbl = _resolve_tool_table_path_from_ini(ini_path)
        if not tbl:
            return {}, {}
        return _parse_tool_table_maps(tbl)

    def _read_ini_into_result(self, ini_path: str, result: Dict[str, Any]) -> int:
        """
        Fill result from INI. Prefer linuxcnc.ini() (same as gmoccapy getiniinfo): it
        accepts duplicate option keys (e.g. multiple [FILTER] PROGRAM_EXTENSION), which
        Python's configparser rejects.
        """
        loaded_fields = 0

        # Axis→joint mapping ([KINS] coordinates) and synchronised-homing detection
        # ([JOINT_n] HOME_SEQUENCE). Read with the include-aware scanner rather than through
        # linuxcnc.ini(): QtPlasmaC configs keep both behind an #INCLUDE, and the scanner is
        # correct whether or not the linuxcnc module is importable.
        scanned_kins = _scan_ini_options(ini_path, {"KINS": {"KINEMATICS", "COORDINATES"}})
        kins_kinematics = _first_ini_option(scanned_kins, "KINS", "KINEMATICS")
        if kins_kinematics:
            result["kins_kinematics"] = kins_kinematics
            loaded_fields += 1
        kins_coordinates = _first_ini_option(scanned_kins, "KINS", "COORDINATES")
        if kins_coordinates:
            result["kins_coordinates"] = kins_coordinates
            loaded_fields += 1
        home_sequences = _read_joint_home_sequences(ini_path)
        if home_sequences:
            result["joint_home_sequences"] = home_sequences
            loaded_fields += 1

        if linuxcnc is not None:
            try:
                inifile = linuxcnc.ini(ini_path)
            except Exception:
                inifile = None
            if inifile is not None:
                raw_inc = inifile.find("DISPLAY", "INCREMENTS")
                if raw_inc:
                    spec = str(raw_inc).strip()
                    if spec:
                        result["jog_increments_spec"] = spec
                        loaded_fields += 1

                raw_lin = inifile.find("TRAJ", "LINEAR_UNITS")
                if raw_lin:
                    raw = str(raw_lin).strip().lower()
                    if raw:
                        result["linear_units"] = raw
                        if raw in ("mm", "cm"):
                            result["program_units"] = 2
                        elif raw in ("inch", "in"):
                            result["program_units"] = 1
                        loaded_fields += 1

                raw_ang = inifile.find("TRAJ", "ANGULAR_UNITS")
                if raw_ang:
                    raw = str(raw_ang).strip().lower()
                    if raw:
                        result["angular_units"] = raw
                        loaded_fields += 1

                raw_coords = inifile.find("TRAJ", "COORDINATES")
                if raw_coords:
                    c = str(raw_coords).strip()
                    if c:
                        result["traj_coordinates"] = c
                        loaded_fields += 1

                raw_lathe = inifile.find("DISPLAY", "LATHE")
                if raw_lathe is not None and str(raw_lathe).strip() != "":
                    result["display_lathe"] = _display_lathe_truthy(raw_lathe)
                    loaded_fields += 1

                if not (result.get("traj_coordinates") and str(result["traj_coordinates"]).strip()):
                    scanned = _read_traj_coordinates_line_scan(ini_path)
                    if scanned:
                        result["traj_coordinates"] = scanned
                        loaded_fields += 1

                return loaded_fields

        # No linuxcnc module (off-machine dev, CI): scan the INI ourselves. ConfigParser is
        # not usable here — it rejects LinuxCNC's duplicate keys and ignores #INCLUDE, which
        # QtPlasmaC configs put [TRAJ] and [DISPLAY] behind.
        scanned = _scan_ini_options(
            ini_path,
            {
                "DISPLAY": {"INCREMENTS", "LATHE"},
                "TRAJ": {"LINEAR_UNITS", "ANGULAR_UNITS", "COORDINATES"},
            },
        )

        raw_inc = _first_ini_option(scanned, "DISPLAY", "INCREMENTS")
        if raw_inc:
            result["jog_increments_spec"] = raw_inc
            loaded_fields += 1

        raw_lin = _first_ini_option(scanned, "TRAJ", "LINEAR_UNITS")
        if raw_lin:
            raw = raw_lin.lower()
            result["linear_units"] = raw
            if raw in ("mm", "cm"):
                result["program_units"] = 2
            elif raw in ("inch", "in"):
                result["program_units"] = 1
            loaded_fields += 1

        raw_ang = _first_ini_option(scanned, "TRAJ", "ANGULAR_UNITS")
        if raw_ang:
            result["angular_units"] = raw_ang.lower()
            loaded_fields += 1

        raw_coords = _first_ini_option(scanned, "TRAJ", "COORDINATES")
        if raw_coords:
            result["traj_coordinates"] = raw_coords
            loaded_fields += 1

        raw_lathe = _first_ini_option(scanned, "DISPLAY", "LATHE")
        if raw_lathe:
            result["display_lathe"] = _display_lathe_truthy(raw_lathe)
            loaded_fields += 1

        if not (result.get("traj_coordinates") and str(result["traj_coordinates"]).strip()):
            scanned = _read_traj_coordinates_line_scan(ini_path)
            if scanned:
                result["traj_coordinates"] = scanned
                loaded_fields += 1

        return loaded_fields

    def get_ini_runtime_config(self, force_reload: bool = False) -> Dict[str, Any]:
        """
        Read once-per-process INI values needed by the frontend.

        Returns a JSON-safe dict with robust defaults:
        - jog_increments_spec
        - linear_units
        - angular_units
        - program_units
        - traj_coordinates (optional, from [TRAJ] COORDINATES)
        - kins_kinematics / kins_coordinates (optional, from [KINS]) — axis→joint mapping
        - joint_home_sequences (list of [JOINT_n] HOME_SEQUENCE, joint index = position)
        - display_lathe (bool, from [DISPLAY] LATHE)
        - user_macros (list of {name, fileName, path} from [MACROS] + SUBROUTINE_PATH)
        - source
        - ini_path
        """
        with self._ini_runtime_config_lock:
            if self._ini_runtime_config_cache is not None and not force_reload:
                return dict(self._ini_runtime_config_cache)

            result: Dict[str, Any] = {
                "jog_increments_spec": _DEFAULT_JOG_INCREMENTS_SPEC,
                "linear_units": None,
                "angular_units": None,
                "program_units": None,
                "traj_coordinates": None,
                "kins_kinematics": None,
                "kins_coordinates": None,
                "joint_home_sequences": [],
                "display_lathe": False,
                "user_macros": [],
                "source": "default",
                "ini_path": None,
            }
            ini_path = self._resolve_ini_path()
            if not ini_path:
                self._ini_runtime_config_cache = dict(result)
                return dict(result)

            result["ini_path"] = ini_path
            loaded_fields = self._read_ini_into_result(ini_path, result)
            result["user_macros"] = list_user_subroutine_macros_from_ini(ini_path)

            result["source"] = "ini" if loaded_fields > 0 else "default"
            self._ini_runtime_config_cache = dict(result)
            return dict(result)

    def set_task_state(self, status: int | str) -> bool:
        """
        Sets LinuxCNC task state (ESTOP / ESTOP_RESET / ON / OFF).

        The frontend currently sends numeric enums (1..4) matching TaskState in
        `src/store/types.ts`. For compatibility we also accept strings like
        "STATE_ESTOP" etc.
        """

        normalized = normalize_task_state_param(status)

        # If linuxcnc is available, propagate to the real controller.
        if self._cmd is not None and linuxcnc is not None:
            if not self._try_acquire_cmd_lock():
                # Avoid blocking the WebSocket event loop on a long-running home/unhome.
                raise RuntimeError("command_in_progress")
            try:
                # normalized ist entweder bereits linuxcnc-constant oder wurde über
                # die String-Mapping-Tabelle auf linuxcnc-Werte normalisiert.
                if normalized in (
                    linuxcnc.STATE_ESTOP,
                    linuxcnc.STATE_ESTOP_RESET,
                    linuxcnc.STATE_ON,
                    linuxcnc.STATE_OFF,
                ):
                    self._cmd.state(normalized)
                else:
                    self._cmd.state(linuxcnc.STATE_OFF)
            finally:
                self._release_cmd_lock()

        # Mirror power flag so the status snapshot is consistent immediately.
        if linuxcnc is not None:
            self._power_on = normalized == linuxcnc.STATE_ON
        else:
            # Fallback auf die kanonischen Werte aus linuxcnc.
            self._power_on = normalized == 4
        return self._power_on

    def set_power(self, on: bool) -> bool:
        # Keep old API but implement in terms of task state.
        if linuxcnc is not None:
            self.set_task_state(linuxcnc.STATE_ON if on else linuxcnc.STATE_OFF)
        else:
            self.set_task_state(4 if on else 3)
        return self._power_on

    def set_task_mode(self, mode: int) -> GatewayCommandResult:
        """
        Switch LinuxCNC task mode (command.mode + wait_complete).

        This is primarily used for `program.mdi` to ensure MDI lines are sent in MODE_MDI.
        """
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )

        with self._stat_lock:
            self._stat.poll()

        if not self._try_acquire_cmd_lock():
            return GatewayCommandResult(
                ok=False,
                error_code="command_in_progress",
                error_message="Cannot switch task mode while another command is being executed.",
            )
        try:
            # wait_complete must happen on the same command channel; lock prevents overlap.
            self._cmd.mode(int(mode))
            # Short timeout: task mode switches should not take long; long-running interpreter work
            # is handled by waiting for INTERP_IDLE in a separate background loop.
            return self._wait_motion_command_result(10.0, "set_task_mode")
        except Exception as exc:  # noqa: BLE001
            return GatewayCommandResult(
                ok=False,
                error_code="handler_failed",
                error_message=str(exc),
            )
        finally:
            self._release_cmd_lock()

    def wait_last_command_complete(self, timeout_s: float) -> GatewayCommandResult:
        """
        Wait until the previous ``linuxcnc.command`` operation finishes (``wait_complete``).

        ``program_mdi`` returns immediately after ``command.mdi`` without waiting. Before
        switching task mode again (e.g. MDI → manual), the command channel should be drained;
        otherwise ``command.mode`` can fail or leave the UI stuck in MDI — often seen with
        short modal lines such as G54/G55.
        """
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        if not self._try_acquire_cmd_lock():
            return GatewayCommandResult(
                ok=False,
                error_code="command_in_progress",
                error_message="Cannot wait while another command is being executed.",
            )
        try:
            return self._wait_motion_command_result(float(timeout_s), "wait_last_command_complete")
        finally:
            self._release_cmd_lock()

    def get_machine_task_context(self) -> Dict[str, Any]:
        """
        Returns a small subset of LinuxCNC status needed for safe mode switching.

        Fields:
        - enabled: stat.enabled
        - task_state: stat.task_state (raw linuxcnc value)
        - task_mode: stat.task_mode (raw linuxcnc value)
        - interp_state: stat.interp_state (raw linuxcnc value)
        - current_vel: stat.current_vel (best-effort)
        - motion_type: stat.motion_type (best-effort)
        """
        # Defensive defaults for environments without linuxcnc (e.g. unit tests using the real gateway).
        lc = linuxcnc
        fallback_motion_none = 0
        task_state_off = 3
        task_state_on = 4
        task_mode_manual = 1
        task_mode_mdi = 3
        interp_idle = 1

        if self._stat is None or lc is None:
            return {
                "enabled": True,
                "task_state": task_state_off,
                "task_mode": task_mode_manual,
                "interp_state": interp_idle,
                "current_vel": 0.0,
                "motion_type": fallback_motion_none,
                "powerOn": False,
            }

        with self._stat_lock:
            self._stat.poll()
            s = self._stat

            enabled = bool(getattr(s, "enabled", True))
            task_state_val = int(getattr(s, "task_state", task_state_off))
            task_mode_val = int(getattr(s, "task_mode", task_mode_manual))
            interp_state_val = int(getattr(s, "interp_state", interp_idle))

            try:
                current_vel_val = float(getattr(s, "current_vel", 0.0) or 0.0)
            except (TypeError, ValueError):
                current_vel_val = 0.0

            motion_none = int(getattr(lc, "MOTION_TYPE_NONE", fallback_motion_none))
            try:
                motion_type_val = int(getattr(s, "motion_type", motion_none))
            except (TypeError, ValueError):
                motion_type_val = motion_none

            power_on = task_state_val == getattr(lc, "STATE_ON", task_state_on)

            return {
                "enabled": enabled,
                "task_state": task_state_val,
                "task_mode": task_mode_val,
                "interp_state": interp_state_val,
                "current_vel": current_vel_val,
                "motion_type": motion_type_val,
                "powerOn": power_on,
            }

    def program_mdi(self, text: str) -> GatewayCommandResult:
        """
        Execute one MDI line (linuxcnc.command.mdi) with gmoccapy-style safety checks.

        Preconditions / checks (best-effort):
        - machine must be ON (not ESTOP/OFF)
        - stat.enabled must be true
        - interpreter must be idle (INTERP_IDLE)
        - if current task_mode is MODE_MANUAL: block if jog/motion is active
          to avoid unsafe task-mode switches while jogging
        - if current task_mode is MODE_MANUAL: switch to MODE_MDI first, then send mdi line
        - if current task_mode is MODE_MDI: send mdi line directly
        - otherwise: reject with wrong_task_mode
        """
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        assert self._stat is not None

        with self._stat_lock:
            self._stat.poll()
            s = self._stat

            rej = self._reject_unless_machine_on(s, linuxcnc)
            if rej is not None:
                return rej

            if not bool(getattr(s, "enabled", True)):
                return GatewayCommandResult(
                    ok=False,
                    error_code="machine_disabled",
                    error_message="Machine is not enabled (stat.enabled is false); cannot execute MDI.",
                )

            task_mode = int(getattr(s, "task_mode", linuxcnc.MODE_MANUAL))
            interp_state = int(getattr(s, "interp_state", linuxcnc.INTERP_IDLE))
            if interp_state != int(getattr(linuxcnc, "INTERP_IDLE", 1)):
                return GatewayCommandResult(
                    ok=False,
                    error_code="interpreter_busy",
                    error_message="Cannot execute MDI while interpreter is busy.",
                )

            # gmoccapy: mode switches are typically gated by interpreter-idle;
            # additionally we block on active jogging/motion to avoid unsafe switches.
            try:
                current_vel = float(getattr(s, "current_vel", 0.0) or 0.0)
            except (TypeError, ValueError):
                current_vel = 0.0

            motion_type_none = int(getattr(linuxcnc, "MOTION_TYPE_NONE", 0))
            try:
                motion_type = int(getattr(s, "motion_type", motion_type_none))
            except (TypeError, ValueError):
                motion_type = motion_type_none

            if task_mode == linuxcnc.MODE_MANUAL:
                motion_active = abs(current_vel) > 1e-9 or motion_type != motion_type_none
                if motion_active:
                    return GatewayCommandResult(
                        ok=False,
                        error_code="jog_active",
                        error_message="Cannot switch task mode while jogging/motion is active.",
                    )

                if not self._try_acquire_cmd_lock():
                    return GatewayCommandResult(
                        ok=False,
                        error_code="command_in_progress",
                        error_message="Cannot switch task mode while another command is being executed.",
                    )
                try:
                    # Switch into MODE_MDI before sending the MDI command line.
                    self._cmd.mode(int(linuxcnc.MODE_MDI))
                    mode_res = self._wait_motion_command_result(10.0, "set_task_mode")
                    if not mode_res.ok:
                        return mode_res
                    self._cmd.mdi(text)
                    return GatewayCommandResult(ok=True, noop=False)
                except Exception as exc:  # noqa: BLE001
                    return GatewayCommandResult(
                        ok=False,
                        error_code="handler_failed",
                        error_message=str(exc),
                    )
                finally:
                    self._release_cmd_lock()

            if task_mode == linuxcnc.MODE_MDI:
                if not self._try_acquire_cmd_lock():
                    return GatewayCommandResult(
                        ok=False,
                        error_code="command_in_progress",
                        error_message="Cannot execute MDI while another command is being executed.",
                    )
                try:
                    self._cmd.mdi(text)
                    return GatewayCommandResult(ok=True, noop=False)
                except Exception as exc:  # noqa: BLE001
                    return GatewayCommandResult(
                        ok=False,
                        error_code="handler_failed",
                        error_message=str(exc),
                    )
                finally:
                    self._release_cmd_lock()

            return GatewayCommandResult(
                ok=False,
                error_code="wrong_task_mode",
                error_message="MDI can only be executed in MODE_MANUAL or MODE_MDI.",
            )

    def program_open(self, path: str) -> GatewayCommandResult:
        """
        Load a G-code file into LinuxCNC (``command.program_open`` + ``wait_complete``).

        Preconditions mirror ``program_mdi`` for safety: machine ON, ``stat.enabled``,
        interpreter idle. If ``[DISPLAY] PROGRAM_PREFIX`` is set in the INI, the file
        must lie under that directory.
        """
        raw = (path or "").strip()
        if not raw:
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message="path must be a non-empty string.",
            )

        prefixes = self._get_display_program_prefix_dirs()
        from backend.program_file_paths import resolve_existing_file

        fpath, path_err = resolve_existing_file(raw, prefixes)
        if path_err:
            p_try = os.path.abspath(os.path.expanduser(raw))
            if path_err == "file_not_found":
                return GatewayCommandResult(
                    ok=False,
                    error_code="file_not_found",
                    error_message=f"Not a readable file: {p_try}",
                )
            if path_err == "outside_program_prefix":
                return GatewayCommandResult(
                    ok=False,
                    error_code="outside_program_prefix",
                    error_message=(
                        "File path is not under [DISPLAY] PROGRAM_PREFIX in the LinuxCNC INI."
                    ),
                )
            return GatewayCommandResult(
                ok=False,
                error_code=path_err,
                error_message=f"Invalid program path ({path_err}).",
            )

        assert fpath is not None

        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        assert self._stat is not None
        lc = linuxcnc

        with self._stat_lock:
            self._stat.poll()
            s = self._stat

            rej = self._reject_unless_machine_on(s, lc)
            if rej is not None:
                return rej

            if not bool(getattr(s, "enabled", True)):
                return GatewayCommandResult(
                    ok=False,
                    error_code="machine_disabled",
                    error_message="Machine is not enabled (stat.enabled is false); cannot load program.",
                )

            interp_state = int(getattr(s, "interp_state", lc.INTERP_IDLE))
            if interp_state != int(getattr(lc, "INTERP_IDLE", 1)):
                return GatewayCommandResult(
                    ok=False,
                    error_code="interpreter_busy",
                    error_message="Cannot load program while interpreter is busy.",
                )

        if not self._try_acquire_cmd_lock():
            return GatewayCommandResult(
                ok=False,
                error_code="command_in_progress",
                error_message="Cannot load program while another command is being executed.",
            )
        try:
            # Gleiche kanonische Pfadauflösung wie program.read (realpath), damit die Prüfung
            # nicht von os.path.isfile(logical) abweicht.
            self._cmd.program_open(fpath)
            wait_res = self._wait_motion_command_result(
                _PROGRAM_OPEN_WAIT_TIMEOUT_S, "program_open"
            )
            if wait_res.ok:
                return wait_res
            # Manche Setups liefern RCS_ERROR / Timeout obwohl das Programm bereits gesetzt ist.
            # Wenn stat.file zum Ziel passt, werten wir den Open dennoch als erfolgreich.
            loaded: str | None = None
            with self._stat_lock:
                try:
                    self._stat.poll()
                    raw_file = getattr(self._stat, "file", None)
                    if isinstance(raw_file, str) and raw_file.strip():
                        loaded = raw_file.strip()
                except Exception:
                    loaded = None
            if loaded:
                try:
                    if os.path.normpath(os.path.realpath(loaded)) == os.path.normpath(
                        os.path.realpath(fpath)
                    ):
                        return GatewayCommandResult(ok=True, noop=False)
                except OSError:
                    pass
            return wait_res
        except Exception as exc:  # noqa: BLE001
            return GatewayCommandResult(
                ok=False,
                error_code="handler_failed",
                error_message=str(exc),
            )
        finally:
            self._release_cmd_lock()

    def load_tool_table(self) -> GatewayCommandResult:
        """
        Reload tool table from disk (``command.load_tool_table`` + ``wait_complete``).

        Same safety preconditions as ``program_open``: machine ON, enabled, interpreter idle.
        """
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        assert self._stat is not None
        lc = linuxcnc

        if not hasattr(self._cmd, "load_tool_table"):
            return GatewayCommandResult(
                ok=False,
                error_code="handler_failed",
                error_message="LinuxCNC command channel has no load_tool_table(); check LinuxCNC version.",
            )

        with self._stat_lock:
            self._stat.poll()
            s = self._stat

            rej = self._reject_unless_machine_on(s, lc)
            if rej is not None:
                return rej

            if not bool(getattr(s, "enabled", True)):
                return GatewayCommandResult(
                    ok=False,
                    error_code="machine_disabled",
                    error_message="Machine is not enabled (stat.enabled is false); cannot reload tool table.",
                )

            interp_state = int(getattr(s, "interp_state", lc.INTERP_IDLE))
            if interp_state != int(getattr(lc, "INTERP_IDLE", 1)):
                return GatewayCommandResult(
                    ok=False,
                    error_code="interpreter_busy",
                    error_message="Cannot reload tool table while interpreter is busy.",
                )

        if not self._try_acquire_cmd_lock():
            return GatewayCommandResult(
                ok=False,
                error_code="command_in_progress",
                error_message="Cannot reload tool table while another command is being executed.",
            )
        try:
            self._cmd.load_tool_table()
            return self._wait_motion_command_result(
                _LOAD_TOOL_TABLE_WAIT_TIMEOUT_S, "load_tool_table"
            )
        except Exception as exc:  # noqa: BLE001
            return GatewayCommandResult(
                ok=False,
                error_code="handler_failed",
                error_message=str(exc),
            )
        finally:
            self._release_cmd_lock()

    def program_auto(self, subcommand: str, start_line: int = 0) -> GatewayCommandResult:
        """
        AUTO task commands: run (optional start line), pause, resume (``command.auto``).

        For **run**: ``INTERP_IDLE`` and a loaded program file; task mode may be
        ``MODE_AUTO`` or, if safe, ``MODE_MANUAL`` / ``MODE_MDI`` — in the latter case
        the gateway switches to ``MODE_AUTO`` before ``AUTO_RUN`` (no active jog in
        manual). After ``AUTO_RUN`` there is **no** ``wait_complete`` (avoids blocking
        ``stat.poll()`` / the command lock for the whole program); see project docs
        ``docs/commands-events.md`` → ``program.auto``.

        After ``AUTO_PAUSE`` and ``AUTO_RESUME`` there is also **no** ``wait_complete``.
        On some LinuxCNC builds, ``wait_complete`` after pause can block until resume
        or abort, which would hold ``_cmd_lock`` and block ``machine.abort``, other
        commands, and clean shutdown of the blocking executor.
        Pause / resume still require ``MODE_AUTO`` and the usual interpreter states
        (checked above before acquiring the lock).
        """
        sub = (subcommand or "").strip().lower()
        if sub not in ("run", "pause", "resume"):
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message='subcommand must be "run", "pause", or "resume".',
            )
        if start_line < 0:
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_start_line",
                error_message="start_line must be >= 0.",
            )

        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        assert self._stat is not None
        lc = linuxcnc
        need_mode_switch_to_auto = False

        with self._stat_lock:
            self._stat.poll()
            s = self._stat

            rej = self._reject_unless_machine_on(s, lc)
            if rej is not None:
                return rej

            if not bool(getattr(s, "enabled", True)):
                return GatewayCommandResult(
                    ok=False,
                    error_code="machine_disabled",
                    error_message="Machine is not enabled (stat.enabled is false); cannot run AUTO command.",
                )

            task_mode = int(getattr(s, "task_mode", lc.MODE_MANUAL))
            interp_state = int(getattr(s, "interp_state", lc.INTERP_IDLE))
            interp_idle = int(getattr(lc, "INTERP_IDLE", 1))
            interp_reading = int(getattr(lc, "INTERP_READING", 2))
            interp_paused = int(getattr(lc, "INTERP_PAUSED", 3))
            interp_waiting = int(getattr(lc, "INTERP_WAITING", 4))
            mode_auto = int(getattr(lc, "MODE_AUTO", 2))
            mode_manual = int(getattr(lc, "MODE_MANUAL", 1))
            mode_mdi = int(getattr(lc, "MODE_MDI", 3))

            if sub == "run":
                if interp_state != interp_idle:
                    return GatewayCommandResult(
                        ok=False,
                        error_code="interpreter_busy",
                        error_message="Cannot start program while interpreter is not idle.",
                    )
                file_raw = getattr(s, "file", "") or ""
                if not str(file_raw).strip():
                    return GatewayCommandResult(
                        ok=False,
                        error_code="no_program_loaded",
                        error_message="No G-code file is loaded; load a program before run.",
                    )
                if task_mode == mode_auto:
                    pass
                elif task_mode == mode_manual:
                    try:
                        current_vel = float(getattr(s, "current_vel", 0.0) or 0.0)
                    except (TypeError, ValueError):
                        current_vel = 0.0
                    motion_type_none = int(getattr(lc, "MOTION_TYPE_NONE", 0))
                    try:
                        motion_type = int(getattr(s, "motion_type", motion_type_none))
                    except (TypeError, ValueError):
                        motion_type = motion_type_none
                    motion_active = abs(current_vel) > 1e-9 or motion_type != motion_type_none
                    if motion_active:
                        return GatewayCommandResult(
                            ok=False,
                            error_code="jog_active",
                            error_message="Cannot switch task mode while jogging/motion is active.",
                        )
                    need_mode_switch_to_auto = True
                elif task_mode == mode_mdi:
                    need_mode_switch_to_auto = True
                else:
                    return GatewayCommandResult(
                        ok=False,
                        error_code="wrong_task_mode",
                        error_message="Program run requires LinuxCNC task mode AUTO (or MANUAL/MDI with interpreter idle).",
                    )
            elif sub == "pause":
                if task_mode != mode_auto:
                    return GatewayCommandResult(
                        ok=False,
                        error_code="wrong_task_mode",
                        error_message="Pause requires LinuxCNC task mode AUTO.",
                    )
                if interp_state not in (interp_reading, interp_waiting):
                    return GatewayCommandResult(
                        ok=False,
                        error_code="not_running",
                        error_message="Pause is only valid while the program is executing.",
                    )
            else:  # resume
                if task_mode != mode_auto:
                    return GatewayCommandResult(
                        ok=False,
                        error_code="wrong_task_mode",
                        error_message="Resume requires LinuxCNC task mode AUTO.",
                    )
                if interp_state != interp_paused:
                    return GatewayCommandResult(
                        ok=False,
                        error_code="not_paused",
                        error_message="Resume is only valid while the interpreter is paused.",
                    )

        if not self._try_acquire_cmd_lock():
            return GatewayCommandResult(
                ok=False,
                error_code="command_in_progress",
                error_message="Cannot run AUTO command while another command is being executed.",
            )
        try:
            # LinuxCNC Python: AUTO_RUN=0, AUTO_STEP=1, AUTO_PAUSE=2, AUTO_RESUME=3
            auto_run = int(getattr(lc, "AUTO_RUN", 0))
            auto_pause = int(getattr(lc, "AUTO_PAUSE", 2))
            auto_resume = int(getattr(lc, "AUTO_RESUME", 3))
            if sub == "run" and need_mode_switch_to_auto:
                self._cmd.mode(mode_auto)
                mode_res = self._wait_motion_command_result(
                    10.0, "program_auto_set_mode_auto"
                )
                if not mode_res.ok:
                    return mode_res
            if sub == "run":
                # No post-AUTO_RUN wait_complete — see ``docs/commands-events.md`` (program.auto).
                self._cmd.auto(auto_run, int(start_line))
                return GatewayCommandResult(ok=True, noop=False)
            if sub == "pause":
                self._cmd.auto(auto_pause)
                return GatewayCommandResult(ok=True, noop=False)
            self._cmd.auto(auto_resume)
            return GatewayCommandResult(ok=True, noop=False)
        except Exception as exc:  # noqa: BLE001
            return GatewayCommandResult(
                ok=False,
                error_code="handler_failed",
                error_message=str(exc),
            )
        finally:
            self._release_cmd_lock()

    def abort_program(self, *, timeout_s: float | None = None) -> GatewayCommandResult:
        """
        Abort task / interpreter motion (``command.abort`` + ``wait_complete``).

        Intentionally does not require machine ON (LinuxCNC allows abort in most states).
        """
        wait_s = _ABORT_WAIT_TIMEOUT_S if timeout_s is None else timeout_s
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        if not self._try_acquire_cmd_lock():
            return GatewayCommandResult(
                ok=False,
                error_code="command_in_progress",
                error_message="Cannot abort while another command is being executed.",
            )
        try:
            self._cmd.abort()
            return self._wait_motion_command_result(wait_s, "abort")
        except Exception as exc:  # noqa: BLE001
            return GatewayCommandResult(
                ok=False,
                error_code="handler_failed",
                error_message=str(exc),
            )
        finally:
            self._release_cmd_lock()

    def _halcmd_path(self) -> Optional[str]:
        p = shutil.which("halcmd")
        return p

    def hal_getp_raw(self, pin: str, *, timeout_s: float) -> Optional[str]:
        """
        Read a HAL pin via ``halcmd -s getp`` (userspace, same session as LinuxCNC).
        Returns stripped stdout on success, or ``None`` on failure / missing halcmd.
        """
        if not pin or not pin.strip():
            return None
        exe = self._halcmd_path()
        if not exe:
            return None
        try:
            proc = subprocess.run(
                [exe, "-s", "getp", pin.strip()],
                capture_output=True,
                text=True,
                timeout=float(timeout_s),
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired, ValueError):
            return None
        if proc.returncode != 0:
            return None
        out = (proc.stdout or "").strip()
        return out if out else None

    def hal_get_bit(self, pin: str, *, timeout_s: float = 3.0) -> Optional[bool]:
        raw = self.hal_getp_raw(pin, timeout_s=timeout_s)
        if raw is None:
            return None
        token = raw.split()[-1].strip().upper()
        if token in ("TRUE", "1", "YES", "ON"):
            return True
        if token in ("FALSE", "0", "NO", "OFF"):
            return False
        try:
            return bool(int(token))
        except ValueError:
            return None

    def hal_get_s32(self, pin: str, *, timeout_s: float = 3.0) -> Optional[int]:
        raw = self.hal_getp_raw(pin, timeout_s=timeout_s)
        if raw is None:
            return None
        token = raw.split()[-1].strip()
        try:
            return int(token, 10)
        except ValueError:
            return None

    def _hal_setp(self, pin: str, value_token: str, *, timeout_s: float = 3.0) -> GatewayCommandResult:
        """Write a HAL pin/param via ``halcmd -s setp`` (userspace, same session as LinuxCNC)."""
        token = (pin or "").strip()
        if not token:
            return GatewayCommandResult(
                ok=False,
                error_code="empty_hal_pin",
                error_message="HAL pin name is empty.",
            )
        exe = self._halcmd_path()
        if not exe:
            return GatewayCommandResult(
                ok=False,
                error_code="halcmd_unavailable",
                error_message="halcmd is not installed or not in PATH.",
            )
        try:
            proc = subprocess.run(
                [exe, "-s", "setp", token, str(value_token)],
                capture_output=True,
                text=True,
                timeout=float(timeout_s),
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired, ValueError) as exc:
            return GatewayCommandResult(
                ok=False,
                error_code="hal_set_failed",
                error_message=str(exc),
            )
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout or "").strip()
            msg = f"halcmd setp failed (exit {proc.returncode})"
            if tail:
                msg = f"{msg}: {tail[:500]}"
            return GatewayCommandResult(
                ok=False,
                error_code="hal_set_nonzero",
                error_message=msg,
            )
        return GatewayCommandResult(ok=True, noop=False)

    def hal_set_bit(self, pin: str, value: bool, *, timeout_s: float = 3.0) -> GatewayCommandResult:
        """Write a HAL bit pin via ``halcmd -s setp`` (userspace, same session as LinuxCNC)."""
        return self._hal_setp(pin, "1" if value else "0", timeout_s=timeout_s)

    def hal_set_float(self, pin: str, value: float, *, timeout_s: float = 3.0) -> GatewayCommandResult:
        """Write a HAL float pin/param via ``halcmd -s setp``."""
        return self._hal_setp(pin, format(float(value), ".12g"), timeout_s=timeout_s)

    def set_jog_wheel_scale(self, scale: float, *, timeout_s: float = 3.0) -> GatewayCommandResult:
        """Set all configured MPG ``jog-scale`` pins to ``scale`` (machine units per count).

        Missing HAL pins / unavailable ``halcmd`` are treated as optional (``ok=True``,
        ``noop=True``) so UI connect without an MPG setup does not surface as an error.
        """
        from backend import config

        try:
            scale_f = float(scale)
        except (TypeError, ValueError):
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message="scale must be a number.",
            )
        if not (scale_f > 0.0):
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message="scale must be > 0.",
            )
        pins = [p for p in config.JOG_WHEEL_SCALE_PINS if p]
        if not pins:
            return GatewayCommandResult(
                ok=False,
                error_code="jog_wheel_scale_pins_not_configured",
                error_message="No jog-wheel scale pins configured.",
            )
        for pin in pins:
            result = self.hal_set_float(pin, scale_f, timeout_s=timeout_s)
            if not result.ok:
                if result.error_code in ("hal_set_nonzero", "halcmd_unavailable"):
                    return GatewayCommandResult(ok=True, noop=True)
                return result
        return GatewayCommandResult(ok=True, noop=False)

    def hal_pulse_rising_edge(self, pin: str, *, timeout_s: float = 3.0) -> GatewayCommandResult:
        """Drive an HAL input bit low → high → low (e.g. oneshot ``.in`` trigger)."""
        for value in (False, True, False):
            result = self.hal_set_bit(pin, value, timeout_s=timeout_s)
            if not result.ok:
                return result
        return GatewayCommandResult(ok=True, noop=False)

    def get_hal_softkey_feedback(self) -> Dict[str, int]:
        """Read active-state feedback bits for virtual sidebar HAL softkeys 14–16.

        Keys with unreadable pins (``hal_get_bit`` returns ``None``) are omitted so the
        frontend can distinguish confirmed inactive (``0``) from unknown.
        """
        from backend import config

        out: Dict[str, int] = {}
        for slot, pin in config.HAL_SOFTKEY_FEEDBACK_PINS.items():
            key = str(slot)
            if not pin:
                continue
            val = self.hal_get_bit(pin, timeout_s=config.TOOLCHANGE_HALCMD_TIMEOUT_S)
            if val is None:
                continue
            out[key] = 1 if val else 0
        return out

    def run_shell_command(self, cmd: str) -> GatewayCommandResult:
        """Run a single shell line (e.g. HAL ack); not holding ``_cmd_lock``."""
        line = (cmd or "").strip()
        if not line:
            return GatewayCommandResult(
                ok=False,
                error_code="empty_shell_command",
                error_message="Shell command is empty.",
            )
        try:
            proc = subprocess.run(
                line,
                shell=True,
                capture_output=True,
                text=True,
                timeout=_TOOLCHANGE_SHELL_TIMEOUT_S,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return GatewayCommandResult(
                ok=False,
                error_code="shell_failed",
                error_message=str(exc),
            )
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout or "").strip()
            msg = f"Exit code {proc.returncode}"
            if tail:
                msg = f"{msg}: {tail[:500]}"
            return GatewayCommandResult(
                ok=False,
                error_code="shell_nonzero",
                error_message=msg,
            )
        return GatewayCommandResult(ok=True, noop=False)

    def tool_change_abort_with_optional_shell(
        self, extra_shell: Optional[str]
    ) -> GatewayCommandResult:
        """``command.abort`` then optional extra shell (HAL cleanup), like gmoccapy abort path."""
        abort_res = self.abort_program()
        if not abort_res.ok:
            return abort_res
        ex = (extra_shell or "").strip()
        if not ex:
            return GatewayCommandResult(ok=True, noop=False)
        shell_res = self.run_shell_command(ex)
        if not shell_res.ok:
            return shell_res
        return GatewayCommandResult(ok=True, noop=False)

    def get_tool_description_for_number(self, toolno: int) -> str:
        """
        Best-effort Beschreibung für eine Werkzeugnummer: zuerst Anzeigename aus der plasmaweb-Sidecar,
        dann wie bei ``_serialize_tool_table`` (Datei-Kommentar inkl. ``|LCNCGUI|``, sonst stat).
        """
        try:
            tni = int(toolno)
        except (TypeError, ValueError):
            return ""
        ini_path = self._resolve_ini_path()
        if ini_path:
            tp = _resolve_tool_table_path_from_ini(ini_path)
            if tp and os.path.isfile(tp):
                sn = sidecar_meta_name(tp, tni)
                if sn:
                    return sn
        if self._stat is None or linuxcnc is None:
            try:
                _, comments = self._load_tool_table_maps_from_disk()
                c = comments.get(tni, "")
                return str(c).strip() if c else ""
            except (TypeError, ValueError, OSError, AttributeError):
                return ""
        try:
            _, comments = self._load_tool_table_maps_from_disk()
        except (TypeError, ValueError, OSError, AttributeError):
            comments = {}
        c_disk = str(comments.get(tni, "") or "").strip()

        s_stat = ""
        try:
            with self._stat_lock:
                self._stat.poll()
                raw = getattr(self._stat, "tool_table", None) or ()
                for entry in raw:
                    row = _serialize_tool_table_entry(entry)
                    t = row.get("toolno")
                    if t is None:
                        t = row.get("id")
                    if t is None:
                        continue
                    if int(t) != tni:
                        continue
                    c = row.get("comment")
                    if c is not None:
                        st = str(c).strip()
                        if st:
                            s_stat = st
                            break
        except (TypeError, ValueError, AttributeError):
            pass

        if _LCNC_GUI_COMMENT_DELIM in c_disk:
            return c_disk
        if s_stat:
            return s_stat
        return c_disk

    def _prepare_tool_table_disk_write_path(
        self,
    ) -> tuple[Optional[GatewayCommandResult], Optional[str]]:
        """
        Resolve ``TOOL_TABLE`` path for disk writes (update/delete/add).

        Does **not** require machine ON or ``stat.enabled`` so operators can edit
        library data while the machine is off. Still requires interpreter idle so we
        do not rewrite the file while a program may be using tool data.

        Returns ``(error, None)`` on failure, else ``(None, tbl_path)``.
        """
        if self._cmd is None or linuxcnc is None:
            return (
                GatewayCommandResult(
                    ok=False,
                    error_code="linuxcnc_unavailable",
                    error_message="LinuxCNC Python module or command channel not available.",
                ),
                None,
            )
        assert self._stat is not None
        lc = linuxcnc

        if not hasattr(self._cmd, "load_tool_table"):
            return (
                GatewayCommandResult(
                    ok=False,
                    error_code="handler_failed",
                    error_message="LinuxCNC command channel has no load_tool_table(); check LinuxCNC version.",
                ),
                None,
            )

        with self._stat_lock:
            self._stat.poll()
            s = self._stat
            interp_state = int(getattr(s, "interp_state", lc.INTERP_IDLE))
            if interp_state != int(getattr(lc, "INTERP_IDLE", 1)):
                return (
                    GatewayCommandResult(
                        ok=False,
                        error_code="interpreter_busy",
                        error_message="Cannot update tool table while interpreter is busy.",
                    ),
                    None,
                )

        ini_path = self._resolve_ini_path()
        if not ini_path:
            return (
                GatewayCommandResult(
                    ok=False,
                    error_code="tool_table_not_configured",
                    error_message="Could not resolve LinuxCNC INI path; cannot locate TOOL_TABLE.",
                ),
                None,
            )
        tbl_path = _resolve_tool_table_path_from_ini(ini_path)
        if not tbl_path:
            return (
                GatewayCommandResult(
                    ok=False,
                    error_code="tool_table_not_configured",
                    error_message="INI has no readable [EMCIO] TOOL_TABLE path.",
                ),
                None,
            )
        return (None, tbl_path)

    def _finish_tool_table_disk_write_with_optional_reload(self) -> GatewayCommandResult:
        """
        Call ``load_tool_table()`` only when machine is ON, enabled, and interpreter idle.

        If those conditions are not met, returns success with
        ``result["toolTableReloadDeferred"] == True`` (file already written on disk).
        """
        assert self._cmd is not None and linuxcnc is not None
        lc = linuxcnc
        with self._stat_lock:
            self._stat.poll()
            s = self._stat
            if self._reject_unless_machine_on(s, lc) is not None:
                return GatewayCommandResult(
                    ok=True,
                    result={"toolTableReloadDeferred": True},
                )
            if not bool(getattr(s, "enabled", True)):
                return GatewayCommandResult(
                    ok=True,
                    result={"toolTableReloadDeferred": True},
                )
            interp_state = int(getattr(s, "interp_state", lc.INTERP_IDLE))
            if interp_state != int(getattr(lc, "INTERP_IDLE", 1)):
                return GatewayCommandResult(
                    ok=True,
                    result={"toolTableReloadDeferred": True},
                )

        try:
            self._cmd.load_tool_table()
            return self._wait_motion_command_result(
                _LOAD_TOOL_TABLE_WAIT_TIMEOUT_S, "load_tool_table"
            )
        except Exception as exc:  # noqa: BLE001
            return GatewayCommandResult(
                ok=False,
                error_code="handler_failed",
                error_message=str(exc),
            )

    def update_tool_table_row(self, params: Mapping[str, Any]) -> GatewayCommandResult:
        """
        Rewrite one ``T… P…`` row in ``[EMCIO] TOOL_TABLE`` (merge with disk), then reload
        the table into LinuxCNC when the machine is ON and enabled; otherwise disk write
        still succeeds and ``result`` may carry ``toolTableReloadDeferred``.
        """
        try:
            toolno = int(params.get("toolno", 0))
        except (TypeError, ValueError):
            toolno = 0
        if toolno <= 0:
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message="toolno must be a positive integer.",
            )

        prep_err, tbl_path = self._prepare_tool_table_disk_write_path()
        if prep_err is not None:
            return prep_err
        assert tbl_path is not None

        if not self._try_acquire_cmd_lock():
            return GatewayCommandResult(
                ok=False,
                error_code="command_in_progress",
                error_message="Cannot update tool table while another command is being executed.",
            )
        try:
            p_in = dict(params)
            new_toolno: Optional[int] = None
            raw_new = p_in.pop("new_toolno", None)
            if raw_new is not None:
                try:
                    nt = int(raw_new)
                except (TypeError, ValueError):
                    return GatewayCommandResult(
                        ok=False,
                        error_code="invalid_params",
                        error_message="new_toolno must be a positive integer.",
                    )
                if nt <= 0:
                    return GatewayCommandResult(
                        ok=False,
                        error_code="invalid_params",
                        error_message="new_toolno must be a positive integer.",
                    )
                if nt != toolno:
                    new_toolno = nt

            p, lc_meta, lc_presets = pop_lcncgui_params(p_in)
            if lc_meta is not MISSING:
                if isinstance(lc_meta, dict):
                    p["comment"] = short_table_comment_from_meta(lc_meta)
                else:
                    p["comment"] = ""

            need_sidecar_write = (
                new_toolno is not None
                or lc_meta is not MISSING
                or lc_presets is not MISSING
            )
            sidecar_doc: Optional[dict[str, Any]] = None
            if need_sidecar_write:
                sidecar_doc = load_tool_sidecar(tbl_path)
                tools_map = sidecar_doc.get("tools")
                if not isinstance(tools_map, dict):
                    sidecar_doc["tools"] = {}
                    tools_map = sidecar_doc["tools"]
                assert isinstance(tools_map, dict)

                if new_toolno is not None and sidecar_entry_substantive(
                    tools_map.get(str(int(new_toolno)))
                ):
                    return GatewayCommandResult(
                        ok=False,
                        error_code="tool_already_exists",
                        error_message=(
                            f"plasmaweb sidecar already has a non-empty entry for T{new_toolno}; "
                            "remove or merge it before renaming."
                        ),
                    )

            write_err = _apply_tool_table_row_update_to_disk(
                tbl_path, toolno, p, new_toolno=new_toolno
            )
            if write_err is not None:
                code, msg = write_err
                return GatewayCommandResult(ok=False, error_code=code, error_message=msg)

            if not need_sidecar_write:
                return self._finish_tool_table_disk_write_with_optional_reload()

            assert sidecar_doc is not None
            tools_mut: MutableMapping[str, Any] = sidecar_doc["tools"]
            try:
                if new_toolno is not None:
                    rename_tool_keys_in_tools_mut(tools_mut, toolno, new_toolno)
                sidecar_toolno = new_toolno if new_toolno is not None else toolno
                if lc_meta is not MISSING or lc_presets is not MISSING:
                    upsert_tool_entry_in_tools_mut(
                        tools_mut,
                        sidecar_toolno,
                        meta=lc_meta,
                        presets=lc_presets,
                    )
                save_tool_sidecar_atomic(tbl_path, sidecar_doc)
            except OSError as exc:
                if new_toolno is not None:
                    rev_err = _apply_tool_table_row_update_to_disk(
                        tbl_path,
                        int(new_toolno),
                        p,
                        new_toolno=int(toolno),
                    )
                    if rev_err is not None:
                        _code, rev_msg = rev_err
                        return GatewayCommandResult(
                            ok=False,
                            error_code="handler_failed",
                            error_message=(
                                f"Tool sidecar write failed: {exc}. "
                                f"Rollback of .tbl also failed: {rev_msg}"
                            ),
                        )
                return GatewayCommandResult(
                    ok=False,
                    error_code="handler_failed",
                    error_message=f"Tool sidecar write failed: {exc}",
                )
            return self._finish_tool_table_disk_write_with_optional_reload()
        except Exception as exc:  # noqa: BLE001
            return GatewayCommandResult(
                ok=False,
                error_code="handler_failed",
                error_message=str(exc),
            )
        finally:
            self._release_cmd_lock()

    def delete_tool_table_row(self, params: Mapping[str, Any]) -> GatewayCommandResult:
        """
        Remove the last ``T… P…`` row for ``toolno`` from ``[EMCIO] TOOL_TABLE``, then reload.
        Preconditions match :meth:`update_tool_table_row`.
        """
        try:
            toolno = int(params.get("toolno", 0))
        except (TypeError, ValueError):
            toolno = 0
        if toolno <= 0:
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message="toolno must be a positive integer.",
            )

        prep_err, tbl_path = self._prepare_tool_table_disk_write_path()
        if prep_err is not None:
            return prep_err
        assert tbl_path is not None

        if not self._try_acquire_cmd_lock():
            return GatewayCommandResult(
                ok=False,
                error_code="command_in_progress",
                error_message="Cannot update tool table while another command is being executed.",
            )
        try:
            write_err = _apply_tool_table_row_delete_from_disk(tbl_path, toolno)
            if write_err is not None:
                code, msg = write_err
                return GatewayCommandResult(ok=False, error_code=code, error_message=msg)
            try:
                remove_tool_from_sidecar(tbl_path, toolno)
            except OSError as exc:
                return GatewayCommandResult(
                    ok=False,
                    error_code="handler_failed",
                    error_message=f"Tool sidecar write failed: {exc}",
                )
            return self._finish_tool_table_disk_write_with_optional_reload()
        except Exception as exc:  # noqa: BLE001
            return GatewayCommandResult(
                ok=False,
                error_code="handler_failed",
                error_message=str(exc),
            )
        finally:
            self._release_cmd_lock()

    def add_tool_table_row(self, params: Mapping[str, Any]) -> GatewayCommandResult:
        """
        Append a new ``T… P…`` row if ``toolno`` is not yet present on disk, then reload.
        Preconditions match :meth:`update_tool_table_row`.
        """
        try:
            toolno = int(params.get("toolno", 0))
        except (TypeError, ValueError):
            toolno = 0
        if toolno <= 0:
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message="toolno must be a positive integer.",
            )

        prep_err, tbl_path = self._prepare_tool_table_disk_write_path()
        if prep_err is not None:
            return prep_err
        assert tbl_path is not None

        if not self._try_acquire_cmd_lock():
            return GatewayCommandResult(
                ok=False,
                error_code="command_in_progress",
                error_message="Cannot update tool table while another command is being executed.",
            )
        try:
            p_raw = dict(params)
            p_raw.pop("new_toolno", None)
            p, lc_meta, lc_presets = pop_lcncgui_params(p_raw)
            if lc_meta is not MISSING:
                if isinstance(lc_meta, dict):
                    p["comment"] = short_table_comment_from_meta(lc_meta)
                else:
                    p["comment"] = ""
            write_err = _apply_tool_table_row_append_to_disk(tbl_path, toolno, p)
            if write_err is not None:
                code, msg = write_err
                return GatewayCommandResult(ok=False, error_code=code, error_message=msg)
            if lc_meta is not MISSING or lc_presets is not MISSING:
                try:
                    upsert_tool_in_sidecar(
                        tbl_path, toolno, meta=lc_meta, presets=lc_presets
                    )
                except OSError as exc:
                    return GatewayCommandResult(
                        ok=False,
                        error_code="handler_failed",
                        error_message=f"Tool sidecar write failed: {exc}",
                    )
            return self._finish_tool_table_disk_write_with_optional_reload()
        except Exception as exc:  # noqa: BLE001
            return GatewayCommandResult(
                ok=False,
                error_code="handler_failed",
                error_message=str(exc),
            )
        finally:
            self._release_cmd_lock()

    def set_axis_coordinate(self, axis: str, value: float) -> GatewayCommandResult:
        """
        Set current axis coordinate via gmoccapy-style touch-off command:
        ``G10 L20 P0 <AXIS><VALUE>``.
        """
        axis_norm = str(axis).strip().lower()
        if axis_norm not in _COORD_AXES:
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message=(
                    'axis must be one of "x", "y", "z", "a", "b", "c", "u", "v", "w".'
                ),
            )
        try:
            numeric_value = float(value)
        except (TypeError, ValueError):
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message="value must be a number.",
            )

        gcode = f"G10 L20 P0 {axis_norm.upper()}{numeric_value:f}"
        return self.program_mdi(gcode)

    def _best_effort_manual_after_touch_off_abort(self) -> None:
        """
        After a failed touch-off step following a manual→MDI switch, try to restore manual mode.
        Failures are ignored; :mod:`backend.services.mdi_manual_revert` may still revert later.
        """
        if self._cmd is None or linuxcnc is None:
            return
        lc = linuxcnc
        try:
            self._cmd.mode(int(lc.MODE_MANUAL))
            self._wait_motion_command_result(10.0, "tool_touch_off_abort_manual")
        except Exception:
            pass

    def tool_touch_off(self, axis: str, value: float) -> GatewayCommandResult:
        """
        Gmoccapy-style tool table touch-off: ``G10 L10 P<tool> <AXIS><value>``,
        optional ``G43`` refresh if length compensation is active, then ``MODE_MANUAL``.

        Preconditions mirror ``program_mdi`` (machine ON, enabled, interpreter idle,
        manual or MDI only; from manual, no active jog/motion when switching to MDI).
        Requires a positive ``stat.tool_in_spindle``. Rejects active G41/G42.
        """
        axis_norm = str(axis).strip().lower()
        if axis_norm not in _COORD_AXES:
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message=(
                    'axis must be one of "x", "y", "z", "a", "b", "c", "u", "v", "w".'
                ),
            )
        try:
            numeric_value = float(value)
        except (TypeError, ValueError):
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message="value must be a number.",
            )

        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        lc = linuxcnc
        assert self._stat is not None

        tool_no: int
        need_switch_to_mdi: bool
        g43_refresh: bool

        with self._stat_lock:
            self._stat.poll()
            s = self._stat

            rej = self._reject_unless_machine_on(s, lc)
            if rej is not None:
                return rej

            if not bool(getattr(s, "enabled", True)):
                return GatewayCommandResult(
                    ok=False,
                    error_code="machine_disabled",
                    error_message="Machine is not enabled (stat.enabled is false); cannot tool touch-off.",
                )

            interp_state = int(getattr(s, "interp_state", lc.INTERP_IDLE))
            if interp_state != int(getattr(lc, "INTERP_IDLE", 1)):
                return GatewayCommandResult(
                    ok=False,
                    error_code="interpreter_busy",
                    error_message="Cannot tool touch-off while interpreter is busy.",
                )

            try:
                tool_no = int(getattr(s, "tool_in_spindle", 0) or 0)
            except (TypeError, ValueError):
                tool_no = 0
            if tool_no <= 0:
                return GatewayCommandResult(
                    ok=False,
                    error_code="no_tool_in_spindle",
                    error_message="No tool in spindle (tool_in_spindle must be > 0).",
                )

            cutter_comp, g43_refresh = _tool_touch_off_gcode_flags(s)
            if cutter_comp:
                return GatewayCommandResult(
                    ok=False,
                    error_code="cutter_comp_active",
                    error_message=(
                        "Tool touch-off is not allowed with cutter radius compensation (G41/G42) active."
                    ),
                )

            task_mode = int(getattr(s, "task_mode", lc.MODE_MANUAL))
            if task_mode == lc.MODE_MANUAL:
                try:
                    current_vel = float(getattr(s, "current_vel", 0.0) or 0.0)
                except (TypeError, ValueError):
                    current_vel = 0.0
                motion_type_none = int(getattr(lc, "MOTION_TYPE_NONE", 0))
                try:
                    motion_type = int(getattr(s, "motion_type", motion_type_none))
                except (TypeError, ValueError):
                    motion_type = motion_type_none
                motion_active = abs(current_vel) > 1e-9 or motion_type != motion_type_none
                if motion_active:
                    return GatewayCommandResult(
                        ok=False,
                        error_code="jog_active",
                        error_message="Cannot switch to MDI while jogging/motion is active.",
                    )
                need_switch_to_mdi = True
            elif task_mode == lc.MODE_MDI:
                need_switch_to_mdi = False
            else:
                return GatewayCommandResult(
                    ok=False,
                    error_code="wrong_task_mode",
                    error_message="Tool touch-off is only allowed in manual or MDI mode.",
                )

        if not self._try_acquire_cmd_lock():
            return GatewayCommandResult(
                ok=False,
                error_code="command_in_progress",
                error_message="Cannot tool touch-off while another command is being executed.",
            )

        switched_from_manual_to_mdi = False
        try:
            if need_switch_to_mdi:
                self._cmd.mode(int(lc.MODE_MDI))
                mode_res = self._wait_motion_command_result(10.0, "set_task_mode")
                if not mode_res.ok:
                    return mode_res
                switched_from_manual_to_mdi = True

            g10_line = f"G10 L10 P{tool_no} {axis_norm.upper()}{numeric_value:f}"
            self._cmd.mdi(g10_line)
            mdi_res = self._wait_motion_command_result(
                _TOOL_TOUCH_OFF_MDI_WAIT_TIMEOUT_S, "tool_touch_off_g10l10"
            )
            if not mdi_res.ok:
                if switched_from_manual_to_mdi:
                    self._best_effort_manual_after_touch_off_abort()
                return mdi_res

            if g43_refresh:
                self._cmd.mdi("G43")
                g43_res = self._wait_motion_command_result(
                    _TOOL_TOUCH_OFF_MDI_WAIT_TIMEOUT_S, "tool_touch_off_g43"
                )
                if not g43_res.ok:
                    if switched_from_manual_to_mdi:
                        self._best_effort_manual_after_touch_off_abort()
                    return g43_res

            self._cmd.mode(int(lc.MODE_MANUAL))
            return self._wait_motion_command_result(10.0, "set_task_mode_manual")
        except Exception as exc:  # noqa: BLE001
            if switched_from_manual_to_mdi:
                self._best_effort_manual_after_touch_off_abort()
            return GatewayCommandResult(
                ok=False,
                error_code="handler_failed",
                error_message=str(exc),
            )
        finally:
            self._release_cmd_lock()

    def set_active_coordinate_system(self, system_id: str) -> GatewayCommandResult:
        """
        Activate a coordinate system via MDI (G54..G59.3 or G53 for machine / „0“),
        using the same safety checks as :meth:`program_mdi`.

        If the requested system is already active (per ``stat.g5x_index``), returns
        success with ``noop=True`` (gmoccapy-style).
        """
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        if get_active_system_id is None or mdi_line_for_active_coordinate_system is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="Coordinate system helpers unavailable.",
            )
        assert self._stat is not None

        try:
            canonical = normalize_coordinate_system_id(system_id)
        except ValueError as exc:
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message=str(exc),
            )

        with self._stat_lock:
            self._stat.poll()
            s = self._stat
            if get_active_system_id(s) == canonical:
                return GatewayCommandResult(ok=True, noop=True)

        line = mdi_line_for_active_coordinate_system(canonical)
        return self.program_mdi(line)

    def set_coordinate_system_offset(
        self, system_id: str, axis_values: dict[str, float]
    ) -> GatewayCommandResult:
        """
        Set G54–G59.3 work offsets via ``G10 L2 P<n>`` (LinuxCNC).

        The UI shows ``g5x_offset + g92_offset`` per axis for every WCS row; we
        subtract ``g92`` so the interpreter stores a ``g5x`` value that reproduces
        the displayed total after MDI. On success, ``result["g5x_offsets"]`` holds
        the pure G5x values that were written (for the in-memory cache).
        """
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        if SYSTEM_ID_TO_P is None or display_totals_to_g5x_offsets is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="Coordinate system helpers unavailable.",
            )
        if not axis_values:
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message="At least one axis offset (x, y, z, …) is required.",
            )

        try:
            canonical = normalize_coordinate_system_id(system_id)
        except ValueError as exc:
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message=str(exc),
            )

        if canonical == "0":
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message="Cannot set offsets for machine coordinates (systemId 0 / G53).",
            )

        p_num = SYSTEM_ID_TO_P.get(canonical)
        if p_num is None:
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message=f"Unknown coordinate system for G10: {canonical!r}.",
            )

        numeric: dict[str, float] = {}
        for axis_key, raw_val in axis_values.items():
            ax = str(axis_key).strip().lower()
            if ax not in _COORD_AXES:
                return GatewayCommandResult(
                    ok=False,
                    error_code="invalid_params",
                    error_message=(
                        f'Invalid axis {axis_key!r}; expected one of '
                        f"{', '.join(_COORD_AXES)}."
                    ),
                )
            try:
                numeric[ax] = float(raw_val)
            except (TypeError, ValueError):
                return GatewayCommandResult(
                    ok=False,
                    error_code="invalid_params",
                    error_message=f"Offset for axis {ax!r} must be a number.",
                )
        ordered_axes = [ax for ax in _COORD_AXES if ax in numeric]

        assert self._stat is not None
        with self._stat_lock:
            self._stat.poll()
            s = self._stat
            g92 = getattr(s, "g92_offset", None)
            g5x_written = display_totals_to_g5x_offsets(numeric, g92)
            parts: list[str] = [
                f"{ax.upper()}{g5x_written[ax]:f}" for ax in ordered_axes
            ]

        line = f"G10 L2 P{p_num} " + " ".join(parts)
        mdi_result = self.program_mdi(line)
        if not mdi_result.ok:
            return mdi_result
        return GatewayCommandResult(
            ok=True,
            noop=mdi_result.noop,
            result={"g5x_offsets": g5x_written},
        )

    def _reject_unless_machine_on(
        self, s: Any, linuxcnc_mod: Any
    ) -> GatewayCommandResult | None:
        """Returns a failed GatewayCommandResult if ESTOP/OFF; None if OK to proceed."""
        ts = int(getattr(s, "task_state", linuxcnc_mod.STATE_OFF))
        if ts == linuxcnc_mod.STATE_ESTOP:
            return GatewayCommandResult(
                ok=False,
                error_code="estop_active",
                error_message="Cannot command I/O while ESTOP is active.",
            )
        if ts != linuxcnc_mod.STATE_ON:
            return GatewayCommandResult(
                ok=False,
                error_code="machine_not_on",
                error_message="Machine must be ON (task state ON) for this command.",
            )
        return None

    def set_flood(self, on: bool) -> GatewayCommandResult:
        """Toggle flood coolant (linuxcnc.command.flood). See gmoccapy on_tbtn_flood_toggled."""
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        assert self._stat is not None
        with self._stat_lock:
            self._stat.poll()
            s = self._stat
            rej = self._reject_unless_machine_on(s, linuxcnc)
            if rej is not None:
                return rej

            flood_raw = getattr(s, "flood", 0)
            if hasattr(linuxcnc, "FLOOD_ON"):
                already_on = flood_raw == linuxcnc.FLOOD_ON
            else:
                already_on = bool(flood_raw)

            if on and already_on:
                return GatewayCommandResult(ok=True, noop=True)
            if not on and not already_on:
                return GatewayCommandResult(ok=True, noop=True)

            code = linuxcnc.FLOOD_ON if on else linuxcnc.FLOOD_OFF
            if not self._try_acquire_cmd_lock():
                return GatewayCommandResult(
                    ok=False,
                    error_code="command_in_progress",
                    error_message="Cannot set flood while another command is being executed.",
                )
            try:
                self._cmd.flood(code)
            finally:
                self._release_cmd_lock()
        return GatewayCommandResult(ok=True, noop=False)

    def set_mist(self, on: bool) -> GatewayCommandResult:
        """Toggle mist coolant (linuxcnc.command.mist). See gmoccapy on_tbtn_mist_toggled."""
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        assert self._stat is not None
        with self._stat_lock:
            self._stat.poll()
            s = self._stat
            rej = self._reject_unless_machine_on(s, linuxcnc)
            if rej is not None:
                return rej

            mist_raw = getattr(s, "mist", 0)
            if hasattr(linuxcnc, "MIST_ON"):
                already_on = mist_raw == linuxcnc.MIST_ON
            else:
                already_on = bool(mist_raw)

            if on and already_on:
                return GatewayCommandResult(ok=True, noop=True)
            if not on and not already_on:
                return GatewayCommandResult(ok=True, noop=True)

            code = linuxcnc.MIST_ON if on else linuxcnc.MIST_OFF
            if not self._try_acquire_cmd_lock():
                return GatewayCommandResult(
                    ok=False,
                    error_code="command_in_progress",
                    error_message="Cannot set mist while another command is being executed.",
                )
            try:
                self._cmd.mist(code)
            finally:
                self._release_cmd_lock()
        return GatewayCommandResult(ok=True, noop=False)

    _MIN_FEED_SPINDLE_OVERRIDE = 0.01
    _MAX_FEED_SPINDLE_OVERRIDE = 2.0
    _MIN_RAPID_OVERRIDE = 0.0
    _MAX_RAPID_OVERRIDE = 1.0

    def set_feed_override(self, factor: float) -> GatewayCommandResult:
        """
        Feed override via linuxcnc.command.feedrate; 1.0 = 100%.
        See LinuxCNC python-interface.html ``feedrate(float)``.
        """
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        assert self._stat is not None
        try:
            raw = float(factor)
        except (TypeError, ValueError):
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message="feed override factor must be a number.",
            )
        clamped = max(
            self._MIN_FEED_SPINDLE_OVERRIDE,
            min(raw, self._MAX_FEED_SPINDLE_OVERRIDE),
        )
        with self._stat_lock:
            self._stat.poll()
            s = self._stat
            rej = self._reject_unless_machine_on(s, linuxcnc)
            if rej is not None:
                return rej

            current = float(getattr(s, "feedrate", 1.0))
            if abs(current - clamped) < 1e-5:
                return GatewayCommandResult(ok=True, noop=True)

            if not self._try_acquire_cmd_lock():
                return GatewayCommandResult(
                    ok=False,
                    error_code="command_in_progress",
                    error_message=(
                        "Cannot set feed override while another command is being executed."
                    ),
                )
            try:
                self._cmd.feedrate(clamped)
            finally:
                self._release_cmd_lock()
        return GatewayCommandResult(ok=True, noop=False)

    def set_rapid_override(self, factor: float) -> GatewayCommandResult:
        """
        Rapid override via linuxcnc.command.rapidrate; 1.0 = 100%.
        See LinuxCNC python-interface.html ``rapidrate(float)``.
        """
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        assert self._stat is not None
        try:
            raw = float(factor)
        except (TypeError, ValueError):
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message="rapid override factor must be a number.",
            )
        clamped = max(
            self._MIN_RAPID_OVERRIDE,
            min(raw, self._MAX_RAPID_OVERRIDE),
        )
        with self._stat_lock:
            self._stat.poll()
            s = self._stat
            rej = self._reject_unless_machine_on(s, linuxcnc)
            if rej is not None:
                return rej

            current = float(getattr(s, "rapidrate", 1.0))
            if abs(current - clamped) < 1e-5:
                return GatewayCommandResult(ok=True, noop=True)

            if not self._try_acquire_cmd_lock():
                return GatewayCommandResult(
                    ok=False,
                    error_code="command_in_progress",
                    error_message=(
                        "Cannot set rapid override while another command is being executed."
                    ),
                )
            try:
                self._cmd.rapidrate(clamped)
            finally:
                self._release_cmd_lock()
        return GatewayCommandResult(ok=True, noop=False)

    def set_spindle_override(self, factor: float, spindle_index: int = 0) -> GatewayCommandResult:
        """
        Spindle speed override via linuxcnc.command.spindleoverride; 1.0 = 100%.
        Signature per docs: ``spindleoverride(float [, int])`` (optional spindle index).
        """
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        assert self._stat is not None
        try:
            raw = float(factor)
        except (TypeError, ValueError):
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message="spindle override factor must be a number.",
            )
        clamped = max(
            self._MIN_FEED_SPINDLE_OVERRIDE,
            min(raw, self._MAX_FEED_SPINDLE_OVERRIDE),
        )
        if spindle_index < 0:
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message="spindle index must be >= 0.",
            )

        with self._stat_lock:
            self._stat.poll()
            s = self._stat
            rej = self._reject_unless_machine_on(s, linuxcnc)
            if rej is not None:
                return rej

            spindles = getattr(s, "spindle", ()) or ()
            if spindle_index >= len(spindles):
                return GatewayCommandResult(
                    ok=False,
                    error_code="invalid_params",
                    error_message=f"Invalid spindle index {spindle_index}.",
                )
            sp0 = spindles[spindle_index]
            if isinstance(sp0, Mapping):
                current = float(sp0.get("override", 1.0))
            else:
                current = float(getattr(sp0, "override", 1.0))
            if abs(current - clamped) < 1e-5:
                return GatewayCommandResult(ok=True, noop=True)

            if not self._try_acquire_cmd_lock():
                return GatewayCommandResult(
                    ok=False,
                    error_code="command_in_progress",
                    error_message=(
                        "Cannot set spindle override while another command is being executed."
                    ),
                )
            try:
                # LinuxCNC: ``spindleoverride(float [, int])``; single-arg uses spindle 0.
                if spindle_index == 0:
                    self._cmd.spindleoverride(clamped)
                else:
                    self._cmd.spindleoverride(clamped, spindle_index)
            finally:
                self._release_cmd_lock()
        return GatewayCommandResult(ok=True, noop=False)

    def set_spindle(
        self,
        direction: str,
        speed_rpm: Optional[float] = None,
        spindle_index: int = 0,
    ) -> GatewayCommandResult:
        """
        Spindle forward / reverse / stop (linuxcnc.command.spindle).

        Commands the programmed S (or ``speed_rpm``) as-is; LinuxCNC multiplies by
        the current spindle override. Preconditions follow gmoccapy ``_set_spindle``.
        """
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        assert self._stat is not None

        d = direction.strip().lower()
        # Handler validates via Pydantic; keep this for direct gateway callers.
        if d not in ("forward", "reverse", "stop"):
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message='direction must be "forward", "reverse", or "stop".',
            )

        with self._stat_lock:
            self._stat.poll()
            s = self._stat
            ts = int(getattr(s, "task_state", linuxcnc.STATE_OFF))
            if ts == linuxcnc.STATE_ESTOP:
                return GatewayCommandResult(
                    ok=False,
                    error_code="estop_active",
                    error_message="Cannot command spindle while ESTOP is active.",
                )

            mode = int(getattr(s, "task_mode", linuxcnc.MODE_MANUAL))
            interp = int(getattr(s, "interp_state", linuxcnc.INTERP_IDLE))
            if mode != linuxcnc.MODE_MANUAL:
                if interp in (
                    linuxcnc.INTERP_READING,
                    linuxcnc.INTERP_WAITING,
                ):
                    return GatewayCommandResult(
                        ok=False,
                        error_code="interpreter_busy",
                        error_message=(
                            "Spindle command rejected while interpreter is busy "
                            "(non-manual mode with INTERP_READING / INTERP_WAITING)."
                        ),
                    )

            spindles = getattr(s, "spindle", ())
            if spindle_index < 0 or spindle_index >= len(spindles):
                return GatewayCommandResult(
                    ok=False,
                    error_code="invalid_params",
                    error_message=f"Invalid spindle index {spindle_index}.",
                )

            settings = getattr(s, "settings", (0.0, 0.0, 0.0))
            s_speed = float(settings[2]) if len(settings) > 2 else 0.0

            if speed_rpm is not None and speed_rpm > 0:
                desired_rpm = float(speed_rpm)
            elif s_speed > 0:
                desired_rpm = s_speed
            else:
                desired_rpm = _DEFAULT_SPINDLE_SPEED_RPM

            if desired_rpm > _MAX_SPINDLE_COMMAND_RPM:
                desired_rpm = _MAX_SPINDLE_COMMAND_RPM
            elif desired_rpm < 0:
                desired_rpm = 0.0

            # Do not divide by override; LinuxCNC multiplies (speed-out = commanded × ov).
            fwd = getattr(linuxcnc, "SPINDLE_FORWARD", 1)
            rev = getattr(linuxcnc, "SPINDLE_REVERSE", -1)
            off = getattr(linuxcnc, "SPINDLE_OFF", 0)

            if not self._try_acquire_cmd_lock():
                return GatewayCommandResult(
                    ok=False,
                    error_code="command_in_progress",
                    error_message="Cannot command spindle while another command is being executed.",
                )
            try:
                if d == "stop":
                    # gmoccapy: command.spindle(0)
                    self._cmd.spindle(off, 0, spindle_index)
                elif d == "forward":
                    self._cmd.spindle(fwd, desired_rpm, spindle_index)
                else:
                    self._cmd.spindle(rev, abs(desired_rpm), spindle_index)
            finally:
                self._release_cmd_lock()

        return GatewayCommandResult(ok=True, noop=False)

    def _jog_validate_context(
        self,
        s: Any,
        lc: Any,
        joint_mode: bool,
    ) -> tuple[Optional[GatewayCommandResult], bool]:
        """
        gmoccapy-style checks: machine on, not ESTOP, stat.enabled, MODE_MANUAL,
        motion_mode matches joint vs axis jog request; non-trivial kinematics.

        Returns (error_result_or_none, joint_flag_for_api) where joint_flag_for_api
        is the bool passed to linuxcnc.command.jog (True = joint, False = axis).
        """
        rej = self._reject_unless_machine_on(s, lc)
        if rej is not None:
            return rej, joint_mode

        if not bool(getattr(s, "enabled", True)):
            return (
                GatewayCommandResult(
                    ok=False,
                    error_code="machine_disabled",
                    error_message="Machine is not enabled (stat.enabled is false); cannot jog.",
                ),
                joint_mode,
            )

        task_mode = int(getattr(s, "task_mode", lc.MODE_MANUAL))
        if task_mode != lc.MODE_MANUAL:
            return (
                GatewayCommandResult(
                    ok=False,
                    error_code="wrong_task_mode",
                    error_message="Jogging is only allowed in manual mode (MODE_MANUAL).",
                ),
                joint_mode,
            )

        motion_mode = int(getattr(s, "motion_mode", lc.TRAJ_MODE_TELEOP))
        traj_free = int(getattr(lc, "TRAJ_MODE_FREE", 1))
        traj_teleop = int(getattr(lc, "TRAJ_MODE_TELEOP", 3))

        kin = int(getattr(s, "kinematics_type", lc.KINEMATICS_IDENTITY))
        kin_identity = int(getattr(lc, "KINEMATICS_IDENTITY", 1))

        if joint_mode:
            if motion_mode != traj_free:
                return (
                    GatewayCommandResult(
                        ok=False,
                        error_code="jog_wrong_motion_mode",
                        error_message=(
                            "Joint jogging requires trajectory free mode "
                            f"(motion_mode={traj_free}); "
                            f"current motion_mode={motion_mode}."
                        ),
                    ),
                    joint_mode,
                )
        else:
            if motion_mode != traj_teleop:
                if (
                    kin != kin_identity
                    and motion_mode == traj_free
                    and not joint_mode
                ):
                    return (
                        GatewayCommandResult(
                            ok=False,
                            error_code="jog_kinematics_conflict",
                            error_message=(
                                "Axis jogging is only allowed in world/teleop mode, "
                                "but the machine is in joint mode (non-trivial kinematics)."
                            ),
                        ),
                        joint_mode,
                    )
                return (
                    GatewayCommandResult(
                        ok=False,
                        error_code="jog_wrong_motion_mode",
                        error_message=(
                            "Axis jogging requires teleop mode "
                            f"(motion_mode={traj_teleop}); "
                            f"current motion_mode={motion_mode}."
                        ),
                    ),
                    joint_mode,
                )

        joint_flag = bool(joint_mode)
        return None, joint_flag

    def _jog_validate_index(self, s: Any, joint_flag: bool, index: int) -> Optional[GatewayCommandResult]:
        if index < 0 or index > 8:
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message="index must be between 0 and 8 (X..W axis or joint index).",
            )
        if joint_flag:
            n = int(getattr(s, "joints", 0))
            if n <= 0:
                n = len(getattr(s, "joint", ()))
            if n <= 0:
                return GatewayCommandResult(
                    ok=False,
                    error_code="invalid_params",
                    error_message="Cannot determine joint count from LinuxCNC status.",
                )
            if index >= n:
                return GatewayCommandResult(
                    ok=False,
                    error_code="invalid_params",
                    error_message=f"joint index must be < {n} (joints in configuration).",
                )
        else:
            n_axes = len(getattr(s, "axis", ()))
            if n_axes <= 0:
                n_axes = int(getattr(s, "axes", 0))
            if n_axes <= 0:
                return GatewayCommandResult(
                    ok=False,
                    error_code="invalid_params",
                    error_message="Cannot determine axis count from LinuxCNC status.",
                )
            if index >= n_axes:
                return GatewayCommandResult(
                    ok=False,
                    error_code="invalid_params",
                    error_message=f"axis index must be < {n_axes} (axes in configuration).",
                )
        return None

    def jog_motion(
        self,
        joint_mode: bool,
        index: int,
        velocity_per_min: float,
        mode: str,
        distance: Optional[float] = None,
    ) -> GatewayCommandResult:
        """
        Jog one joint or axis (linuxcnc.command.jog). See gmoccapy _on_btn_jog_pressed.

        ``velocity_per_min`` is signed: machine units per minute (linear); internally
        converted to per-second for the API. ``mode`` is \"continuous\" or \"increment\".
        """
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        assert self._stat is not None
        lc = linuxcnc

        jog_cont = int(getattr(lc, "JOG_CONTINUOUS", 1))
        jog_inc = int(getattr(lc, "JOG_INCREMENT", 2))

        if mode not in ("continuous", "increment"):
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message='mode must be \"continuous\" or \"increment\".',
            )
        if mode == "increment":
            if distance is None:
                return GatewayCommandResult(
                    ok=False,
                    error_code="invalid_params",
                    error_message='incremental jog requires params.distance > 0.',
                )
            if distance <= 0:
                return GatewayCommandResult(
                    ok=False,
                    error_code="invalid_params",
                    error_message="distance must be positive for incremental jog.",
                )
        elif distance is not None:
            return GatewayCommandResult(
                ok=False,
                error_code="invalid_params",
                error_message="distance must be omitted for continuous jog.",
            )

        with self._stat_lock:
            self._stat.poll()
            s = self._stat

            err, joint_flag = self._jog_validate_context(s, lc, joint_mode)
            if err is not None:
                return err

            ierr = self._jog_validate_index(s, joint_flag, index)
            if ierr is not None:
                return ierr

            # gmoccapy: linear jog slider is per-minute; API expects per-second speed.
            speed = float(velocity_per_min) / 60.0
            if speed == 0.0:
                return GatewayCommandResult(
                    ok=False,
                    error_code="invalid_params",
                    error_message="velocity must be non-zero for jog.",
                )

            if not self._try_acquire_cmd_lock():
                return GatewayCommandResult(
                    ok=False,
                    error_code="command_in_progress",
                    error_message="Cannot start jog while another command is being executed.",
                )
            try:
                if mode == "continuous":
                    self._cmd.jog(jog_cont, joint_flag, index, speed)
                else:
                    assert distance is not None
                    self._cmd.jog(jog_inc, joint_flag, index, speed, float(distance))
            finally:
                self._release_cmd_lock()

        return GatewayCommandResult(ok=True, noop=False)

    def jog_stop(self, joint_mode: bool, index: int) -> GatewayCommandResult:
        """
        Stop continuous jog for one joint or axis (linuxcnc.command.jog JOG_STOP).
        See gmoccapy _on_btn_jog_released.
        """
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        assert self._stat is not None
        lc = linuxcnc
        jog_stop = int(getattr(lc, "JOG_STOP", 0))

        with self._stat_lock:
            self._stat.poll()
            s = self._stat

            err, joint_flag = self._jog_validate_context(s, lc, joint_mode)
            if err is not None:
                return err

            ierr = self._jog_validate_index(s, joint_flag, index)
            if ierr is not None:
                return ierr

            if not self._try_acquire_cmd_lock():
                return GatewayCommandResult(
                    ok=False,
                    error_code="command_in_progress",
                    error_message="Cannot stop jog while another command is being executed.",
                )
            try:
                self._cmd.jog(jog_stop, joint_flag, index)
            finally:
                self._release_cmd_lock()

        return GatewayCommandResult(ok=True, noop=False)

    def _poll_error_channel_text(self) -> Optional[str]:
        """Drain linuxcnc.error_channel and return the last message text, if any."""
        if self._ec is None:
            return None
        last: Optional[str] = None
        with self._ec_lock:
            while True:
                err = self._ec.poll()
                if not err:
                    break
                _kind, text = err
                if text:
                    last = str(text).strip() or last
        return last

    def poll_error_channel_once(self) -> Optional[tuple[str, str]]:
        """
        Read at most one error-channel message (for background broadcast).
        Returns ``(kind, message)`` with ``kind`` a short slug, or ``None``.
        """
        if self._ec is None or linuxcnc is None:
            return None
        with self._ec_lock:
            err = self._ec.poll()
            if not err:
                return None
            kind_int, text = err
            kind_str = _linuxcnc_error_kind_slug(int(kind_int), linuxcnc)
            msg = str(text).strip() if text else ""
            if not msg:
                return None
            return (kind_str, msg)

    def _wait_motion_command_result(
        self, timeout_s: float, operation: str
    ) -> GatewayCommandResult:
        """
        After ``command.home`` / ``command.unhome``, wait for completion.

        LinuxCNC ``wait_complete`` returns ``RCS_DONE``, ``RCS_ERROR``, or ``-1`` (timeout).
        On failure, read operator/NML text from ``error_channel`` (see Python interface docs).

        Hold ``_cmd_lock`` for the whole home/unhome sequence including this call.
        Must be called **without** holding ``_stat_lock`` — wait can block a long time.
        """
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        lc = linuxcnc
        # Caller must hold ``_cmd_lock`` (same critical section as ``home`` / ``unhome``).
        rc = int(self._cmd.wait_complete(float(timeout_s)))
        rcs_done = int(getattr(lc, "RCS_DONE", 1))
        rcs_error = int(getattr(lc, "RCS_ERROR", 3))

        if rc == -1:
            extra = self._poll_error_channel_text()
            msg = (
                f"{operation}: timed out after {timeout_s:.0f}s waiting for LinuxCNC "
                "to finish (wait_complete)."
            )
            if extra:
                msg = f"{msg} Error channel: {extra}"
            return GatewayCommandResult(
                ok=False,
                error_code="command_timeout",
                error_message=msg,
            )

        if rc == rcs_error:
            detail = self._poll_error_channel_text()
            msg = detail or f"{operation}: LinuxCNC reported command failure (RCS_ERROR)."
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_command_failed",
                error_message=msg,
            )

        if rc == rcs_done:
            return GatewayCommandResult(ok=True, noop=False)

        return GatewayCommandResult(
            ok=False,
            error_code="linuxcnc_unexpected_status",
            error_message=f"{operation}: unexpected wait_complete return code {rc}.",
        )

    def _any_joint_homing(self, s: Any) -> bool:
        """True if any joint is currently performing a homing move (gmoccapy pre-check)."""
        n = int(getattr(s, "joints", 0) or 0)
        joints = getattr(s, "joint", ()) or ()
        if n <= 0:
            n = len(joints)
        for j in range(n):
            if j >= len(joints):
                break
            jd = joints[j]
            if isinstance(jd, dict):
                if bool(jd.get("homing")):
                    return True
            elif bool(getattr(jd, "homing", False)):
                return True
        return False

    def _joint_count(self, s: Any) -> int:
        n = int(getattr(s, "joints", 0) or 0)
        if n > 0:
            return n
        joints = getattr(s, "joint", ()) or ()
        return len(joints)

    def _home_unhome_validate(
        self, s: Any, lc: Any, *, for_home: bool
    ) -> Optional[GatewayCommandResult]:
        """
        Shared checks for home / unhome (gmoccapy: machine on, manual mode, joint mode prep).

        ``for_home`` adds: no joint may already be in a homing sequence.
        """
        rej = self._reject_unless_machine_on(s, lc)
        if rej is not None:
            return rej

        if not bool(getattr(s, "enabled", True)):
            return GatewayCommandResult(
                ok=False,
                error_code="machine_disabled",
                error_message="Machine is not enabled (stat.enabled is false); cannot home or unhome.",
            )

        task_mode = int(getattr(s, "task_mode", lc.MODE_MANUAL))
        if task_mode != lc.MODE_MANUAL:
            return GatewayCommandResult(
                ok=False,
                error_code="wrong_task_mode",
                error_message="Homing is only allowed in manual mode (MODE_MANUAL).",
            )

        interp = int(getattr(s, "interp_state", lc.INTERP_IDLE))
        if interp != lc.INTERP_IDLE:
            return GatewayCommandResult(
                ok=False,
                error_code="interpreter_busy",
                error_message="Cannot home or unhome while the interpreter is not idle.",
            )

        if for_home and self._any_joint_homing(s):
            return GatewayCommandResult(
                ok=False,
                error_code="homing_in_progress",
                error_message=(
                    "Homing is not possible until the current homing process has finished."
                ),
            )

        return None

    def _teleop_enable_joint_mode(self, lc: Any) -> None:
        """Gmoccapy _set_motion_mode(0): joint trajectory mode before home/unhome."""
        assert self._cmd is not None
        self._cmd.teleop_enable(0)
        self._cmd.wait_complete()

    def home_motion_precheck(self, joint: int) -> GatewayCommandResult:
        """
        Validate homing preconditions without issuing motion commands.
        Used for async command protocol (immediate ACK, completion later).
        """
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        assert self._stat is not None
        lc = linuxcnc
        with self._stat_lock:
            self._stat.poll()
            s = self._stat

            err = self._home_unhome_validate(s, lc, for_home=True)
            if err is not None:
                return err

            n = self._joint_count(s)
            if n <= 0:
                return GatewayCommandResult(
                    ok=False,
                    error_code="invalid_params",
                    error_message="Cannot determine joint count from LinuxCNC status.",
                )
            if joint != -1 and (joint < 0 or joint >= n):
                return GatewayCommandResult(
                    ok=False,
                    error_code="invalid_params",
                    error_message=f"joint must be -1 (all) or 0..{n - 1}; got {joint}.",
                )
            reserve_err = self._reserve_homing_job("home")
            if reserve_err is not None:
                return reserve_err
        return GatewayCommandResult(ok=True, noop=False)

    def unhome_motion_precheck(self, joint: int) -> GatewayCommandResult:
        """Validate unhome preconditions without issuing motion commands."""
        if self._cmd is None or linuxcnc is None:
            return GatewayCommandResult(
                ok=False,
                error_code="linuxcnc_unavailable",
                error_message="LinuxCNC Python module or command channel not available.",
            )
        assert self._stat is not None
        lc = linuxcnc
        with self._stat_lock:
            self._stat.poll()
            s = self._stat

            err = self._home_unhome_validate(s, lc, for_home=False)
            if err is not None:
                return err

            n = self._joint_count(s)
            if n <= 0:
                return GatewayCommandResult(
                    ok=False,
                    error_code="invalid_params",
                    error_message="Cannot determine joint count from LinuxCNC status.",
                )
            if joint != -1 and (joint < 0 or joint >= n):
                return GatewayCommandResult(
                    ok=False,
                    error_code="invalid_params",
                    error_message=f"joint must be -1 (all) or 0..{n - 1}; got {joint}.",
                )

            if self._any_joint_homing(s):
                return GatewayCommandResult(
                    ok=False,
                    error_code="homing_in_progress",
                    error_message="Cannot unhome while a homing sequence is active.",
                )
            reserve_err = self._reserve_homing_job("unhome")
            if reserve_err is not None:
                return reserve_err
        return GatewayCommandResult(ok=True, noop=False)

    def home_motion_execute(self, joint: int) -> GatewayCommandResult:
        """Execute home motion (reservation already done by home_motion_precheck)."""
        lc = linuxcnc
        try:
            with self._cmd_lock:
                self._teleop_enable_joint_mode(lc)
                self._cmd.home(joint)
                return self._wait_motion_command_result(_HOME_WAIT_TIMEOUT_S, "home")
        finally:
            self._clear_homing_job()

    def unhome_motion_execute(self, joint: int) -> GatewayCommandResult:
        """Execute unhome motion (reservation already done by unhome_motion_precheck)."""
        lc = linuxcnc
        try:
            with self._cmd_lock:
                self._teleop_enable_joint_mode(lc)
                self._cmd.unhome(joint)
                return self._wait_motion_command_result(_UNHOME_WAIT_TIMEOUT_S, "unhome")
        finally:
            self._clear_homing_job()

    def home_motion(self, joint: int) -> GatewayCommandResult:
        """
        Reference/homing (linuxcnc.command.home). ``joint`` is -1 for all joints, else joint index.

        Gmoccapy: switch to joint mode (teleop_enable 0), then home(joint).
        """
        pre = self.home_motion_precheck(joint)
        if not pre.ok:
            return pre
        return self.home_motion_execute(joint)

    def unhome_motion(self, joint: int) -> GatewayCommandResult:
        """
        Clear homed flags (linuxcnc.command.unhome). ``joint`` is -1 for all, else joint index.

        Gmoccapy: joint mode (teleop_enable 0), then unhome(joint).
        """
        pre = self.unhome_motion_precheck(joint)
        if not pre.ok:
            return pre
        return self.unhome_motion_execute(joint)

    def get_status_snapshot(self) -> Dict[str, Any]:
        if self._stat is not None and linuxcnc is not None:
            # Parse tool file outside _stat_lock: _resolve_ini_path() may poll stat and
            # also takes _stat_lock — avoid deadlock with the snapshot critical section.
            pocket_by_tool, comment_by_tool = self._load_tool_table_maps_from_disk()
            sidecar_doc: Dict[str, Any] = {}
            ini_snap = self._resolve_ini_path()
            if ini_snap:
                tbl_snap = _resolve_tool_table_path_from_ini(ini_snap)
                if tbl_snap and os.path.isfile(tbl_snap):
                    sidecar_doc = load_tool_sidecar(tbl_snap)
            # Until success: fill inactive WCS G5x cache from PARAMETER_FILE.
            if ensure_stored_offsets_hydrated_from_ini is not None:
                ensure_stored_offsets_hydrated_from_ini(ini_snap)
            # HAL feedback uses halcmd subprocesses — keep outside _stat_lock (see tool file load above).
            hal_softkeys = self.get_hal_softkey_feedback()
            with self._stat_lock:
                self._stat.poll()
                s = self._stat

                mode_int = int(getattr(s, "task_mode", linuxcnc.MODE_MANUAL))
                task_state_int = int(getattr(s, "task_state", linuxcnc.STATE_OFF))
                if task_state_int == 0:
                    task_state_int = int(linuxcnc.STATE_OFF)
                error = (
                    getattr(s, "estop", linuxcnc.STATE_ESTOP_RESET) == linuxcnc.STATE_ESTOP
                )

                self._power_on = task_state_int == linuxcnc.STATE_ON

                machine_payload: Dict[str, Any] = {
                    "task_mode": mode_int,
                    # RAW passt direkt zu linuxcnc.stat.task_state
                    "task_state": task_state_int,
                    "error": error,
                    "powerOn": self._power_on,
                    "speed": getattr(s, "feedrate", 1.0),
                }
                axis_mask_val: int | None = None
                axis_mask_raw = getattr(s, "axis_mask", None)
                if axis_mask_raw is not None:
                    try:
                        axis_mask_val = int(axis_mask_raw)
                    except (TypeError, ValueError):
                        axis_mask_val = None
                # Immer setzen (auch None), damit der Store keinen veralteten axis_mask behält.
                machine_payload["axis_mask"] = axis_mask_val
                if axis_mask_val is None:
                    ini_tp = self._resolve_ini_path()
                    hint = _read_traj_coordinates_line_scan(ini_tp) if ini_tp else None
                    machine_payload["traj_coordinates_hint"] = hint
                else:
                    machine_payload["traj_coordinates_hint"] = None

                snapshot: Dict[str, Any] = {
                    "machine": machine_payload,
                    "motion": {
                        "actual_position": list(
                            getattr(s, "actual_position", (0.0, 0.0, 0.0))
                        )[:3],
                        # Per JOINT, nicht per Achse: stat.homed[j] gehoert zu Joint j.
                        # Auf trivkins coordinates=xyyz ist Z Joint 3, also darf hier
                        # nicht auf drei Eintraege gekuerzt werden.
                        "homed": list(getattr(s, "homed", (0, 0, 0))),
                        "g5x_index": getattr(s, "g5x_index", 0),
                        "g5x_offset": list(getattr(s, "g5x_offset", (0.0,) * 9)),
                        "g92_offset": list(getattr(s, "g92_offset", (0.0,) * 9)),
                        # Aktuelle Achs-Offsets des geladenen Tools (linuxcnc.stat.tool_offset; u.a. G43)
                        "tool_offset": list(getattr(s, "tool_offset", (0.0,) * 9)),
                    },
                    "io": {
                        "din": list(getattr(s, "din", ())),
                        "dout": list(getattr(s, "dout", ())),
                        "flood": _boolish_to_int(getattr(s, "flood", 0)),
                        "mist": _boolish_to_int(getattr(s, "mist", 0)),
                        "hal_softkeys": hal_softkeys,
                    },
                    "program": {
                        "file": (
                            None
                            if not getattr(s, "file", None)
                            else _coerce_json_scalar(getattr(s, "file", None))
                        ),
                        "gcodes": list(getattr(s, "gcodes", ())),
                        "mcodes": list(getattr(s, "mcodes", ())),
                        "settings": [
                            _coerce_json_scalar(x)
                            for x in list(getattr(s, "settings", ()))
                        ],
                        "current_line": _optional_stat_int(s, "current_line"),
                        "motion_line": _optional_stat_int(s, "motion_line"),
                        "read_line": _optional_stat_int(s, "read_line"),
                        "interp_state": int(
                            getattr(
                                s,
                                "interp_state",
                                getattr(linuxcnc, "INTERP_IDLE", 1),
                            )
                        ),
                    },
                    "overrides": {
                        "feedrate": getattr(s, "feedrate", 1.0),
                        "rapidrate": getattr(s, "rapidrate", 1.0),
                    },
                    "spindle": _serialize_spindle_list(s),
                    "joints": list(getattr(s, "joint", ())),
                    "axes": list(getattr(s, "axis", ())),
                    "tools": {
                        "tool_in_spindle": getattr(s, "tool_in_spindle", 0),
                        "tool_table": _serialize_tool_table(
                            s,
                            pocket_by_tool=pocket_by_tool,
                            comment_by_tool=comment_by_tool,
                            sidecar_doc=sidecar_doc,
                        ),
                        "pocket_prepped": _coerce_json_scalar(
                            getattr(s, "pocket_prepped", None)
                        ),
                        "tool_from_pocket": _coerce_json_scalar(
                            getattr(s, "tool_from_pocket", None)
                        ),
                    },
                }

                if list_coordinate_systems is not None:
                    try:
                        snapshot["coordinate_systems"] = list_coordinate_systems(s)
                    except (AttributeError, TypeError, ValueError):
                        pass

                return snapshot

        return {
            "machine": {
                "task_mode": None,
                "task_state": None,
                "error": False,
                "powerOn": self._power_on,
                "speed": 1.0,
                "axis_mask": None,
                "traj_coordinates_hint": None,
            },
            "motion": {
                "actual_position": [0.0, 0.0, 0.0],
                "homed": [0, 0, 0],
                "g5x_index": 0,
                "g5x_offset": [0.0] * 9,
                "g92_offset": [0.0] * 9,
                "tool_offset": [0.0] * 9,
            },
            "io": {"din": [], "dout": [], "flood": 0, "mist": 0, "hal_softkeys": {}},
            "program": {
                "file": None,
                "gcodes": [],
                "mcodes": [],
                "settings": [],
                "current_line": None,
                "motion_line": None,
                "read_line": None,
                "interp_state": 1,
            },
            "overrides": {"feedrate": 1.0, "rapidrate": 1.0},
            "spindle": [],
            "joints": [],
            "axes": [],
            "tools": {
                "tool_in_spindle": 0,
                "tool_table": [],
                "pocket_prepped": None,
                "tool_from_pocket": None,
            },
        }

    def get_display_coordinates(self) -> Dict[str, float]:
        """
        Liefert die aktuell anzuzeigenden Koordinatenwerte (Gmoccapy-/LinuxCNC-DRO-Logik):
        display = actual_position - g5x - g92 - tool_offset

        Ohne ``tool_offset`` würde die Anzeige bei G43 / nach ``G10 L10`` Touch-Off nicht
        mit dem Interpreter übereinstimmen (Werkzeuglänge fehlt in der Subtraktion).

        Das ist explizit für das schnelle Coordinate-onChange Event gedacht,
        daher bleibt der Payload klein (nur Koordinatenwerte).
        """
        # Aktuell werden im UI alle Achsen über Coordinates geführt; fehlende Werte
        # bleiben bei den aufrufenden Mappings unverändert.
        axes = _COORD_AXES

        if self._stat is not None and linuxcnc is not None:
            # We can be called from multiple async tasks. Serialize poll+read.
            with self._stat_lock:
                self._stat.poll()
                s = self._stat

                actual_position = list(
                    getattr(s, "actual_position", (0.0,) * len(axes))
                )  # type: ignore[arg-type]
                actual_position = (actual_position + [0.0] * len(axes))[: len(axes)]

                offsets: Dict[str, float] = {}
                if get_active_coordinate_system_offsets is not None:
                    try:
                        offsets = get_active_coordinate_system_offsets(s)
                    except Exception:
                        offsets = {}

                tool_off = getattr(s, "tool_offset", None)
                tool_by_axis: Dict[str, float] = {}
                if isinstance(tool_off, (list, tuple)) and len(tool_off) >= len(axes):
                    for i, ax in enumerate(axes):
                        try:
                            tool_by_axis[ax] = float(tool_off[i])
                        except (TypeError, ValueError):
                            tool_by_axis[ax] = 0.0
                else:
                    tool_by_axis = {ax: 0.0 for ax in axes}

                return {
                    axis: float(actual_position[idx])
                    - float(offsets.get(axis, 0.0))
                    - float(tool_by_axis.get(axis, 0.0))
                    for idx, axis in enumerate(axes)
                }

        # Simulation / ohne linuxcnc: keine valide Bewegung möglich.
        return {axis: 0.0 for axis in axes}
