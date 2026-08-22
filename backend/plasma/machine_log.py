"""The machine log: what the machine said, kept where the operator can go back to it.

A plasma table talks. The realtime component prints through ``rtapi_print_msg`` and LinuxCNC
carries the text out on the error channel — "float switch activated, program is paused", "no
arc detected after 3 start attempts", "bottom limit reached while THC moving down". A toast
that has already faded is no use to whoever comes back to a paused machine and has to work out
why it stopped, which is why QtPlasmaC logs all of it and shows the log on its STATISTICS tab
(``qtplasmac.adoc`` "Error Messages").

Two things this layer adds beyond keeping the text:

* **Severity.** Upstream's own documentation splits the messages into *critical* — the program
  is paused and the cause has to be cleared — and *warning*, which is informational. The
  wording of each is stable and documented, so the split is made by matching it, and anything
  unrecognised is recorded as ``info`` rather than guessed at.
* **Recording regardless of who is watching.** The log is written whether or not a browser is
  connected. A fault that happened while nobody had the page open is exactly the one somebody
  will need to read later.

Saved files follow QtPlasmaC's own convention — ``machine_log_<yy-mm-dd_HH-MM-SS>.txt`` in the
config directory, five kept, oldest deleted — so the two GUIs leave one readable history rather
than two.
"""

from __future__ import annotations

import logging
import os
import re
import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

#: How many entries are held in memory. Generous, because the interesting one may be well
#: before the one that finally paused the program, and bounded, because this runs for weeks.
MAX_ENTRIES = 2000

#: Files kept in the config directory, as upstream keeps five.
MAX_LOG_FILES = 5

LOG_PREFIX = "machine_log_"

CRITICAL = "critical"
WARNING = "warning"
INFO = "info"

#: Fragments of the messages ``qtplasmac.adoc`` lists as **critical**: the program is paused
#: and the operator has to clear the cause. Matched as substrings because the component fills
#: in numbers and state names ("no arc detected after 3 start attempts").
_CRITICAL_PATTERNS: Tuple[str, ...] = (
    "breakaway switch activated",
    "float switch activated",
    "ohmic probe activated",
    "ohmic probe detected before probing",
    "float switch detected before probing",
    "breakaway switch detected before probing",
    "valid arc lost",
    "bottom limit reached while probing down",
    "material too high for safe traverse",
    "invalid pierce height",
    "invalid cut height",
    "invalid cut volts",
    "no arc detected after",
    "bottom limit reached while thc moving down",
    "top limit reached while thc moving up",
    "would exceed z axis maximum limit",
    "would exceed z axis maximum safe height",
    "offset limit violation",
    "invalid arc-voltage-in",
)

#: The same for **warnings**: informational, the program keeps running.
_WARNING_PATTERNS: Tuple[str, ...] = (
    "probe test aborted",
    "during consumable change",
    "breakaway switch detected during probe test",
    "probe trip error while probing",
    "bottom limit reached while probe testing",
    "probe height during float switch probe testing",
    "probe height during ohmic probe testing",
)

#: A critical message that is also a warning by wording — probe *testing* never pauses a
#: program — is settled by checking the warning list first.
_PROBE_TEST_HINT = re.compile(r"probe test", re.IGNORECASE)


def classify(message: str) -> str:
    """``critical``, ``warning`` or ``info`` for one message from the machine.

    Warnings are checked first on purpose: several share their wording with a critical
    message and differ only by happening during a probe *test*, which never pauses a program.
    """
    text = (message or "").lower()
    for pattern in _WARNING_PATTERNS:
        if pattern in text:
            return WARNING
    for pattern in _CRITICAL_PATTERNS:
        if pattern in text:
            # "bottom limit reached while probe testing" is a warning; the same limit hit
            # while cutting is critical. The probe-test wording decides.
            if _PROBE_TEST_HINT.search(text) and "probing down" not in text:
                return WARNING
            return CRITICAL
    return INFO


class LogEntry:
    """One line of the log. A plain object so it can carry both text and its classification."""

    __slots__ = ("at", "kind", "severity", "message")

    def __init__(self, at: float, kind: str, message: str, severity: Optional[str] = None) -> None:
        self.at = at
        self.kind = kind
        self.message = message
        self.severity = severity or classify(message)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "at": self.at,
            "kind": self.kind,
            "severity": self.severity,
            "message": self.message,
        }

    def as_line(self) -> str:
        """QtPlasmaC's own line shape: ``Thu20 19:43: <message>``.

        The component's messages often arrive in two lines ("no arc detected after 3 start
        attempts" / "program is paused."). They are flattened here so one entry is one line —
        a saved log is read by eye, and an entry that wraps looks like two events.
        """
        stamp = time.strftime("%a%d %H:%M", time.localtime(self.at))
        flat = " ".join(part.strip() for part in self.message.splitlines() if part.strip())
        return f"{stamp}: {flat}"


class MachineLog:
    """A bounded record of what the machine said, and the ability to save it like QtPlasmaC."""

    def __init__(self, max_entries: int = MAX_ENTRIES) -> None:
        self._entries: Deque[LogEntry] = deque(maxlen=max_entries)
        self._started = time.time()

    def record(self, kind: str, message: str) -> LogEntry:
        """Add one message. Returns the entry, so a caller can broadcast what was classified."""
        entry = LogEntry(time.time(), kind, (message or "").strip())
        self._entries.append(entry)
        if entry.severity == CRITICAL:
            logger.warning("plasma: critical machine message: %s", entry.message)
        return entry

    def entries(self, limit: Optional[int] = None, severity: Optional[str] = None) -> List[Dict[str, Any]]:
        """Newest last, optionally only one severity, optionally only the last ``limit``."""
        items = [e for e in self._entries if severity is None or e.severity == severity]
        if limit is not None and limit >= 0:
            items = items[-limit:]
        return [entry.as_dict() for entry in items]

    def last_critical(self) -> Optional[Dict[str, Any]]:
        """The most recent critical message — what an operator returning to a paused machine
        needs first."""
        for entry in reversed(self._entries):
            if entry.severity == CRITICAL:
                return entry.as_dict()
        return None

    def __len__(self) -> int:
        return len(self._entries)

    # ---- saving ----------------------------------------------------------------------

    def text(self) -> str:
        header = time.strftime("%a, %b %d %Y %H:%M:%S", time.localtime(self._started))
        lines = [f"--- Machine log started on: {header} ---"]
        lines += [entry.as_line() for entry in self._entries]
        return "\n".join(lines) + "\n"

    def save(self, directory: str, keep: int = MAX_LOG_FILES) -> Optional[str]:
        """Write the log into the config directory, keeping the newest ``keep`` files.

        Returns the path written, or ``None`` when there was nothing to write. Failing to save
        a log must never take the machine down with it, so problems are logged and swallowed.
        """
        if not self._entries:
            return None
        try:
            existing = sorted(
                name for name in os.listdir(directory) if name.startswith(LOG_PREFIX)
            )
            # Upstream keeps `keep` files including the one about to be written.
            for name in existing[: max(0, len(existing) - (keep - 1))]:
                os.remove(os.path.join(directory, name))
            path = os.path.join(
                directory, f"{LOG_PREFIX}{time.strftime('%y-%m-%d_%H-%M-%S')}.txt"
            )
            with open(path, "w") as handle:
                handle.write(self.text())
            return path
        except OSError:
            logger.warning("plasma: could not save the machine log to %s", directory, exc_info=True)
            return None
