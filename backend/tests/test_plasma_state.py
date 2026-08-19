"""State decode tests — the table must stay pinned to plasmac.comp's enums."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from backend.plasma.state import (
    STATES,
    STOP_TYPES,
    decode_state,
    decode_stop_type,
    state_payload,
)

COMP_FILE = (
    Path(__file__).resolve().parents[2]
    / "reference"
    / "linuxcnc"
    / "src"
    / "hal"
    / "components"
    / "plasmac.comp"
)


def test_state_values_are_dense_and_ordinal() -> None:
    """plasmac writes the enum ordinal, so index must equal value with no gaps."""
    assert [state.value for state in STATES] == list(range(len(STATES)))
    assert [stop.value for stop in STOP_TYPES] == list(range(len(STOP_TYPES)))
    assert len(STATES) == 28
    assert len(STOP_TYPES) == 4


def test_known_states_decode() -> None:
    assert decode_state(0).name == "IDLE"
    assert decode_state(11).name == "CUT_MODE_01"
    assert decode_state(27).name == "DEBUG"
    assert decode_stop_type(3).name == "PAUSE"


@pytest.mark.parametrize("value", [None, -1, 28, 999])
def test_unknown_state_returns_none_instead_of_raising(value) -> None:
    """A newer plasmac may add states; the publisher must survive that."""
    assert decode_state(value) is None
    assert decode_stop_type(value if value != 3 else 99) is None


def test_state_payload_shape() -> None:
    payload = state_payload(11, 0)
    assert payload == {
        "state": 11,
        "stateName": "CUT_MODE_01",
        "stateDescription": "cutting in either mode 0 or mode 1",
        "stopType": 0,
        "stopTypeName": "NONE",
        "isCutting": True,
    }

    idle = state_payload(0, None)
    assert idle["isCutting"] is False
    assert idle["stopTypeName"] is None

    unknown = state_payload(999, 999)
    assert unknown["stateName"] is None
    assert unknown["isCutting"] is False


@pytest.mark.skipif(not COMP_FILE.exists(), reason="reference tree not checked out")
def test_tables_match_the_reference_enums() -> None:
    """Drift guard: names and order must match state_t / stop_type_t in plasmac.comp."""
    source = COMP_FILE.read_text(encoding="utf-8", errors="replace")

    def enum_names(type_name: str) -> list[str]:
        match = re.search(
            r"typedef enum\{(?P<body>[^}]*)\}\s*" + type_name + r"\s*;", source, re.S
        )
        assert match, f"{type_name} not found in plasmac.comp"
        return [
            entry.strip()
            for entry in match.group("body").split(",")
            if entry.strip()
        ]

    assert enum_names("state_t") == [state.name for state in STATES]
    assert enum_names("stop_type_t") == [stop.name for stop in STOP_TYPES]
