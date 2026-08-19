from __future__ import annotations

import os
from typing import Any, Dict, List, Mapping, Optional, Sequence

from backend.coordinate_system_ids import COORDINATE_SYSTEM_IDS, normalize_coordinate_system_id

SYSTEM_LIST: tuple[str, ...] = COORDINATE_SYSTEM_IDS

# Mapping gemäß LinuxCNC-Konvention:
# P1..P6 -> G54..G59, P7..P9 -> G59.1..G59.3
SYSTEM_ID_TO_P: Dict[str, int] = {
    "G54": 1,
    "G55": 2,
    "G56": 3,
    "G57": 4,
    "G58": 5,
    "G59": 6,
    "G59.1": 7,
    "G59.2": 8,
    "G59.3": 9,
}

_AXES: tuple[str, ...] = ("x", "y", "z", "a", "b", "c", "u", "v", "w")

# G54 X is #5221; each subsequent WCS is +20 (same scheme as GladeVCP offsetpage).
_G5X_VAR_BASE = 5221
_G5X_VAR_STRIDE = 20

# In-Memory-Speicher der reinen G5x-Offsets pro Koordinatensystem.
# Einmalig aus der LinuxCNC-VAR-Datei hydratisiert, danach durch Edits / aktive Sync.
_OFFSETS: Dict[str, Dict[str, float]] = {
    system_id: {axis: 0.0 for axis in _AXES} for system_id in SYSTEM_LIST if system_id != "0"
}

# True only after a successful VAR hydrate for this process.
_OFFSETS_HYDRATED: bool = False


def _empty_axis_offsets() -> Dict[str, float]:
    return {axis: 0.0 for axis in _AXES}


def _g5x_index_to_system_id(g5x_index: int) -> str:
    """
    Mappt den aktuellen g5x_index (Statuskanal) auf eine System-ID aus SYSTEM_LIST.

    Laut LinuxCNC-Doku:
    - 1..6: G54..G59
    - 7..9: G59.1..G59.3
    - 0 oder andere Werte: kein aktives G5x -> wir zeigen "0" (Maschinenkoordinaten / G53) an.
    """
    for system_id, p_num in SYSTEM_ID_TO_P.items():
        if p_num == g5x_index:
            return system_id
    return "0"


def get_active_system_id(stat: Any) -> str:
    """
    Liefert die aktuelle Koordinatensystem-ID basierend auf stat.g5x_index.
    """
    g5x_index = int(getattr(stat, "g5x_index", 0))
    return _g5x_index_to_system_id(g5x_index)


def var_base_for_system_id(system_id: str) -> Optional[int]:
    """First numbered parameter for a G5x system (X), or None for machine / unknown."""
    if system_id == "0" or system_id not in SYSTEM_ID_TO_P:
        return None
    p_num = SYSTEM_ID_TO_P[system_id]
    return _G5X_VAR_BASE + (p_num - 1) * _G5X_VAR_STRIDE


def _strip_ini_comment(line: str) -> str:
    """Strip ``;`` and ``#`` comments from an INI line (before section/key parsing)."""
    main = line.split(";", 1)[0]
    return main.split("#", 1)[0].strip()


def _read_parameter_file_line_scan(ini_path: str) -> Optional[str]:
    """
    Read ``[RS274NGC] PARAMETER_FILE`` without ConfigParser.

    LinuxCNC INIs often have duplicate keys (e.g. multiple ``PROGRAM_EXTENSION``),
    which make ConfigParser raise ``DuplicateOptionError``.
    """
    try:
        with open(ini_path, encoding="utf-8", errors="replace") as handle:
            in_rs274 = False
            for line in handle:
                main = _strip_ini_comment(line)
                if not main:
                    continue
                if main.startswith("[") and main.endswith("]"):
                    sec = main[1:-1].strip().lower()
                    in_rs274 = sec == "rs274ngc"
                    continue
                if in_rs274 and "=" in main:
                    key, val = main.split("=", 1)
                    if key.strip().lower() == "parameter_file":
                        v = val.strip().strip('"').strip("'")
                        return v if v else None
    except OSError:
        return None
    return None


def resolve_parameter_file_path(ini_path: str) -> Optional[str]:
    """
    Resolve ``[RS274NGC] PARAMETER_FILE`` from an INI path (absolute path if found).

    Relative VAR paths are resolved against the INI directory (LinuxCNC convention).
    Prefers ``linuxcnc.ini`` when available, otherwise a duplicate-key-safe line scan.
    """
    if not ini_path or not os.path.isfile(ini_path):
        return None

    raw: Optional[str] = None
    try:
        import linuxcnc  # type: ignore

        inifile = linuxcnc.ini(ini_path)
        found = inifile.find("RS274NGC", "PARAMETER_FILE")
        if found:
            raw = str(found).strip().strip('"').strip("'")
    except Exception:
        raw = None

    if not raw:
        raw = _read_parameter_file_line_scan(ini_path)

    if not raw:
        return None

    expanded = os.path.expanduser(raw)
    if os.path.isabs(expanded):
        return expanded if os.path.isfile(expanded) else None

    candidate = os.path.join(os.path.dirname(os.path.abspath(ini_path)), expanded)
    return candidate if os.path.isfile(candidate) else None


def parse_parameter_file_g5x_offsets(var_path: str) -> Dict[str, Dict[str, float]]:
    """
    Parse a LinuxCNC parameter/VAR file into per-system G5x axis offsets.

    Missing parameters default to 0.0. Only G54–G59.3 axis params are returned
    (not G28/G30/G92). Same layout as GladeVCP ``offsetpage_widget``.
    """
    result: Dict[str, Dict[str, float]] = {
        system_id: _empty_axis_offsets()
        for system_id in SYSTEM_LIST
        if system_id != "0"
    }
    if not var_path or not os.path.isfile(var_path):
        return result

    try:
        with open(var_path, encoding="utf-8", errors="replace") as handle:
            lines = handle.readlines()
    except OSError:
        return result

    values: Dict[int, float] = {}
    for line in lines:
        parts = line.split()
        if len(parts) < 2:
            continue
        try:
            param = int(float(parts[0]))
            data = float(parts[1])
        except (TypeError, ValueError):
            continue
        values[param] = data

    for system_id in result:
        base = var_base_for_system_id(system_id)
        if base is None:
            continue
        for idx, axis in enumerate(_AXES):
            result[system_id][axis] = float(values.get(base + idx, 0.0))

    return result


def hydrate_stored_offsets_from_parameter_file(var_path: str) -> bool:
    """
    Load all G5x offsets from ``var_path`` into ``_OFFSETS``.

    Returns True if the file was read (even when all values are zero).
    """
    if not var_path or not os.path.isfile(var_path):
        return False
    parsed = parse_parameter_file_g5x_offsets(var_path)
    for system_id, axes in parsed.items():
        row = _OFFSETS.setdefault(system_id, _empty_axis_offsets())
        row.update(axes)
    return True


def ensure_stored_offsets_hydrated_from_ini(ini_path: Optional[str]) -> bool:
    """
    Hydrate ``_OFFSETS`` from the INI's PARAMETER_FILE until success.

    Returns True once hydrated (or already hydrated). Returns False if ``ini_path``
    is missing or the VAR file cannot be resolved/read yet so the caller can retry.
    """
    global _OFFSETS_HYDRATED
    if _OFFSETS_HYDRATED:
        return True
    if not ini_path:
        return False
    var_path = resolve_parameter_file_path(ini_path)
    if not var_path:
        return False
    if not hydrate_stored_offsets_from_parameter_file(var_path):
        return False
    _OFFSETS_HYDRATED = True
    return True


def reset_stored_offsets_state_for_tests() -> None:
    """Reset in-memory offset cache and hydration flag (unit tests only)."""
    global _OFFSETS, _OFFSETS_HYDRATED
    _OFFSETS = {
        system_id: _empty_axis_offsets()
        for system_id in SYSTEM_LIST
        if system_id != "0"
    }
    _OFFSETS_HYDRATED = False


def _stat_axis_vector(stat: Any, attr: str) -> Optional[List[float]]:
    """Nine-axis float vector from ``stat``, or None if missing/too short."""
    raw = getattr(stat, attr, None)
    if not isinstance(raw, (list, tuple)) or len(raw) < 9:
        return None
    return [float(raw[idx]) for idx in range(9)]


def display_totals_to_g5x_offsets(
    axis_values: Mapping[str, float],
    g92: Optional[Sequence[float]],
) -> Dict[str, float]:
    """
    Convert UI display totals (``g5x + g92``) to pure G5x values for ``G10 L2``.

    If ``g92`` is missing or too short for an axis, that axis is left unchanged.
    """
    out: Dict[str, float] = {}
    for axis_key, raw_val in axis_values.items():
        ax = str(axis_key).strip().lower()
        if ax not in _AXES:
            continue
        val = float(raw_val)
        idx = _AXES.index(ax)
        if g92 is not None and len(g92) > idx:
            val = val - float(g92[idx])
        out[ax] = val
    return out


def _offsets_plus_g92(
    g5x: Mapping[str, float], g92: Optional[Sequence[float]]
) -> Dict[str, float]:
    """Add live G92 onto stored/pure G5x for dialog display."""
    return {
        axis: float(g5x.get(axis, 0.0))
        + (float(g92[idx]) if g92 is not None else 0.0)
        for idx, axis in enumerate(_AXES)
    }


def list_coordinate_systems(stat: Any) -> List[Dict[str, Any]]:
    """
    Erzeugt eine einfache Übersicht aller Koordinatensysteme für das Frontend.

    Wichtig:
    - Der LinuxCNC-Statuskanal liefert nur das aktuell aktive G5x/G92-Offset.
    - Inaktive Zeilen nutzen ``_OFFSETS`` (VAR-Hydration / Edits) plus live G92,
      damit Activate die Anzeige nicht springen lässt.
    """
    # Wir gehen davon aus, dass der Aufrufer bereits poll() ausgeführt hat.
    g5x_index = int(getattr(stat, "g5x_index", 0))
    active_id = _g5x_index_to_system_id(g5x_index)

    active_offsets = get_active_coordinate_system_offsets(stat)
    active_g5x_only = get_active_g5x_offsets(stat)
    g92 = _stat_axis_vector(stat, "g92_offset")

    systems: List[Dict[str, Any]] = []
    for system_id in SYSTEM_LIST:
        is_active = system_id == active_id

        if system_id == "0":
            offsets: Dict[str, float] = {}
        elif is_active:
            offsets = {axis: float(val) for axis, val in active_offsets.items()}
            # Cache pure G5x (ohne G92) für konsistente inaktive Anzeige.
            if active_g5x_only:
                _OFFSETS.setdefault(system_id, _empty_axis_offsets()).update(
                    active_g5x_only
                )
        else:
            stored = _OFFSETS.get(system_id) or {}
            offsets = _offsets_plus_g92(stored, g92)

        systems.append(
            {
                "id": system_id,
                "label": system_id,
                "is_active": is_active,
                "offsets": offsets,
            }
        )

    return systems


def mdi_line_for_active_coordinate_system(system_id: str) -> str:
    """
    MDI-Zeile zum Aktivieren eines Koordinatensystems (G53 für Maschine / „0“,
    sonst G54..G59.3).

    Raises:
        ValueError: leere oder unbekannte System-ID. Die Maschinen-Zeile ``0`` ist erlaubt.
    """
    canonical = normalize_coordinate_system_id(system_id)
    if canonical == "0":
        # G53 ist modal nur für den jeweiligen Bewegungsblock; ein dauerhaftes
        # „Aktivieren“ wie bei G54..G59.x gibt es nicht. Hier schicken wir
        # einfach G53, damit der nächste Block in Maschinenkoordinaten läuft.
        return "G53"
    return canonical


def get_active_g5x_offsets(stat: Any) -> Dict[str, float]:
    """
    Pure G5x offsets for the active work coordinate system (without G92).

    Empty dict for machine coordinates (system ``0``) or when ``g5x_offset`` is
    unavailable (falls back to in-memory store).
    """
    active_id = get_active_system_id(stat)
    if active_id == "0":
        return {}

    g5x = _stat_axis_vector(stat, "g5x_offset")
    if g5x is None:
        stored = _OFFSETS.get(active_id) or {}
        return {axis: float(val) for axis, val in stored.items()}

    return {axis: g5x[idx] for idx, axis in enumerate(_AXES)}


def get_active_coordinate_system_offsets(stat: Any) -> Dict[str, float]:
    """
    Liefert die aktiven Offsets für das gerade aktive Werkstückkoordinatensystem.

    Rückgabe:
    - Achsen werden als Dict mit Keys wie "x", "y", "z", ... erwartet.
    - Für Maschinenkoordinaten (System-ID "0" / G53) werden keine Offsets
      benötigt (wir geben daher ein leeres Dict zurück).
    """
    active_id = get_active_system_id(stat)
    if active_id == "0":
        return {}

    g5x = _stat_axis_vector(stat, "g5x_offset")
    g92 = _stat_axis_vector(stat, "g92_offset")

    # Defensive fallback: Falls LinuxCNC die Arrays unerwartet nicht liefert,
    # bleiben die in-memory Offsets die letzte bekannte Quelle.
    if g5x is None or g92 is None:
        stored = _OFFSETS.get(active_id) or {}
        return {axis: float(val) for axis, val in stored.items()}

    return {axis: g5x[idx] + g92[idx] for idx, axis in enumerate(_AXES)}


def merge_stored_coordinate_system_offsets(
    system_id: str, partial: Dict[str, float]
) -> None:
    """
    Merge pure G5x offsets into ``_OFFSETS`` (mainly for inactive G5x rows in the UI).

    Called by the handler after a successful ``G10 L2`` MDI with the values that were
    actually written (display totals minus G92). The active row is rebuilt from
    ``stat`` on the next ``list_coordinate_systems`` call.
    """
    if system_id == "0" or system_id not in SYSTEM_LIST:
        return
    row = _OFFSETS.setdefault(system_id, _empty_axis_offsets())
    for axis, val in partial.items():
        if axis in _AXES:
            row[axis] = float(val)
