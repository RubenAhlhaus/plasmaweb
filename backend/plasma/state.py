"""Decode ``plasmac.state-out`` and ``plasmac.stop-type-out`` into names the UI can show.

Both tables are the ``state_t`` / ``stop_type_t`` enums in
``reference/linuxcnc/src/hal/components/plasmac.comp`` (documented in qtplasmac.adoc,
"QtPlasmaC State Outputs"). They are ordinal enums, so index == pin value.

Kept as plain data rather than generated: 28 + 4 entries that upstream has not changed in
years, and each one carries a human sentence the generator has no source for.
"""

from __future__ import annotations

from typing import Dict, NamedTuple, Optional, Tuple


class PlasmaState(NamedTuple):
    value: int
    name: str
    description: str


#: ``plasmac.state-out`` — index is the pin value.
STATES: Tuple[PlasmaState, ...] = (
    PlasmaState(0, "IDLE", "idle and waiting for a start command"),
    PlasmaState(1, "PROBE_HEIGHT", "move down to probe height"),
    PlasmaState(2, "PROBE_DOWN", "probe down until material sensed"),
    PlasmaState(3, "PROBE_UP", "probe up until material not sensed, this sets the zero height"),
    PlasmaState(4, "ZERO_HEIGHT", "not used at present"),
    PlasmaState(5, "PIERCE_HEIGHT", "move up to pierce height"),
    PlasmaState(6, "TORCH_ON", "turn the torch on"),
    PlasmaState(7, "ARC_OK", "wait until arc OK detected"),
    PlasmaState(8, "PIERCE_DELAY", "wait for pierce delay time"),
    PlasmaState(9, "PUDDLE_JUMP", "xy motion begins, move to puddle jump height"),
    PlasmaState(10, "CUT_HEIGHT", "move to cut height"),
    PlasmaState(11, "CUT_MODE_01", "cutting in either mode 0 or mode 1"),
    PlasmaState(12, "CUT_MODE_2", "cutting in mode 2"),
    PlasmaState(13, "PAUSE_AT_END", "pause motion at end of cut"),
    PlasmaState(14, "SAFE_HEIGHT", "move to safe height"),
    PlasmaState(15, "MAX_HEIGHT", "move to maximum height"),
    PlasmaState(16, "END_CUT", "end the current cut"),
    PlasmaState(17, "END_JOB", "end the current job"),
    PlasmaState(18, "TORCHPULSE", "a torch pulse is active"),
    PlasmaState(19, "PAUSED_MOTION", "cut recovery motion is active while paused"),
    PlasmaState(20, "OHMIC_TEST", "an ohmic test is active"),
    PlasmaState(21, "PROBE_TEST", "a probe test is active"),
    PlasmaState(22, "SCRIBING", "a scribing job is active"),
    PlasmaState(23, "CONSUMABLE_CHANGE_ON", "move to consumable change coordinates"),
    PlasmaState(24, "CONSUMABLE_CHANGE_OFF", "return from consumable change coordinates"),
    PlasmaState(25, "CUT_RECOVERY_ON", "cut recovery is active"),
    PlasmaState(26, "CUT_RECOVERY_OFF", "cut recovery is deactivated"),
    PlasmaState(27, "DEBUG", "debug state, for testing purposes only"),
)

#: ``plasmac.stop-type-out`` — ``stop_type_t`` in plasmac.comp.
STOP_TYPES: Tuple[PlasmaState, ...] = (
    PlasmaState(0, "NONE", "no stop pending"),
    PlasmaState(1, "STOP", "the cut was stopped"),
    PlasmaState(2, "WAIT", "waiting, e.g. for an external event"),
    PlasmaState(3, "PAUSE", "the cut is paused"),
)

_STATES_BY_VALUE: Dict[int, PlasmaState] = {state.value: state for state in STATES}
_STOP_TYPES_BY_VALUE: Dict[int, PlasmaState] = {state.value: state for state in STOP_TYPES}

#: States in which the torch may be live or motion is under plasmac's control. The UI uses
#: this to decide when *not* to offer parameter edits; it is never a safety interlock —
#: those live in HAL.
CUTTING_STATES = frozenset(
    {"TORCH_ON", "ARC_OK", "PIERCE_DELAY", "PUDDLE_JUMP", "CUT_HEIGHT", "CUT_MODE_01", "CUT_MODE_2"}
)


def decode_state(value: Optional[int]) -> Optional[PlasmaState]:
    """``plasmac.state-out`` → state, or ``None`` for an unknown/absent value.

    An unknown value must not raise: a newer plasmac may add states, and the dashboard
    showing "unknown" beats the publisher dying.
    """
    if value is None:
        return None
    return _STATES_BY_VALUE.get(int(value))


def decode_stop_type(value: Optional[int]) -> Optional[PlasmaState]:
    """``plasmac.stop-type-out`` → stop type, or ``None`` for an unknown/absent value."""
    if value is None:
        return None
    return _STOP_TYPES_BY_VALUE.get(int(value))


def state_payload(state_out: Optional[int], stop_type_out: Optional[int]) -> Dict[str, object]:
    """The ``plasma.state.changed`` payload: raw pin values plus decoded names."""
    state = decode_state(state_out)
    stop_type = decode_stop_type(stop_type_out)
    return {
        "state": state_out,
        "stateName": state.name if state else None,
        "stateDescription": state.description if state else None,
        "stopType": stop_type_out,
        "stopTypeName": stop_type.name if stop_type else None,
        "isCutting": bool(state and state.name in CUTTING_STATES),
    }
