"""Hypertherm PowerMax over RS485: reuse LinuxCNC's own component, own the wiring.

A PowerMax with an RS485 port will tell the machine its cut mode, current and gas pressure —
and report its faults — so a job can set the power supply from the material rather than from a
knob on the front of it. LinuxCNC already speaks that protocol in ``hal/user_comps/pmx485.py``,
a userspace component loaded with ``loadusr`` against a serial port. **Nothing here talks to
the serial port.** This layer does what QtPlasmaC's handler does around that component: check
the port before trusting it, load the component, net its pins, and turn its readings into
something an operator can act on.

Three details are ported deliberately:

* **The port is checked before the component is loaded** (``pmx485_check``,
  ``qtplasmac_handler.py:5582``). A ``loadusr`` against a port that is not there leaves a
  component sitting in HAL failing forever; a refusal up front is the kinder answer.
* **Connecting needs a valid cut mode and current.** Upstream refuses to enable comms while
  either is zero, because the power supply would be commanded to nothing.
* **A fault code is a four-digit number with a name**, formatted ``n-nn-n`` as Hypertherm
  writes it. The table is upstream's own, including the one code whose meaning depends on the
  machine's maximum current.

The three setpoints — mode, current, pressure — come from the *material*, not from a screen.
QtPlasmaC routes them through its spinbox HAL pins; we have pins of our own for the same job
(see ``WIDGET_SUBSTITUTES`` in the generator).
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from typing import Any, Dict, List, NamedTuple, Optional, Tuple

logger = logging.getLogger(__name__)

SECTION = "POWERMAX"
PORT_KEY = "Port"

#: The component LinuxCNC ships. Loaded by name, never reimplemented.
COMPONENT = "pmx485"

#: Baud rate the protocol runs at, and the one upstream opens the port with to test it.
BAUD = 19200

#: How the component's pins pair up with ours. ``(their pin, our pin)``, and the signal each
#: pair travels on is named the way ``pmx485_setup`` names it, so an existing
#: ``*_connections.hal`` keeps working.
NETS: Tuple[Tuple[str, str], ...] = (
    ("enable", "pmx485_enable"),
    ("status", "pmx485_status"),
    ("fault", "pmx485_fault"),
    ("mode_set", "pmx485_mode_set"),
    ("mode", "pmx485_mode"),
    ("current_set", "pmx485_current_set"),
    ("current", "pmx485_current"),
    ("current_min", "pmx485_current_min"),
    ("current_max", "pmx485_current_max"),
    ("pressure_set", "pmx485_pressure_set"),
    ("pressure", "pmx485_pressure"),
    ("pressure_min", "pmx485_pressure_min"),
    ("pressure_max", "pmx485_pressure_max"),
    ("arcTime", "pmx485_arc_time"),
)

#: Hypertherm's fault codes and what they mean (``pmx485FaultName``,
#: ``qtplasmac_handler.py:5813``). ``0210`` has two meanings, picked by the maximum current the
#: supply reports — over 110 A it is an arc voltage fault rather than a gas one.
FAULT_NAMES: Dict[str, Any] = {
    "0110": "Remote controller mode invalid",
    "0111": "Remote controller current invalid",
    "0112": "Remote controller pressure invalid",
    "0120": "Low input gas pressure",
    "0121": "Output gas pressure low",
    "0122": "Output gas pressure high",
    "0123": "Output gas pressure unstable",
    "0130": "AC input power unstable",
    "0199": "Power board hardware protection",
    "0200": "Low gas pressure",
    "0210": ("Gas flow lost while cutting", "Excessive arc voltage"),
    "0220": "No gas input",
    "0300": "Torch stuck open",
    "0301": "Torch stuck closed",
    "0320": "End of consumable life",
    "0400": "PFC/Boost IGBT module under temperature",
    "0401": "PFC/Boost IGBT module over temperature",
    "0402": "Inverter IGBT module under temperature",
    "0403": "Inverter IGBT module over temperature",
    "0500": "Retaining cap off",
    "0510": "Start/trigger signal on at power up",
    "0520": "Torch not connected",
    "0600": "AC input voltage phase loss",
    "0601": "AC input voltage too low",
    "0602": "AC input voltage too high",
    "0610": "AC input unstable",
    "0980": "Internal communication failure",
    "0990": "System hardware fault",
    "1000": "Digital signal processor fault",
    "1100": "A/D converter fault",
    "1200": "I/O fault",
    "2000": "A/D converter value out of range",
    "2010": "Auxiliary switch disconnected",
    "2100": "Inverter module temp sensor open",
    "2101": "Inverter module temp sensor shorted",
    "2110": "Pressure sensor is open",
    "2111": "Pressure sensor is shorted",
    "2200": "DSP does not recognize the torch",
    "3000": "Bus voltage fault",
    "3100": "Fan speed fault",
    "3101": "Fan fault",
    "3110": "PFC module temperature sensor open",
    "3111": "PFC module temperature sensor shorted",
    "3112": "PFC module temperature sensor circuit fault",
    "3200": "Fill valve",
    "3201": "Dump valve",
    "3202": "Valve ID",
    "3203": "Electronic regulator is disconnected",
    "3410": "Drive fault",
    "3420": "5 or 24 VDC fault",
    "3421": "18 VDC fault",
    "3430": "Inverter capacitors unbalanced",
    "3441": "PFC over current",
    "3511": "Inverter saturation fault",
    "3520": "Inverter shoot-through fault",
    "3600": "Power board fault",
    "3700": "Internal serial communications fault",
}

#: Above this current, ``0210`` means the second of its two meanings.
_HIGH_CURRENT = 110.0


class PowerMaxError(RuntimeError):
    """Comms could not be set up, with a machine-readable ``code``."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class Fault(NamedTuple):
    """One fault as the operator should see it."""

    #: ``0210`` — the raw four digits, as the supply reports them.
    raw: str
    #: ``0-21-0`` — Hypertherm's own grouping.
    code: str
    name: str

    def as_dict(self) -> Dict[str, str]:
        return {"raw": self.raw, "code": self.code, "name": self.name}


def read_port(prefs_path: str) -> str:
    """``[POWERMAX] Port`` from the machine's prefs, or empty when it has no PowerMax."""
    from backend.plasma.machine_files import read_config  # noqa: PLC0415 — avoids a cycle

    parser = read_config(prefs_path)
    if not parser.has_option(SECTION, PORT_KEY):
        return ""
    return (parser.get(SECTION, PORT_KEY) or "").strip()


def write_port(prefs_path: str, port: str) -> None:
    from backend.plasma.machine_files import read_config, write_config  # noqa: PLC0415

    parser = read_config(prefs_path)
    if not parser.has_section(SECTION):
        parser.add_section(SECTION)
    parser.set(SECTION, PORT_KEY, port.strip())
    write_config(prefs_path, parser)


def check_port(port: str, serial_module: Any = None, ports_module: Any = None) -> None:
    """Raise unless this port exists and can be opened at the protocol's baud rate.

    Checked before the component is loaded, because a ``loadusr`` against a port that is not
    there leaves a component in HAL failing forever with nothing said. The two modules are
    injectable so this can be tested without a serial port — production passes neither.
    """
    if not port:
        raise PowerMaxError("no_port", "this machine has no PowerMax port configured")
    if serial_module is None or ports_module is None:
        try:
            import serial  # noqa: PLC0415 — optional dependency, absent on a plain install
            import serial.tools.list_ports as list_ports  # noqa: PLC0415
        except ImportError as exc:
            raise PowerMaxError(
                "serial_missing",
                "python3-serial is not installed, so the PowerMax port cannot be checked",
            ) from exc
        serial_module = serial_module or serial
        ports_module = ports_module or list_ports

    available = [info[0] for info in ports_module.comports()]
    if port not in available:
        raise PowerMaxError("port_not_found", f"{port} cannot be found")
    try:
        handle = serial_module.Serial(port, BAUD)
        handle.close()
    except Exception as exc:  # pyserial raises its own hierarchy plus OSError
        raise PowerMaxError("port_unavailable", f"{port}: {exc}") from exc


def load_component(port: str, runner: Any = None, attempts: int = 3) -> None:
    """Load LinuxCNC's ``pmx485`` component against ``port``, if it is not loaded already.

    ``runner`` is injected for tests; by default this shells out to ``halcmd`` exactly as
    upstream does, because ``loadusr -W`` waits for the component to become ready and the
    python ``hal`` module has no equivalent.
    """
    run = runner or _halcmd
    for _ in range(max(1, attempts)):
        if run(["halcmd", "show", "comp", COMPONENT]):
            return
        run(["halcmd", "loadusr", "-Wn", COMPONENT, COMPONENT, port])
    if not run(["halcmd", "show", "comp", COMPONENT]):
        raise PowerMaxError(
            "component_failed",
            f"the {COMPONENT} component could not be loaded on {port}",
        )


def _halcmd(argv: List[str]) -> bool:
    """Run one halcmd. ``show comp`` doubles as the existence check: it fails if absent."""
    if shutil.which("halcmd") is None:
        raise PowerMaxError("halcmd_missing", "halcmd is not on PATH")
    try:
        completed = subprocess.run(
            argv, capture_output=True, text=True, timeout=20, env=os.environ
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise PowerMaxError("halcmd_failed", f"{argv[1]} failed: {exc}") from exc
    if argv[1:3] == ["show", "comp"]:
        # `show comp <name>` prints the component when it exists and nothing useful when not.
        return COMPONENT in (completed.stdout or "")
    return completed.returncode == 0


def format_fault(raw_value: float, current_max: float = 0.0) -> Optional[Fault]:
    """One fault reading, or ``None`` when there is no fault.

    The pin carries a float that is really four digits; ``0`` means healthy, which is the
    common case and must not read as a fault named "0000".
    """
    try:
        raw = f"{float(raw_value):04.0f}"
    except (TypeError, ValueError):
        return None
    if raw == "0000":
        return None

    name = FAULT_NAMES.get(raw)
    if isinstance(name, tuple):
        name = name[1] if current_max > _HIGH_CURRENT else name[0]
    elif name is None:
        name = "unknown Powermax fault code"
    return Fault(raw=raw, code=f"{raw[0]}-{raw[1:3]}-{raw[3]}", name=name)


def pressure_unit(pressure_max: float) -> str:
    """``psi`` or ``bar``, as upstream decides it: above 15 the supply is reporting psi."""
    return "psi" if pressure_max > 15 else "bar"
