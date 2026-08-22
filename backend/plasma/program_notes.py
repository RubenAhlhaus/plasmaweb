"""What a program asks the machine for, read off its own text.

QtPlasmaC's G-code filter acts on a handful of magic parameter assignments — hole velocity,
pierce-only, keep-z-motion, tube cutting — and each one changes what the machine does with the
program (``qtplasmac_gcode.py``). None of them are visible in the toolpath, so a program that
asks for tube cutting looks exactly like one that does not.

Two things make this worth reporting rather than ignoring:

* **A program can ask for something this machine cannot do.** Tube cutting needs
  ``plasmac.tube-cut``, which LinuxCNC 2.9.4 does not have. The filter's ``halcmd setp`` fails,
  the program runs anyway, and the Z bypass it depends on never happens.
* **The documented spelling of two directives is not the one the filter matches.** The manual
  writes ``#<tube_cut>=1`` and the filter looks for ``#<tube-cut>=1``; same for
  ``keep-z-motion``. A program following the documentation is silently ignored, which is
  exactly the kind of thing an operator cannot debug from the outside.

Nothing here changes the program. It reads it and says what it found.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, NamedTuple, Optional, Tuple


class Directive(NamedTuple):
    """One magic assignment the filter acts on."""

    #: What we call it, and the key the UI translates.
    name: str
    #: The spelling ``qtplasmac_gcode.py`` actually matches.
    spelling: str
    #: The spelling the manual documents, when it differs from the one above.
    documented: Optional[str]
    #: The capability this needs, if any — see :mod:`backend.plasma.capabilities`.
    feature: Optional[str]


DIRECTIVES: Tuple[Directive, ...] = (
    Directive("tubeCut", "tube-cut", "tube_cut", "tubeCutting"),
    Directive("keepZMotion", "keep-z-motion", "keep_z_motion", None),
    Directive("holes", "holes", None, None),
    Directive("holeDiameter", "h_diameter", None, None),
    Directive("holeVelocity", "h_velocity", None, None),
    Directive("overCutLength", "oclength", None, None),
)

#: `#<name>=value`, tolerant of the spaces the filter strips before matching.
_ASSIGNMENT = re.compile(r"#\s*<\s*([A-Za-z_][A-Za-z0-9_-]*)\s*>\s*=\s*([-+]?[0-9.]+)")


def read_program_notes(text: str, capabilities: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Directives this program sets, plus anything about them worth telling the operator.

    ``capabilities`` is the report from :func:`backend.plasma.capabilities.capabilities`; when
    given, a directive whose feature is unavailable is called out by name.
    """
    found: Dict[str, Any] = {}
    warnings: List[Dict[str, str]] = []

    assignments = {
        name.lower(): value for name, value in _ASSIGNMENT.findall(text or "")
    }

    for directive in DIRECTIVES:
        value = assignments.get(directive.spelling.lower())
        if value is not None:
            found[directive.name] = float(value)
            feature = directive.feature
            if feature and capabilities is not None:
                report = (capabilities.get("features") or {}).get(feature)
                if report is not None and not report.get("available", True):
                    warnings.append(
                        {
                            "code": "feature_unavailable",
                            "directive": directive.name,
                            "message": (
                                f"this program asks for {report.get('description', feature)}, "
                                "which this LinuxCNC cannot do"
                            ),
                        }
                    )
            continue

        # The documented spelling, which the filter does not match. Reported whenever it is
        # present *and* the real one is not: the program means it and nothing will happen.
        if directive.documented and assignments.get(directive.documented.lower()) is not None:
            warnings.append(
                {
                    "code": "spelling_ignored",
                    "directive": directive.name,
                    "message": (
                        f"#<{directive.documented}> is the documented spelling but the G-code "
                        f"filter matches #<{directive.spelling}>, so this line does nothing"
                    ),
                }
            )

    return {"directives": found, "warnings": warnings}
