"""PowerMax RS485: the wiring around LinuxCNC's own component, not the protocol."""

from __future__ import annotations

from pathlib import Path
from typing import List

import pytest

from backend.plasma.powermax import (
    COMPONENT,
    FAULT_NAMES,
    NETS,
    PowerMaxError,
    check_port,
    format_fault,
    load_component,
    pressure_unit,
    read_port,
    write_port,
)


# ---- the port --------------------------------------------------------------------------


def test_the_port_round_trips_through_the_machines_prefs(tmp_path: Path) -> None:
    path = tmp_path / "machine.prefs"
    path.write_text("[GUI_OPTIONS]\nDefault material = 1\n")

    assert read_port(str(path)) == ""

    write_port(str(path), "/dev/ttyUSB0")
    assert read_port(str(path)) == "/dev/ttyUSB0"
    assert "Default material = 1" in path.read_text()


def test_a_machine_with_no_powermax_says_so_rather_than_guessing_a_port() -> None:
    with pytest.raises(PowerMaxError) as excinfo:
        check_port("")
    assert excinfo.value.code == "no_port"


def fake_serial(on_open=None):
    def opener(*_args, **_kwargs):
        if on_open:
            on_open()
        return type("Handle", (), {"close": lambda self: None})()

    return type("S", (), {"Serial": staticmethod(opener)})


def fake_ports(*names: str):
    return type("P", (), {"comports": staticmethod(lambda: [(name,) for name in names])})


def test_a_port_that_is_not_there_is_refused_before_anything_is_loaded() -> None:
    """A loadusr against a missing port leaves a component in HAL failing forever."""
    with pytest.raises(PowerMaxError) as excinfo:
        check_port("/dev/ttyUSB0", fake_serial(), fake_ports("/dev/ttyUSB1"))
    assert excinfo.value.code == "port_not_found"


def test_a_port_that_can_be_opened_is_accepted() -> None:
    check_port("/dev/ttyUSB0", fake_serial(), fake_ports("/dev/ttyUSB0"))


def test_a_port_that_cannot_be_opened_is_refused_too() -> None:
    def refuse():
        raise OSError("permission denied")

    with pytest.raises(PowerMaxError) as excinfo:
        check_port("/dev/ttyUSB0", fake_serial(refuse), fake_ports("/dev/ttyUSB0"))
    assert excinfo.value.code == "port_unavailable"
    assert "permission denied" in excinfo.value.message


def test_without_pyserial_the_port_cannot_be_checked_and_says_so(monkeypatch) -> None:
    import builtins

    real_import = builtins.__import__

    def no_serial(name, *args, **kwargs):
        if name.startswith("serial"):
            raise ImportError("no module named serial")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_serial)
    with pytest.raises(PowerMaxError) as excinfo:
        check_port("/dev/ttyUSB0")
    assert excinfo.value.code == "serial_missing"


# ---- the component --------------------------------------------------------------------


def test_the_component_is_loaded_by_name_never_reimplemented() -> None:
    """LinuxCNC already speaks this protocol; our job is to load it."""
    calls: List[List[str]] = []

    def runner(argv: List[str]) -> bool:
        calls.append(argv)
        # Absent on the first check, present after the loadusr.
        return argv[1:3] == ["show", "comp"] and len(calls) > 2

    load_component("/dev/ttyUSB0", runner=runner)

    assert ["halcmd", "loadusr", "-Wn", COMPONENT, COMPONENT, "/dev/ttyUSB0"] in calls


def test_an_already_loaded_component_is_left_alone() -> None:
    calls: List[List[str]] = []

    def runner(argv: List[str]) -> bool:
        calls.append(argv)
        return True

    load_component("/dev/ttyUSB0", runner=runner)

    assert all(argv[1] != "loadusr" for argv in calls)


def test_a_component_that_never_appears_is_reported_rather_than_retried_forever() -> None:
    def runner(argv: List[str]) -> bool:
        return False

    with pytest.raises(PowerMaxError) as excinfo:
        load_component("/dev/ttyUSB0", runner=runner, attempts=3)
    assert excinfo.value.code == "component_failed"


def test_every_net_pairs_one_of_their_pins_with_one_of_ours() -> None:
    from backend.plasma.pins import QTPLASMAC_PINS

    ours = {pin.name for pin in QTPLASMAC_PINS}
    for theirs, mine in NETS:
        assert theirs
        assert mine in ours, f"{mine} is not a pin on our component"


# ---- faults ---------------------------------------------------------------------------


def test_no_fault_is_not_a_fault_named_zero() -> None:
    assert format_fault(0) is None
    assert format_fault(0.0) is None


def test_a_fault_carries_hyperthermss_own_grouping_and_name() -> None:
    fault = format_fault(120)

    assert fault.raw == "0120"
    assert fault.code == "0-12-0"
    assert fault.name == "Low input gas pressure"


def test_the_one_ambiguous_code_is_read_off_the_supplys_maximum_current() -> None:
    """0210 means two different things, and 110 A is where the meaning changes."""
    assert format_fault(210, current_max=45).name == "Gas flow lost while cutting"
    assert format_fault(210, current_max=125).name == "Excessive arc voltage"


def test_an_unknown_code_is_still_shown_rather_than_swallowed() -> None:
    fault = format_fault(9999)

    assert fault.code == "9-99-9"
    assert "unknown" in fault.name


def test_the_whole_upstream_fault_table_is_present() -> None:
    assert len(FAULT_NAMES) == 57
    assert FAULT_NAMES["3700"] == "Internal serial communications fault"


def test_a_nonsense_reading_is_no_fault_rather_than_a_crash() -> None:
    assert format_fault("not a number") is None


def test_the_pressure_unit_follows_what_the_supply_reports() -> None:
    assert pressure_unit(120) == "psi"
    assert pressure_unit(5.5) == "bar"
