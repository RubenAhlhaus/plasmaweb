"""Coordinate system ID constants and normalization (no linuxcnc import)."""

from __future__ import annotations

COORDINATE_SYSTEM_IDS: tuple[str, ...] = (
    "0",
    "G54",
    "G55",
    "G56",
    "G57",
    "G58",
    "G59",
    "G59.1",
    "G59.2",
    "G59.3",
)


def normalize_coordinate_system_id(system_id: str | None) -> str:
    """
    Return the canonical ID from ``COORDINATE_SYSTEM_IDS``.

    Matching is case-insensitive for G-code spellings (e.g. ``g54`` → ``G54``).

    Raises:
        ValueError: if the value is empty/whitespace-only or not a known system ID.
    """
    raw = (system_id or "").strip()
    if raw in COORDINATE_SYSTEM_IDS:
        return raw
    low = raw.lower()
    for sid in COORDINATE_SYSTEM_IDS:
        if sid.lower() == low:
            return sid
    allowed = ", ".join(COORDINATE_SYSTEM_IDS)
    raise ValueError(f"systemId must be one of: {allowed}")
