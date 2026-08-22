"""The machine log: severity, boundedness, and saving it the way QtPlasmaC saves it."""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from backend.plasma.machine_log import (
    CRITICAL,
    INFO,
    LOG_PREFIX,
    WARNING,
    MachineLog,
    classify,
)


@pytest.mark.parametrize(
    "message",
    [
        "float switch activated\nprogram is paused.",
        "breakaway switch activated, program is paused",
        "ohmic probe activated",
        "valid arc lost, program is paused",
        "no arc detected after 3 start attempts",
        "bottom limit reached while probing down",
        "material too high for safe traverse",
        "invalid pierce height, program is paused",
        "bottom limit reached while THC moving down",
        "top limit reached while THC moving up",
        "pierce height would exceed Z axis maximum limit ...",
        "Offset limit violation (state: CUT_MODE_01)",
    ],
)
def test_the_documented_critical_messages_are_critical(message: str) -> None:
    """These pause the program, and the operator has to clear the cause before resuming."""
    assert classify(message) == CRITICAL


@pytest.mark.parametrize(
    "message",
    [
        "ohmic probe detected before probing, probe test aborted",
        "breakaway switch detected during probe test",
        "probe trip error while probing",
        "bottom limit reached while probe testing",
        "breakaway, float, or ohmic activated during consumable change",
    ],
)
def test_the_documented_warnings_are_warnings(message: str) -> None:
    """Informational: the program keeps running."""
    assert classify(message) == WARNING


def test_a_limit_during_a_probe_test_is_a_warning_but_during_cutting_is_critical() -> None:
    """Same limit, different consequence — the probe-test wording is what decides."""
    assert classify("bottom limit reached while probe testing") == WARNING
    assert classify("bottom limit reached while THC moving down, program is paused") == CRITICAL


def test_anything_unrecognised_is_recorded_rather_than_guessed_at() -> None:
    assert classify("Tool 0: No Tool") == INFO
    assert classify("") == INFO


def test_the_log_keeps_what_the_machine_said_in_order() -> None:
    log = MachineLog()

    log.record("operator_error", "float switch activated")
    log.record("operator_text", "Tool 0: No Tool")

    entries = log.entries()
    assert [e["message"] for e in entries] == ["float switch activated", "Tool 0: No Tool"]
    assert [e["severity"] for e in entries] == [CRITICAL, INFO]
    assert entries[0]["kind"] == "operator_error"


def test_the_log_is_bounded_so_a_machine_can_run_for_weeks() -> None:
    log = MachineLog(max_entries=3)

    for index in range(5):
        log.record("operator_error", f"message {index}")

    assert [e["message"] for e in log.entries()] == ["message 2", "message 3", "message 4"]


def test_the_last_critical_is_what_a_returning_operator_needs_first() -> None:
    log = MachineLog()
    log.record("operator_error", "float switch activated")
    log.record("operator_text", "Tool 0: No Tool")
    log.record("operator_error", "no arc detected after 3 start attempts")
    log.record("operator_text", "chatter")

    assert log.last_critical()["message"] == "no arc detected after 3 start attempts"


def test_no_critical_message_yet_is_not_an_error() -> None:
    log = MachineLog()
    log.record("operator_text", "Tool 0: No Tool")

    assert log.last_critical() is None


def test_only_one_severity_can_be_asked_for(tmp_path: Path) -> None:
    log = MachineLog()
    log.record("operator_error", "float switch activated")
    log.record("operator_text", "Tool 0: No Tool")

    assert [e["message"] for e in log.entries(severity=CRITICAL)] == [
        "float switch activated"
    ]
    assert len(log.entries(limit=1)) == 1


# ---- saving --------------------------------------------------------------------------


def test_saving_writes_a_file_named_the_way_qtplasmac_names_it(tmp_path: Path) -> None:
    """One readable history for the machine, not one per GUI."""
    log = MachineLog()
    log.record("operator_error", "float switch activated")

    path = log.save(str(tmp_path))

    assert path is not None
    name = os.path.basename(path)
    assert name.startswith(LOG_PREFIX) and name.endswith(".txt")
    text = Path(path).read_text()
    assert "float switch activated" in text
    assert text.startswith("--- Machine log started on:")


def test_saving_keeps_five_files_and_deletes_the_oldest(tmp_path: Path) -> None:
    for index in range(6):
        stamp = f"{LOG_PREFIX}26-01-0{index + 1}_00-00-00.txt"
        (tmp_path / stamp).write_text("old\n")

    log = MachineLog()
    log.record("operator_error", "float switch activated")
    log.save(str(tmp_path))

    remaining = sorted(p.name for p in tmp_path.iterdir())
    assert len(remaining) == 5
    # The oldest two went; the newest of the old ones stayed.
    assert f"{LOG_PREFIX}26-01-01_00-00-00.txt" not in remaining
    assert f"{LOG_PREFIX}26-01-06_00-00-00.txt" in remaining


def test_an_empty_log_writes_nothing(tmp_path: Path) -> None:
    assert MachineLog().save(str(tmp_path)) is None
    assert list(tmp_path.iterdir()) == []


def test_a_log_that_cannot_be_saved_does_not_take_the_machine_down(tmp_path: Path) -> None:
    log = MachineLog()
    log.record("operator_error", "float switch activated")

    assert log.save(str(tmp_path / "no-such-directory")) is None


def test_a_two_line_message_is_one_line_in_the_saved_log(tmp_path: Path) -> None:
    """The component sends "no arc detected…" and "program is paused." as two lines; an entry
    that wraps in the file looks like two events."""
    log = MachineLog()
    log.record("operator_error", "no arc detected after 3 start attempts\nprogram is paused.")

    path = log.save(str(tmp_path))

    lines = Path(path).read_text().splitlines()
    assert len(lines) == 2  # the header and one entry
    assert lines[1].endswith("no arc detected after 3 start attempts program is paused.")
    # The UI still gets the message as the machine sent it.
    assert "\n" in log.entries()[0]["message"]
