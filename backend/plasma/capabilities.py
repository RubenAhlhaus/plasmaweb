"""What this machine's LinuxCNC can actually do, worked out from the pins it exports.

The pin table is generated from a 2.10 ``plasmac.comp``, but a shop runs whatever LinuxCNC its
distribution ships. On 2.9.4 eighteen of those pins simply do not exist — moving pierce, tube
cutting, laser mode, the slat height, the offset feed rate — and a write to a pin that is not
there is dropped by the bridge.

Dropped quietly is the problem. A ``Slat Height`` typed into the PARAMETERS tab is stored in the
prefs file, reads back correctly, and does nothing at all on that machine; the operator has no
way to tell. So the missing pins are turned into two answers:

* **Features**, for the things this UI would otherwise offer — "moving pierce needs a newer
  LinuxCNC" beats a control that appears to work.
* **Ineffective parameters**, for settings that are real in the file but reach no pin here.

Nothing is guessed: a feature is unavailable only because a pin it names is absent, and the
names come from the same generated table the bridge reads.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, NamedTuple, Tuple

from backend.plasma.parameters import PLASMA_PARAMETERS
from backend.plasma.pins import PLASMAC_COMPONENT


class Feature(NamedTuple):
    """One capability, and the ``plasmac.*`` pins it cannot work without."""

    name: str
    pins: Tuple[str, ...]
    #: What the feature is, in the terms the machine's owner would use.
    description: str


#: Features that depend on pins newer than every LinuxCNC in the wild.
#:
#: The pin names are the dashed ``plasmac.*`` ones, without the component prefix, exactly as the
#: generated table spells them.
FEATURES: Tuple[Feature, ...] = (
    Feature(
        "movingPierce",
        (
            "pierce-type",
            "pierce-motion-delay",
            "pierce-end-height",
            "cut-height-delay",
            "gouge-speed",
            "gouge-speed-distance",
            "creep-speed",
            "creep-speed-distance",
        ),
        "moving pierce — wiggle and ramp piercing, set from G-code with M159",
    ),
    Feature("tubeCutting", ("tube-cut",), "tube cutting with a rotary axis"),
    Feature("laserMode", ("laser-mode",), "laser mode for fibre lasers"),
    Feature("dryRun", ("dry-run",), "dry run — moving through a job without firing the torch"),
    Feature(
        "torchPulseHold",
        ("torch-pulse-hold", "torch-pulse-abort"),
        "holding and aborting a torch pulse",
    ),
    Feature(
        "offsetLimitWarning",
        ("offsets-limited",),
        "the warning when a THC offset runs out of travel",
    ),
    Feature("slatHeight", ("slat-height",), "slat height, used to keep rapids above the slats"),
    Feature(
        "offsetFeedRate",
        ("offset-feed-rate",),
        "a separate feed rate for offset probing moves",
    ),
    Feature(
        "materialThickness",
        ("material-thickness",),
        "telling the component the material thickness",
    ),
    Feature("probeResult", ("probe-out",), "reporting the probe result back to the GUI"),
)


def _bare(missing: Iterable[str]) -> set:
    """Missing pins arrive fully qualified (``plasmac.dry-run``); the tables are dashed names."""
    prefix = f"{PLASMAC_COMPONENT}."
    return {name[len(prefix):] if name.startswith(prefix) else name for name in missing}


def capabilities(missing_pins: Iterable[str]) -> Dict[str, Any]:
    """Feature availability and ineffective parameters for one machine.

    ``missing_pins`` is the bridge's own list, so this says what *this* LinuxCNC lacks rather
    than what some version is expected to lack.
    """
    absent = _bare(missing_pins)

    features: Dict[str, Any] = {}
    for feature in FEATURES:
        lacking = [pin for pin in feature.pins if pin in absent]
        features[feature.name] = {
            "available": not lacking,
            "missing": lacking,
            "description": feature.description,
        }

    # A parameter whose pin is absent still saves and still reads back; it just does nothing.
    ineffective: List[Dict[str, str]] = [
        {"key": parameter.key, "pin": f"{PLASMAC_COMPONENT}.{parameter.pin}"}
        for parameter in PLASMA_PARAMETERS
        if parameter.pin and parameter.pin in absent
    ]

    return {
        "features": features,
        "ineffectiveParameters": ineffective,
        "missingPins": sorted(f"{PLASMAC_COMPONENT}.{pin}" for pin in absent),
    }
