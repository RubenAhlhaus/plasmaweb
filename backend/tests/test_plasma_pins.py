"""The write policy in backend/plasma/pins.py is the safety boundary, so it gets tests.

BUILD_PLAN.md: "This list lives in code as an explicit allowlist/denylist, not as a
convention." These tests are what keeps it honest.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from backend.plasma import pins as pins_module
from backend.plasma.pins import (
    DEPRECATED,
    EXTERNAL_IN,
    HAL_DRIVEN,
    OWNED_ACK,
    OWNED_OUT,
    PLASMAC_COMPONENT,
    PLASMAC_PINS,
    QTPLASMAC_COMPONENT,
    QTPLASMAC_PINS,
    REALTIME_OUT,
    SETPOINT,
    hal_name,
    is_writable,
    missing_pins,
    plasmac_pin,
    qtplasmac_pin,
    writable_plasmac_pins,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
VALID_TYPES = {"bit", "float", "s32", "u32"}


def test_pin_table_sizes_match_upstream() -> None:
    """194 plasmac pins (144 in / 50 out) and the 91 pins QtPlasmaC's own comp exports."""
    assert len(PLASMAC_PINS) == 194
    assert sum(1 for p in PLASMAC_PINS if p.direction == "in") == 144
    assert sum(1 for p in PLASMAC_PINS if p.direction == "out") == 50
    assert len(QTPLASMAC_PINS) == 95


def test_pin_names_are_unique_and_hal_shaped() -> None:
    for table in (PLASMAC_PINS, QTPLASMAC_PINS):
        names = [pin.name for pin in table]
        assert len(names) == len(set(names))
        for pin in table:
            assert pin.name == pin.name.lower()
            assert pin.type in VALID_TYPES
            assert pin.direction in ("in", "out")


def test_component_pins_use_dashes_and_own_pins_keep_upstream_underscores() -> None:
    """halcompile rewrites _ to - for .comp files; hal.component() does not.

    So plasmac's pins really are dashed and QtPlasmaC's really are not, and getting this
    backwards would silently break every existing *_connections.hal file.
    """
    for pin in PLASMAC_PINS:
        assert "_" not in pin.name, f"plasmac.{pin.name} should be dashed"
    assert {pin.name for pin in QTPLASMAC_PINS} >= {
        "ext_abort",
        "ext_torch_enable",
        "plasmac_state",
        "material_change",
        "thc_feed_rate",
    }


@pytest.mark.parametrize(
    "name",
    [
        # BUILD_PLAN's realtime-owned list, verbatim
        "torch-on",
        "arc-ok-out",
        "z-offset-counts",
        "state-out",
        "thc-active",
        "stop-type-out",
        "x-offset-counts",
        "y-offset-counts",
        # statistics
        "cut-time",
        "cut-length",
        "pierce-count",
        "run-time",
        "torch-time",
        "rapid-time",
        "paused-time",
        "probe-time",
    ],
)
def test_realtime_owned_pins_are_not_writable(name: str) -> None:
    pin = plasmac_pin(name)
    assert pin.policy == REALTIME_OUT
    assert not is_writable(pin)


@pytest.mark.parametrize(
    "name",
    [
        "arc-voltage-in",  # from the torch / sim-torch
        "arc-ok-in",  # from the debounce filter
        "axis-z-position",  # joint.N.pos-fb
        "axis-x-min-limit",  # ini.x.min-limit
        "program-is-running",  # halui
        "units-per-mm",  # halui
        "float-switch",  # db_float.out
        "ohmic-probe",  # db_ohmic.out
        "breakaway",  # db_breakaway.out
        "move-up",  # external THC switch, mode 2
        "external-estop",
        "ohmic-sense-in",
    ],
)
def test_hal_driven_pins_are_not_writable(name: str) -> None:
    pin = plasmac_pin(name)
    assert pin.policy == HAL_DRIVEN
    assert not is_writable(pin)


def test_deprecated_pins_are_not_writable() -> None:
    pin = plasmac_pin("requested-velocity")
    assert pin.policy == DEPRECATED
    assert not is_writable(pin)


@pytest.mark.parametrize(
    "name",
    [
        # material parameters
        "pierce-height",
        "pierce-delay",
        "cut-height",
        "cut-feed-rate",
        "cut-volts",
        "kerf-width",
        "puddle-jump-height",
        "puddle-jump-delay",
        "pause-at-end",
        # enables and one-shot requests M1 needs
        "torch-enable",
        "thc-enable",
        "cornerlock-enable",
        "voidlock-enable",
        "use-auto-volts",
        "mesh-enable",
        "height-override",
        "torch-pulse-start",
        "torch-pulse-time",
        "consumable-change",
        "cut-recovery",
        "mode",
    ],
)
def test_setpoints_are_writable(name: str) -> None:
    pin = plasmac_pin(name)
    assert pin.policy == SETPOINT
    assert is_writable(pin)


def test_only_setpoints_are_writable_on_the_plasmac_component() -> None:
    assert {pin.policy for pin in writable_plasmac_pins()} == {SETPOINT}
    for pin in PLASMAC_PINS:
        if pin.direction == "out":
            assert not is_writable(pin), pin.name


def test_own_component_pins_split_by_direction() -> None:
    """We drive our HAL_OUT pins; HAL_IN pins come from panels and buttons."""
    for pin in QTPLASMAC_PINS:
        if pin.direction == "out":
            assert pin.policy == OWNED_OUT
            assert is_writable(pin)
        elif pin.policy == OWNED_ACK:
            assert is_writable(pin)
        else:
            assert pin.policy == EXTERNAL_IN
            assert not is_writable(pin)


def test_the_handshake_inputs_qtplasmac_drives_itself_are_writable() -> None:
    """QtPlasmaC declares these HAL_IN yet sets them: they are its half of a handshake."""
    for name in (
        "material_change",
        "material_change_number",
        "material_change_timeout",
        "material_reload",
        "material_temp",
        "cut_type",
    ):
        assert qtplasmac_pin(name).policy == OWNED_ACK
        assert is_writable(qtplasmac_pin(name))

    # A pin an operator's panel drives stays read-only.
    assert not is_writable(qtplasmac_pin("ext_abort"))


def test_own_component_keeps_the_qtplasmac_names() -> None:
    """Drop-in compatibility: existing *_connections.hal files net these names."""
    for name in ("ext_abort", "ext_torch_enable", "ext_height_ovr_plus", "laser_on"):
        assert qtplasmac_pin(name).name == name
    assert hal_name(QTPLASMAC_COMPONENT, qtplasmac_pin("laser_on")) == "qtplasmac.laser_on"
    assert hal_name(PLASMAC_COMPONENT, plasmac_pin("torch-on")) == "plasmac.torch-on"


def test_unknown_pin_lookup_raises() -> None:
    with pytest.raises(KeyError):
        plasmac_pin("no-such-pin")
    with pytest.raises(KeyError):
        qtplasmac_pin("no-such-pin")


def test_missing_pins_reports_what_this_linuxcnc_lacks() -> None:
    """LinuxCNC 2.9.4 has no plasmac.dry-run; that must be reportable, not fatal."""
    existing = [
        hal_name(PLASMAC_COMPONENT, pin)
        for pin in PLASMAC_PINS
        if pin.name not in ("dry-run", "tube-cut")
    ]
    missing = missing_pins(existing, PLASMAC_PINS, PLASMAC_COMPONENT)
    assert missing == ["plasmac.dry-run", "plasmac.tube-cut"]
    assert missing_pins(existing, [plasmac_pin("torch-on")], PLASMAC_COMPONENT) == []


@pytest.mark.skipif(
    not (REPO_ROOT / "reference" / "linuxcnc" / "src" / "hal" / "components" / "plasmac.comp").exists(),
    reason="reference tree not checked out",
)
def test_generated_module_is_in_sync_with_the_reference_tree() -> None:
    """Guard against hand-edits: regenerating must reproduce the committed file byte for byte."""
    committed = Path(pins_module.__file__).read_text(encoding="utf-8")
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "gen_plasma_pins.py")],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, result.stderr
    assert Path(pins_module.__file__).read_text(encoding="utf-8") == committed
