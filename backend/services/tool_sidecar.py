"""
plasmaweb tool library sidecar: meta + presets per LinuxCNC tool number (T).

Stored next to [EMCIO] TOOL_TABLE as ``<basename>.lcncgui-tools.json``.
LinuxCNC reads only the .tbl file; this module is the source of truth for UI metadata.
"""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from typing import Any, Final, Mapping, MutableMapping, Optional

TOOLS_SIDECAR_SUFFIX: Final[str] = ".lcncgui-tools.json"
SIDECAR_VERSION: Final[int] = 1
_MAX_TABLE_COMMENT_LEN: Final[int] = 200

# Populated from params alongside CNC fields; sentinel = key absent from request.
MISSING = object()

_VALID_META_STR_KEYS = frozenset({"name", "type", "material", "comment"})


def sidecar_path_for_tool_table(tool_table_path: str) -> str:
    """``/cfg/tools.tbl`` → ``/cfg/tools.lcncgui-tools.json``."""
    p = os.path.abspath(os.path.expanduser(tool_table_path))
    base, _ext = os.path.splitext(p)
    return base + TOOLS_SIDECAR_SUFFIX


def short_table_comment_from_meta(meta: Mapping[str, Any]) -> str:
    """Single-line comment after ``;`` on the tool line (LinuxCNC length limit)."""
    raw = meta.get("name")
    if raw is None:
        return ""
    s = str(raw).strip().replace("\r", " ").replace("\n", " ")
    if not s:
        return ""
    return s[:_MAX_TABLE_COMMENT_LEN]


def _normalize_meta(meta: Any) -> dict[str, Any]:
    if not isinstance(meta, Mapping):
        return {}
    out: dict[str, Any] = {}
    for k in _VALID_META_STR_KEYS:
        if k not in meta:
            continue
        v = meta[k]
        if v is None:
            continue
        s = str(v).strip()
        if s:
            out[k] = s
    if "numberOfFlutes" in meta:
        try:
            n = int(meta["numberOfFlutes"])
            if n >= 0:
                out["numberOfFlutes"] = n
        except (TypeError, ValueError):
            pass
    if "flutesLength" in meta:
        try:
            f = float(meta["flutesLength"])
            if f >= 0:
                out["flutesLength"] = f
        except (TypeError, ValueError):
            pass
    return out


_PRESET_FLOAT_KEYS: frozenset[str] = frozenset(
    {
        "spindle_rpm",
        "ramp_spindle_rpm",
        "surface_speed_m_per_min",
        "feed_mm_min",
        "feed_per_tooth_mm",
        "lead_in_feed_mm_min",
        "lead_out_feed_mm_min",
        "transition_feed_mm_min",
        "helix_feed_mm_min",
        "ramp_angle_deg",
        "plunge_mm_min",
        "plunge_feed_per_rev_mm",
        "max_stepdown_mm",
        "max_stepover_mm",
    }
)
_PRESET_BOOL_KEYS: frozenset[str] = frozenset({"use_stepdown", "use_stepover"})
_VALID_PRESET_COOLANT: frozenset[str] = frozenset(
    {
        "off",
        "flood",
        "mist",
        "through_tool",
        "external_water",
        "air",
    }
)


def _preset_has_substance(entry: dict[str, Any]) -> bool:
    if entry.get("name"):
        return True
    for k in _PRESET_FLOAT_KEYS:
        if k in entry:
            return True
    for k in _PRESET_BOOL_KEYS:
        if entry.get(k) is True:
            return True
    if entry.get("coolant"):
        return True
    return False


def _normalize_presets(presets: Any) -> list[dict[str, Any]]:
    if not isinstance(presets, list):
        return []
    out: list[dict[str, Any]] = []
    for item in presets:
        if not isinstance(item, Mapping):
            continue
        entry: dict[str, Any] = {}
        pid = item.get("id")
        if pid is not None and str(pid).strip():
            entry["id"] = str(pid).strip()
        else:
            entry["id"] = str(uuid.uuid4())
        name = item.get("name")
        entry["name"] = str(name).strip() if name is not None else ""
        for k in _PRESET_FLOAT_KEYS:
            if k not in item:
                continue
            try:
                v = float(item[k])
                if v >= 0:
                    entry[k] = v
            except (TypeError, ValueError):
                pass
        for k in _PRESET_BOOL_KEYS:
            if k not in item:
                continue
            raw = item[k]
            if raw is True or raw is False:
                entry[k] = bool(raw)
            elif isinstance(raw, (int, float)) and raw in (0, 1):
                entry[k] = bool(int(raw))
            elif isinstance(raw, str) and raw.lower() in ("true", "1", "yes", "on"):
                entry[k] = True
            elif isinstance(raw, str) and raw.lower() in ("false", "0", "no"):
                entry[k] = False
        cool = item.get("coolant")
        if cool is not None:
            cs = str(cool).strip()
            if cs and cs in _VALID_PRESET_COOLANT:
                entry["coolant"] = cs
        c = item.get("comment")
        if c is not None and str(c).strip():
            entry["comment"] = str(c).strip()[:500]
        if _preset_has_substance(entry):
            out.append(entry)
    return out


def default_sidecar_document() -> dict[str, Any]:
    return {"version": SIDECAR_VERSION, "tools": {}}


def load_tool_sidecar(tool_table_path: str) -> dict[str, Any]:
    path = sidecar_path_for_tool_table(tool_table_path)
    if not os.path.isfile(path):
        return default_sidecar_document()
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return default_sidecar_document()
    if not isinstance(data, dict):
        return default_sidecar_document()
    ver = data.get("version")
    if ver is not None:
        try:
            ver_int = int(ver)
        except (TypeError, ValueError):
            ver_int = None
        if ver_int is not None and ver_int != SIDECAR_VERSION:
            # Future: migrations; for now accept and coerce shell.
            pass
    tools = data.get("tools")
    if not isinstance(tools, dict):
        tools = {}
    return {"version": SIDECAR_VERSION, "tools": tools}


def save_tool_sidecar_atomic(tool_table_path: str, doc: Mapping[str, Any]) -> None:
    path = sidecar_path_for_tool_table(tool_table_path)
    directory = os.path.dirname(os.path.abspath(path)) or "."
    payload = json.dumps(
        {"version": int(doc.get("version", SIDECAR_VERSION)), "tools": doc.get("tools", {})},
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ) + "\n"
    fd, tmp_path = tempfile.mkstemp(
        prefix=".plasmaweb-tools-",
        suffix=".json",
        dir=directory,
        text=True,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as tmp:
            tmp.write(payload)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def upsert_tool_entry_in_tools_mut(
    tools_mut: MutableMapping[str, Any],
    toolno: int,
    *,
    meta: Any = MISSING,
    presets: Any = MISSING,
) -> None:
    """Merge plasmaweb fields for ``toolno`` into an in-memory ``tools`` map (no I/O)."""
    key = str(int(toolno))
    entry: dict[str, Any]
    if key in tools_mut and isinstance(tools_mut[key], dict):
        entry = dict(tools_mut[key])
    else:
        entry = {"meta": {}, "presets": []}

    if meta is not MISSING:
        entry["meta"] = _normalize_meta(meta)
    elif "meta" not in entry or not isinstance(entry.get("meta"), dict):
        entry["meta"] = {}

    if presets is not MISSING:
        entry["presets"] = _normalize_presets(presets)
    elif "presets" not in entry or not isinstance(entry.get("presets"), list):
        entry["presets"] = []

    tools_mut[key] = entry


def upsert_tool_in_sidecar(
    tool_table_path: str,
    toolno: int,
    *,
    meta: Any = MISSING,
    presets: Any = MISSING,
) -> None:
    """Merge plasmaweb fields for ``toolno``; ``MISSING`` means leave that part unchanged."""
    doc = load_tool_sidecar(tool_table_path)
    tools: MutableMapping[str, Any] = doc["tools"]
    upsert_tool_entry_in_tools_mut(tools, toolno, meta=meta, presets=presets)
    save_tool_sidecar_atomic(tool_table_path, doc)


def remove_tool_from_sidecar(tool_table_path: str, toolno: int) -> None:
    doc = load_tool_sidecar(tool_table_path)
    tools = doc.get("tools")
    if not isinstance(tools, dict):
        return
    key = str(int(toolno))
    if key not in tools:
        return
    del tools[key]
    save_tool_sidecar_atomic(tool_table_path, doc)


def sidecar_entry_substantive(entry: Any) -> bool:
    """True if a sidecar ``tools`` entry carries meta or presets worth preserving."""
    if not isinstance(entry, dict):
        return False
    presets = entry.get("presets")
    if isinstance(presets, list) and len(presets) > 0:
        return True
    meta = entry.get("meta")
    if not isinstance(meta, dict) or not meta:
        return False
    for v in meta.values():
        if v is None:
            continue
        if isinstance(v, (int, float)) and v != 0:
            return True
        if isinstance(v, str) and v.strip():
            return True
    return False


def sidecar_has_substantive_entry(tool_table_path: str, toolno: int) -> bool:
    doc = load_tool_sidecar(tool_table_path)
    tools = doc.get("tools")
    if not isinstance(tools, dict):
        return False
    return sidecar_entry_substantive(tools.get(str(int(toolno))))


def rename_tool_keys_in_tools_mut(
    tools_mut: MutableMapping[str, Any],
    old_no: int,
    new_no: int,
) -> None:
    """Move ``tools[str(old_no)]`` to ``str(new_no)`` in-place; no-op if old key missing."""
    if int(old_no) == int(new_no):
        return
    ok, nk = str(int(old_no)), str(int(new_no))
    if ok not in tools_mut or not isinstance(tools_mut[ok], dict):
        return
    entry = dict(tools_mut[ok])
    del tools_mut[ok]
    if nk in tools_mut and not sidecar_entry_substantive(tools_mut[nk]):
        del tools_mut[nk]
    tools_mut[nk] = entry


def rename_tool_in_sidecar(tool_table_path: str, old_no: int, new_no: int) -> None:
    """Move ``tools[str(old_no)]`` to ``tools[str(new_no)]``; no-op if old key missing."""
    if int(old_no) == int(new_no):
        return
    doc = load_tool_sidecar(tool_table_path)
    tools_mut: MutableMapping[str, Any] = doc["tools"]
    rename_tool_keys_in_tools_mut(tools_mut, old_no, new_no)
    save_tool_sidecar_atomic(tool_table_path, doc)


def pop_lcncgui_params(params: MutableMapping[str, Any]) -> tuple[dict[str, Any], Any, Any]:
    """Split ``lcncgui_*`` keys for sidecar handling; returned dict is safe for .tbl writers."""
    p = dict(params)
    lc_meta = p.pop("lcncgui_meta", MISSING)
    lc_presets = p.pop("lcncgui_presets", MISSING)
    return p, lc_meta, lc_presets


def sidecar_meta_name(tool_table_path: str, toolno: int) -> str:
    doc = load_tool_sidecar(tool_table_path)
    tools = doc.get("tools")
    if not isinstance(tools, dict):
        return ""
    entry = tools.get(str(int(toolno)))
    if not isinstance(entry, dict):
        return ""
    meta = entry.get("meta")
    if not isinstance(meta, dict):
        return ""
    n = meta.get("name")
    return str(n).strip() if n is not None else ""
