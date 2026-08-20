#!/usr/bin/env python3
"""Generate backend/plasma/pins.py from the vendored LinuxCNC reference tree.

Three sources, all under reference/linuxcnc (see UPSTREAM.md):

* src/hal/components/plasmac.comp                     — the realtime component's pins
* lib/hallib/*.hal, configs/sim/qtplasmac/*            — which plasmac pins HAL drives
* share/qtvcp/screens/qtplasmac/qtplasmac_handler.py  — the 91 pins QtPlasmaC's own
                                                        userspace component exports

Run after bumping the reference tree:

    venv/bin/python scripts/gen_plasma_pins.py

The generated module is committed; nothing at runtime reads reference/, which is a
development-only checkout.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Dict, Iterable, List, NamedTuple, Set, Tuple

ROOT = Path(__file__).resolve().parent.parent
REFERENCE = ROOT / "reference" / "linuxcnc"
COMP_FILE = REFERENCE / "src" / "hal" / "components" / "plasmac.comp"
#: Every reference file that wires plasmac pins into a machine. A plasmac in-pin netted in
#: any of them is fed by HAL, not by us.
HALFILES = (
    REFERENCE / "lib" / "hallib" / "qtplasmac_comp.hal",
    REFERENCE / "lib" / "hallib" / "plasmac.tcl",
    REFERENCE / "configs" / "sim" / "qtplasmac" / "sim_no_stepgen.tcl",
    REFERENCE / "configs" / "sim" / "qtplasmac" / "sim_stepgen.tcl",
    REFERENCE / "configs" / "sim" / "qtplasmac" / "sim_postgui.hal",
    REFERENCE / "configs" / "sim" / "qtplasmac" / "machine.tcl",
    REFERENCE / "configs" / "sim" / "qtplasmac" / "custom.hal",
)
HANDLER = REFERENCE / "share" / "qtvcp" / "screens" / "qtplasmac" / "qtplasmac_handler.py"

#: Own-component pins QtPlasmaC declares HAL_IN yet writes itself (``…Pin.set(…)`` in the
#: handler). They are its half of a handshake with a G-code filter or an M-code remap — the
#: material change protocol and the cut type — so the GUI has to be able to drive them even
#: though HAL calls them inputs. Everything else on our component that is an input really is
#: driven from outside and stays read-only.
GUI_DRIVEN_OWN_PINS = frozenset(
    {
        "cut_type",
        "material_change",
        "material_change_number",
        "material_change_timeout",
        "material_reload",
        "material_temp",
    }
)
OUTPUT = ROOT / "backend" / "plasma" / "pins.py"

# `pin in  real    arc_ok_high = 1   "docs";`
COMP_PIN_RE = re.compile(
    r'^pin\s+(?P<dir>in|out)\s+(?P<type>bool|real|si32|u32)\s+'
    r'(?P<name>\w+)\s*(?:=\s*(?P<default>\S+))?\s*"(?P<doc>.*)"\s*;'
)
# `CALL(['halcmd', 'net', 'plasmac:z-height', 'plasmac.z-height', 'qtplasmac.z_height'])`
NET_RE = re.compile(r"CALL\(\['halcmd',\s*'net',\s*(?P<members>[^\]]+)\]\)")
# `self.xPin = self.h.newpin('ext_abort', hal.HAL_BIT, hal.HAL_IN)`
NEWPIN_RE = re.compile(
    r"newpin\(\s*'(?P<name>[\w]+)'\s*,\s*hal\.HAL_(?P<type>BIT|FLOAT|S32|U32)\s*,"
    r"\s*hal\.HAL_(?P<dir>IN|OUT)\s*\)"
)

COMP_TYPES = {"bool": "bit", "real": "float", "si32": "s32", "u32": "u32"}
HANDLER_TYPES = {"BIT": "bit", "FLOAT": "float", "S32": "s32", "U32": "u32"}


class Pin(NamedTuple):
    name: str  # HAL name without the component prefix, dashed
    type: str  # bit | float | s32 | u32
    direction: str  # in | out (as seen by the owning component)
    doc: str


def parse_comp(path: Path) -> List[Pin]:
    pins: List[Pin] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = COMP_PIN_RE.match(line.strip())
        if not m:
            continue
        pins.append(
            Pin(
                name=m.group("name").replace("_", "-"),
                type=COMP_TYPES[m.group("type")],
                direction=m.group("dir"),
                doc=" ".join(m.group("doc").split()),
            )
        )
    if not pins:
        raise SystemExit(f"no pins parsed from {path}")
    return pins


def parse_handler(path: Path) -> List[Pin]:
    """QtPlasmaC's own component pins, with their names exactly as upstream exports them.

    No underscore/dash conversion here: ``halcompile`` rewrites ``_`` to ``-`` for .comp
    files, but ``hal.component().newpin()`` takes the name verbatim, so QtPlasmaC's pins
    really are ``qtplasmac.ext_abort``. Existing ``*_connections.hal`` files net those
    names, and drop-in compatibility is the whole point of reusing the component name.
    """
    pins: List[Pin] = []
    for m in NEWPIN_RE.finditer(path.read_text(encoding="utf-8", errors="replace")):
        pins.append(
            Pin(
                name=m.group("name"),
                type=HANDLER_TYPES[m.group("type")],
                direction=m.group("dir").lower(),
                doc="",
            )
        )
    if not pins:
        raise SystemExit(f"no newpin() calls parsed from {path}")
    return pins


def parse_nets(path: Path, own_pins: Set[str]) -> List[Tuple[str, Tuple[str, ...]]]:
    """The HAL links QtPlasmaC's ``link_hal_pins`` creates, minus the ones we cannot make.

    Upstream nets two families of pin: its own component's pins, and the HAL pins QtVCP
    creates for HAL-aware *widgets* (``qtplasmac.arc_fail_delay-f`` and friends). We have no
    widgets, and our backend writes those parameters straight to ``plasmac.*`` instead, so
    widget nets are dropped and only links we can actually satisfy are kept.
    """
    nets: List[Tuple[str, Tuple[str, ...]]] = []
    for match in NET_RE.finditer(path.read_text(encoding="utf-8", errors="replace")):
        members = [token.strip().strip("'\"") for token in match.group("members").split(",")]
        members = [token for token in members if token]
        if len(members) < 2:
            continue
        signal, endpoints = members[0], tuple(members[1:])
        keep = True
        for endpoint in endpoints:
            component, _, pin = endpoint.partition(".")
            if component == "qtplasmac" and pin not in own_pins:
                keep = False  # a QtVCP widget pin; we have no widgets
                break
        if keep:
            nets.append((signal, endpoints))
    if not nets:
        raise SystemExit(f"no link_hal_pins nets parsed from {path}")
    return nets


def parse_hal_driven(paths: Iterable[Path]) -> Set[str]:
    """plasmac pins that a reference HAL file nets.

    Those are fed by HAL (motion, halui, debounce filters, the axis feedback), so the
    backend must never write them — doing so would fight the realtime side. ``setp`` lines
    are deliberately ignored: a config *presetting* a parameter (``setp plasmac.mode``)
    does not make that parameter HAL-owned.
    """
    driven: Set[str] = set()
    for path in paths:
        if not path.exists():
            raise SystemExit(f"reference HAL file missing: {path}")
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.split("#", 1)[0].strip()
            if not line.startswith("net "):
                continue
            for token in line.split()[2:]:
                if token in ("=>", "<="):
                    continue
                if token.startswith("plasmac."):
                    driven.add(token.split(".", 1)[1])
    return driven


#: An in-pin whose documentation says where to wire it, or that it reads an external
#: switch, is machine-wired even when no reference config happens to net it.
_WIRED_DOC_RE = re.compile(r"connect to |^external |external .*(input|switch)")


def is_machine_wired(pin: "Pin") -> bool:
    # ``*-in`` is upstream's naming for a hardware feed (arc-ok-in, arc-voltage-in,
    # ohmic-sense-in); those come from the machine, never from us.
    return bool(_WIRED_DOC_RE.search(pin.doc.lower())) or pin.name.endswith("-in")


def reference_revision() -> str:
    try:
        out = subprocess.run(
            ["git", "-C", str(REFERENCE), "describe", "--tags", "--always", "--dirty"],
            capture_output=True,
            text=True,
            check=True,
        )
        return out.stdout.strip()
    except (subprocess.CalledProcessError, OSError):
        return "unknown"


def render(
    plasmac: List[Pin],
    qtplasmac: List[Pin],
    hal_driven: Set[str],
    nets: List[Tuple[str, Tuple[str, ...]]],
) -> str:
    def policy_of(pin: Pin) -> str:
        if pin.direction == "out":
            return "REALTIME_OUT"
        if pin.doc.strip().lower() in ("deprecated", "unused"):
            return "DEPRECATED"
        if pin.name in hal_driven or is_machine_wired(pin):
            return "HAL_DRIVEN"
        return "SETPOINT"

    def rows(pins: List[Pin], policy) -> str:
        lines = []
        for pin in sorted(pins, key=lambda p: p.name):
            doc = pin.doc.replace('"', "'")
            lines.append(
                f'    PlasmaPin("{pin.name}", "{pin.type}", "{pin.direction}", '
                f'{policy(pin)}, "{doc}"),'
            )
        return "\n".join(lines)

    def qt_policy(pin: Pin) -> str:
        if pin.direction == "out":
            return "OWNED_OUT"
        return "OWNED_ACK" if pin.name in GUI_DRIVEN_OWN_PINS else "EXTERNAL_IN"

    net_rows = "\n".join(
        f'    HalNet("{signal}", ({", ".join(chr(34) + m + chr(34) for m in members)},)),'
        for signal, members in nets
    )
    setpoints = sum(1 for p in plasmac if policy_of(p) == "SETPOINT")
    hal_driven_count = sum(
        1 for p in plasmac if policy_of(p) in ("HAL_DRIVEN", "DEPRECATED")
    )
    realtime_count = sum(1 for p in plasmac if policy_of(p) == "REALTIME_OUT")

    return f'''"""HAL pin tables for the plasma layer — GENERATED, do not edit by hand.

Regenerate with ``scripts/gen_plasma_pins.py`` after bumping the reference tree.

Sources (reference/linuxcnc @ {reference_revision()}):
  * src/hal/components/plasmac.comp                    {len(plasmac)} pins
  * lib/hallib/*.hal + configs/sim/qtplasmac/*          {len(hal_driven)} HAL-netted pins
  * share/qtvcp/screens/qtplasmac/qtplasmac_handler.py {len(qtplasmac)} own-component pins

The write policy is the safety boundary from BUILD_PLAN.md expressed as data:

  SETPOINT      plasmac in-pin the GUI owns (a parameter or a one-shot request) — writable
  HAL_DRIVEN    plasmac in-pin wired in HAL (motion, halui, debounce, hardware) — read-only
  DEPRECATED    plasmac in-pin upstream marks dead — read-only
  REALTIME_OUT  plasmac out-pin produced by the realtime component — read-only
  EXTERNAL_IN   pin on our own ``qtplasmac`` component driven from outside — read-only
  OWNED_ACK     input on our own component that the GUI answers with (material change
                handshake, cut type) — writable
  OWNED_OUT     pin on our own ``qtplasmac`` component — we drive it

Only SETPOINT, OWNED_ACK and OWNED_OUT are writable. ``is_writable`` is the single check the
HAL bridge makes; nothing else may bypass it.

Pin sets differ between LinuxCNC releases (2.9.4 ships 127 plasmac in-pins, the 2.10
reference 144), so callers must treat a missing pin as absent rather than fatal — see
``missing_pins``.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, NamedTuple, Tuple

#: Component name of the realtime plasma controller.
PLASMAC_COMPONENT = "plasmac"
#: Component name we export ourselves — same name QtPlasmaC uses, so existing
#: ``*_connections.hal`` files and external control panels keep working.
QTPLASMAC_COMPONENT = "qtplasmac"

SETPOINT = "setpoint"
HAL_DRIVEN = "hal_driven"
REALTIME_OUT = "realtime_out"
DEPRECATED = "deprecated"
EXTERNAL_IN = "external_in"
OWNED_ACK = "owned_ack"
OWNED_OUT = "owned_out"

WRITABLE_POLICIES = frozenset({{SETPOINT, OWNED_ACK, OWNED_OUT}})


class PlasmaPin(NamedTuple):
    """One HAL pin. ``name`` carries no component prefix; use :func:`hal_name`."""

    name: str
    type: str
    direction: str
    policy: str
    doc: str = ""


#: ``plasmac.*`` — {setpoints} setpoints, {hal_driven_count} HAL-driven/deprecated,
#: {realtime_count} realtime outputs.
PLASMAC_PINS: Tuple[PlasmaPin, ...] = (
{rows(plasmac, policy_of)}
)

#: ``qtplasmac.*`` — the userspace component QtPlasmaC exports and we must recreate,
#: with upstream's exact pin names (underscores) so existing HAL wiring keeps working.
QTPLASMAC_PINS: Tuple[PlasmaPin, ...] = (
{rows(qtplasmac, qt_policy)}
)

class HalNet(NamedTuple):
    """One ``halcmd net`` line: a signal name and the pins to link to it."""

    signal: str
    members: Tuple[str, ...]


#: The links QtPlasmaC's ``link_hal_pins()`` makes, restricted to ones we can satisfy.
#: Without these the plasma layer runs but the machine misbehaves — most visibly, the
#: ``plasmac.axis-*-limit`` inputs stay at 0 and every probe fails.
HAL_NETS: Tuple[HalNet, ...] = (
{net_rows}
)


_PLASMAC_BY_NAME: Dict[str, PlasmaPin] = {{pin.name: pin for pin in PLASMAC_PINS}}
_QTPLASMAC_BY_NAME: Dict[str, PlasmaPin] = {{pin.name: pin for pin in QTPLASMAC_PINS}}


def hal_name(component: str, pin: PlasmaPin) -> str:
    """Full HAL name, e.g. ``plasmac.pierce-height``."""
    return f"{{component}}.{{pin.name}}"


def plasmac_pin(name: str) -> PlasmaPin:
    """Look up a ``plasmac.*`` pin by its dashed name. Raises ``KeyError`` if unknown."""
    return _PLASMAC_BY_NAME[name]


def qtplasmac_pin(name: str) -> PlasmaPin:
    """Look up a ``qtplasmac.*`` pin by its dashed name. Raises ``KeyError`` if unknown."""
    return _QTPLASMAC_BY_NAME[name]


def is_writable(pin: PlasmaPin) -> bool:
    """Whether the backend may write this pin. The whole safety boundary in one call."""
    return pin.policy in WRITABLE_POLICIES


def writable_plasmac_pins() -> Tuple[PlasmaPin, ...]:
    return tuple(pin for pin in PLASMAC_PINS if is_writable(pin))


def readable_plasmac_pins() -> Tuple[PlasmaPin, ...]:
    """Every ``plasmac.*`` pin is readable; only the policy differs."""
    return PLASMAC_PINS


def missing_pins(existing: Iterable[str], pins: Iterable[PlasmaPin], component: str) -> List[str]:
    """Names in ``pins`` that ``existing`` (live HAL pin names) does not contain.

    Used at startup to log which pins this LinuxCNC build lacks instead of failing.
    """
    have = set(existing)
    return [
        hal_name(component, pin) for pin in pins if hal_name(component, pin) not in have
    ]
'''


def main() -> None:
    plasmac = parse_comp(COMP_FILE)
    qtplasmac = parse_handler(HANDLER)
    hal_driven = parse_hal_driven(HALFILES)

    unknown = set(hal_driven) - {pin.name for pin in plasmac}
    if unknown:
        raise SystemExit(f"halfile nets unknown plasmac pins: {sorted(unknown)}")

    # The halfile also nets plasmac *outputs* into motion/axis; those are REALTIME_OUT by
    # direction already, so only in-pins matter for the policy.
    in_pins = {pin.name for pin in plasmac if pin.direction == "in"}
    hal_driven &= in_pins

    nets = parse_nets(HANDLER, {pin.name for pin in qtplasmac})

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    (OUTPUT.parent / "__init__.py").touch()
    OUTPUT.write_text(render(plasmac, qtplasmac, hal_driven, nets), encoding="utf-8")
    print(
        f"{OUTPUT.relative_to(ROOT)}: {len(plasmac)} plasmac pins "
        f"({len(hal_driven)} HAL-driven), {len(qtplasmac)} qtplasmac pins, {len(nets)} nets"
    )


if __name__ == "__main__":
    main()
