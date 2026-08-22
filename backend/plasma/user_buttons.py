"""User buttons: the machine owner's own buttons, from ``[BUTTONS]`` in ``<machine>.prefs``.

QtPlasmaC lets a machine's owner define up to twenty buttons in the prefs file — a name and a
code each (``qtplasmac.adoc`` "Custom User Buttons") — and they are how a shop puts *its*
routines on the screen: a torch pulse of a particular length, a nesting file, a park position,
a HAL pin for the dust extractor.

The trust boundary is worth stating plainly, because one of the codes runs a shell command and
another writes an arbitrary HAL pin. **The code never comes from the browser.** It comes from a
file on the machine that only the machine's owner edits, the same file the cut parameters live
in; a client can only say "press button 3". That is the same trust as an INI-configured macro,
and it is why the pins a button may write are taken from the parsed config rather than from the
request.

Codes this layer runs are listed in :data:`SUPPORTED`. The rest are parsed, listed and marked
unsupported with a reason — a button that is defined but does nothing should say why, rather
than looking broken.
"""

from __future__ import annotations

import logging
import os
import shlex
from typing import Any, Dict, List, NamedTuple, Optional, Tuple

from backend.plasma.machine_files import read_config

logger = logging.getLogger(__name__)

SECTION = "BUTTONS"

#: QtPlasmaC reads twenty; how many are shown depends on its screen size, not on the file.
MAX_BUTTONS = 20

#: The codes this layer knows how to run, and what each one needs.
SUPPORTED = (
    "probe-test",
    "ohmic-test",
    "torch-pulse",
    "single-cut",
    "cut-type",
    "toggle-halpin",
    "pulse-halpin",
    "load",
    "latest-file",
    "gcode",
    "external",
)

#: Parsed, listed, and refused with a reason — each needs a feature this UI does not have yet.
UNSUPPORTED_REASONS = {
    "framing": "framing a job is not implemented yet",
    "manual-cut": "manual cut is not implemented yet",
    "offsets-view": "the offsets viewer is not implemented yet",
    "user-manual": "the built-in user manual is not implemented yet",
    "toggle-joint": "joint/teleop switching is not implemented yet",
    "toggle-laser": "the alignment laser is not implemented yet",
    "change-consumables": "the consumable change position is not implemented yet",
    "dual-code": "dual-code buttons are not implemented yet",
}

#: Longest a `pulse-halpin` may hold a pin. The duration comes from the machine's config, but a
#: typo of 600 instead of 0.6 would hold a solenoid on for ten minutes.
MAX_PULSE_SECONDS = 30.0


class UserButton(NamedTuple):
    """One configured button: what it says, what it does, and whether we can do it."""

    number: int
    name: str
    code: str
    kind: str
    #: Parsed arguments, per kind — ``{"pin": …}``, ``{"seconds": …}``, ``{"path": …}``.
    params: Dict[str, Any]
    supported: bool
    reason: Optional[str] = None

    def as_dict(self) -> Dict[str, Any]:
        return {
            "number": self.number,
            "name": self.name,
            "code": self.code,
            "kind": self.kind,
            "params": dict(self.params),
            "supported": self.supported,
            "reason": self.reason,
        }


def _classify(code: str) -> Tuple[str, Dict[str, Any], bool, Optional[str]]:
    """What kind of button this code is, and what it needs to run."""
    text = code.strip()
    if not text:
        return "empty", {}, False, "no code"

    if text.startswith("%"):
        # An external command or python script. Runs as the machine's user, from the machine's
        # own config file.
        return "external", {"command": text[1:].strip()}, True, None

    first = text.split()[0].lower()
    rest = text[len(text.split()[0]):].strip()

    if first in UNSUPPORTED_REASONS:
        return first, {}, False, UNSUPPORTED_REASONS[first]

    if "toggle-laser" in text.lower():
        return "toggle-laser", {}, False, UNSUPPORTED_REASONS["toggle-laser"]

    if first in ("toggle-halpin", "pulse-halpin"):
        parts = shlex.split(rest)
        if not parts:
            return first, {}, False, f"{first} needs a HAL pin name"
        params: Dict[str, Any] = {"pin": parts[0]}
        if first == "pulse-halpin":
            try:
                seconds = float(parts[1]) if len(parts) > 1 else 0.5
            except ValueError:
                return first, {}, False, "the pulse time is not a number"
            if not 0 < seconds <= MAX_PULSE_SECONDS:
                return first, {}, False, f"the pulse time must be 0…{MAX_PULSE_SECONDS:.0f}s"
            params["seconds"] = seconds
        # `cutcritical` marks a pin that must not be left on while cutting; recorded, not acted
        # on here — the realtime side owns that interlock.
        params["cutCritical"] = "cutcritical" in rest.lower()
        return first, params, True, None

    if first in ("probe-test", "torch-pulse"):
        seconds = 5.0 if first == "probe-test" else 0.5
        if rest:
            try:
                seconds = float(rest.split()[0])
            except ValueError:
                return first, {}, False, "the time is not a number"
        return first, {"seconds": seconds}, True, None

    if first in ("ohmic-test", "single-cut", "cut-type"):
        return first, {}, True, None

    if first in ("load", "latest-file"):
        target = rest.strip()
        if not target:
            return first, {}, False, f"{first} needs a path"
        return first, {"path": os.path.expanduser(target)}, True, None

    # Anything else is G-code for the MDI, which is what upstream does with it.
    return "gcode", {"gcode": text}, True, None


def read_user_buttons(prefs_path: str) -> List[UserButton]:
    """Every configured button, in number order.

    A name without a code (or the other way round) is upstream's own error case: the button is
    listed but refused, because half a definition is more likely a typo than an intention.
    """
    parser = read_config(prefs_path)
    buttons: List[UserButton] = []
    for number in range(1, MAX_BUTTONS + 1):
        name = ""
        code = ""
        if parser.has_option(SECTION, f"{number} Name"):
            name = parser.get(SECTION, f"{number} Name") or ""
        if parser.has_option(SECTION, f"{number} Code"):
            code = parser.get(SECTION, f"{number} Code") or ""
        if not name and not code:
            continue

        # QtPlasmaC splits the label on backslashes for multi-line buttons.
        label = name.replace("\\", "\n")
        if not name or not code:
            buttons.append(
                UserButton(
                    number,
                    label,
                    code,
                    "invalid",
                    {},
                    False,
                    "a button needs both a name and a code",
                )
            )
            continue

        kind, params, supported, reason = _classify(code)
        buttons.append(UserButton(number, label, code, kind, params, supported, reason))
    return buttons


def user_button(prefs_path: str, number: int) -> UserButton:
    """One button by number, or a ``KeyError`` if the machine has no such button."""
    for button in read_user_buttons(prefs_path):
        if button.number == number:
            return button
    raise KeyError(number)


class UserButtonError(RuntimeError):
    """A button that could not be run, with a machine-readable ``code``."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def allow_configured_pins(bridge: Any, buttons: List[UserButton]) -> List[str]:
    """Let the bridge write the HAL pins this machine's buttons name. Returns them.

    Called once when the buttons are read, so the permission comes from the config file rather
    than from whoever presses the button.
    """
    allowed: List[str] = []
    for button in buttons:
        pin = button.params.get("pin")
        if button.kind in ("toggle-halpin", "pulse-halpin") and pin:
            bridge.allow_external_pin(pin)
            allowed.append(pin)
    return allowed


def latest_file(directory: str) -> str:
    """The most recently modified ``.ngc`` in a directory — upstream's ``latest-file``."""
    if not os.path.isdir(directory):
        raise UserButtonError("directory_not_found", f"no such directory: {directory}")
    candidates = [
        os.path.join(directory, name)
        for name in os.listdir(directory)
        if name.lower().endswith((".ngc", ".nc", ".tap"))
    ]
    files = [path for path in candidates if os.path.isfile(path)]
    if not files:
        raise UserButtonError("no_programs", f"no G-code files in {directory}")
    return max(files, key=os.path.getmtime)
