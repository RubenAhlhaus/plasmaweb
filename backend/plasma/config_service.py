"""Materials and plasma parameters: the files, the HAL setpoints, and the M190 handshake.

Three jobs, all about the same two files:

* hold what ``<machine>_material.cfg`` and ``<machine>.prefs`` say, and save edits back
* push a selection onto the ``plasmac.*`` setpoints, which is what makes a cut cut
* answer the material-change protocol a G-code program drives through our own pins

The protocol is upstream's, and it is a genuine handshake — ``nc_files/plasmac/m_files/M190``
raises ``qtplasmac.material_change`` and waits on ``motion.digital-in-03``:

===============================  ========================================================
``material_change`` reads        what the GUI must do
===============================  ========================================================
1, with a new ``…_number``       select that material, answer 2, raise digital-in-03
3 (already the current material)  raise digital-in-03, answer 0
0 (M190 finished)                 drop digital-in-03
===============================  ========================================================

Miss any of those and every ``M190`` in a program stalls for its half-second timeout and then
reports a material change failure, so this is worth getting exactly right.

Kept free of asyncio: :meth:`PlasmaConfigService.observe` returns the events it wants
published and lets the publisher do the sending.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Mapping, Optional, Tuple

from backend.plasma.hal_bridge import HalBridge, PinWriteRejected
from backend.plasma.machine_files import MachineFiles, read_config, write_config
from backend.plasma.materials import (
    Material,
    MaterialError,
    default_material,
    make_material,
    material_pin_values,
    read_materials,
    read_temporary_material,
    write_materials,
)
from backend.plasma.powermax import read_port as read_powermax_port
from backend.plasma.powermax import write_port as write_powermax_port
from backend.plasma.parameters import (
    check_parameters,
    parameter_limits,
    default_parameters,
    offset_probing_pin_values,
    read_offset_probing,
    read_gui_options,
    read_peripheral_offset,
    write_gui_option,
    write_peripheral_offset,
    write_offset_probing,
    read_conversational_settings,
    write_conversational_settings,
    enable_for_pin,
    parameter_pin_values,
    read_enables,
    read_parameters,
    write_enable,
    write_parameters,
)
from backend.plasma.pins import PLASMAC_COMPONENT, QTPLASMAC_COMPONENT

logger = logging.getLogger(__name__)

MATERIALS_EVENT = "plasma.materials.changed"
PARAMETERS_EVENT = "plasma.parameters.changed"
ERROR_EVENT = "plasma.config.error"

#: ``[GUI_OPTIONS] Default material`` in the prefs file — the one selected at startup and the
#: one ``material_change_number = -1`` means.
GUI_SECTION = "GUI_OPTIONS"
DEFAULT_MATERIAL_KEY = "Default material"

#: QtPlasmaC keeps the conversational pre/postamble here, alongside its other settings.
CONVERSATIONAL_SECTION = "CONVERSATIONAL"

#: QtPlasmaC's temporary-material drop box, written by its G-code filter.
TEMP_MATERIAL_DIR = "/tmp/qtplasmac"

#: The pin ``M190`` polls while it waits for the GUI to change material.
MATERIAL_ACK_PIN = "motion.digital-in-03"


class PlasmaConfigService:
    """The machine's materials and parameters, and the HAL side of both."""

    def __init__(
        self,
        bridge: HalBridge,
        files: MachineFiles,
        temp_material_path: Optional[str] = None,
    ) -> None:
        self._bridge = bridge
        self._files = files
        self._temp_material_path = temp_material_path or os.path.join(
            TEMP_MATERIAL_DIR, f"{files.machine}_material.gcode"
        )
        self._materials: Dict[int, Material] = {}
        self._parameters: Dict[str, Any] = {}
        self._enables: Dict[str, bool] = {}
        self._offset_probing: Dict[str, float] = {}
        self._selected: Optional[int] = None
        self._default: Optional[int] = None

    @property
    def prefs_path(self) -> str:
        """The machine's prefs file; also where its logs and material file live."""
        return self._files.prefs_path

    @property
    def selected_material(self) -> Tuple[int, str]:
        """``(number, name)`` of the material on the setpoints, for anything generating G-code."""
        material = self._materials.get(self._selected) if self._selected is not None else None
        if material is None:
            return 0, "Default"
        return material.number, material.name

    def conversational_defaults(self) -> Dict[str, Any]:
        """The shape parameters QtPlasmaC fills in from the machine rather than from the form.

        Upstream's conversational tab takes the kerf width from the *selected material* and the
        leadin, leadout, small-hole diameter, hole speed and origin mode from
        ``[CONVERSATIONAL]`` (``conv_settings.py:94``). Filling them here keeps a form to the
        shape's own geometry, and keeps one machine's cuts consistent between the two GUIs.
        """
        parser = read_config(self._files.prefs_path)

        def pref(key: str, fallback: Any, kind: type) -> Any:
            if not parser.has_option(CONVERSATIONAL_SECTION, key):
                return fallback
            raw = parser.get(CONVERSATIONAL_SECTION, key)
            try:
                return kind(float(raw))
            except (TypeError, ValueError):
                return fallback

        material = self._materials.get(self._selected) if self._selected is not None else None
        kerf = material.values["kerfWidth"] if material is not None else 1.0
        # QtPlasmaC's own default hole diameter is 32 mm / 1.26 in (`unitCode[2]`).
        hole_diameter = 1.26 if self._files.units_per_mm != 1.0 else 32.0
        return {
            "kerfWidth": kerf,
            "leadinLength": pref("Leadin", 0.0, float),
            "leadoutLength": pref("Leadout", 0.0, float),
            "smallHoleDia": pref("Hole diameter", hole_diameter, float),
            "smallHoleSpeed": pref("Hole speed", 60, int),
            # Origin 0 means "the shape's own corner", 1 means centre — upstream's CENT/LEFT.
            "isCenter": bool(pref("Origin", 0, int)),
        }

    def conversational_settings(self) -> Dict[str, Any]:
        """``[CONVERSATIONAL]`` as the UI sees it: the numeric settings plus the ambles."""
        return read_conversational_settings(
            self._files.prefs_path, self._files.units_per_mm
        )

    def save_conversational_settings(self, values: Mapping[str, Any]) -> Dict[str, Any]:
        """Store conversational settings and report them back as stored."""
        write_conversational_settings(self._files.prefs_path, values)
        return self.conversational_settings()

    def conversational_ambles(self) -> Tuple[str, str]:
        """``[CONVERSATIONAL] Preamble/Postamble`` from the prefs, or QtPlasmaC's defaults."""
        from backend.plasma.conversational import default_ambles  # noqa: PLC0415

        units = "inch" if self._files.units_per_mm != 1.0 else "mm"
        amble = default_ambles(units)
        parser = read_config(self._files.prefs_path)
        preamble = amble
        postamble = amble
        if parser.has_option(CONVERSATIONAL_SECTION, "Preamble"):
            preamble = parser.get(CONVERSATIONAL_SECTION, "Preamble") or amble
        if parser.has_option(CONVERSATIONAL_SECTION, "Postamble"):
            postamble = parser.get(CONVERSATIONAL_SECTION, "Postamble") or amble
        return preamble, postamble

    @property
    def files(self) -> MachineFiles:
        """Where this machine's plasma files are, and the unit scale they are written in."""
        return self._files

    # ---- loading -------------------------------------------------------------------

    def load(self) -> None:
        """Read both files. Temporary materials do not survive, exactly as upstream."""
        self._parameters = read_parameters(
            self._files.prefs_path, default_parameters(self._files)
        )
        self._enables = read_enables(self._files.prefs_path)
        self._offset_probing = read_offset_probing(self._files.prefs_path)
        self._materials = {
            material.number: material
            for material in read_materials(self._files.materials_path, self._files.units_per_mm)
        }
        if not self._materials:
            self._create_default_material()
        self._default = self._resolve_default_material()
        if self._selected not in self._materials:
            self._selected = self._default

    def _create_default_material(self) -> None:
        """A machine with no materials gets QtPlasmaC's material 0, written to the file.

        Upstream does the same on the update that introduced the material file, and without
        it there is nothing to select, so the cut parameters stay at zero and nothing cuts.
        """
        material = default_material(self._files.units_per_mm)
        self._materials = {material.number: material}
        try:
            write_materials(self._files.materials_path, [material])
            logger.info(
                "plasma: no materials in %s; wrote QtPlasmaC's default material 0",
                self._files.materials_path,
            )
        except OSError:
            # A read-only config directory is not a reason to run without a material.
            logger.exception("plasma: could not create %s", self._files.materials_path)

    def _resolve_default_material(self) -> Optional[int]:
        if not self._materials:
            return None
        numbers = sorted(self._materials)
        parser = read_config(self._files.prefs_path)
        if parser.has_option(GUI_SECTION, DEFAULT_MATERIAL_KEY):
            try:
                stored = int(float(parser.get(GUI_SECTION, DEFAULT_MATERIAL_KEY)))
            except ValueError:
                stored = None
            if stored is not None and stored in self._materials:
                return stored
        return numbers[0]

    # ---- payloads ------------------------------------------------------------------

    def materials_payload(self) -> Dict[str, Any]:
        return {
            "materials": [
                self._materials[number].as_dict() for number in sorted(self._materials)
            ],
            "selected": self._selected,
            "default": self._default,
            "path": self._files.materials_path,
        }

    def parameters_payload(self) -> Dict[str, Any]:
        return {
            "values": dict(self._parameters),
            # The bounds travel with the values: they depend on this machine's INI and on
            # each other, so a client cannot work them out and should not have to guess.
            "limits": {
                key: limit._asdict()
                for key, limit in parameter_limits(self._files, self._parameters).items()
            },
            "enables": dict(self._enables),
            "offsetProbing": dict(self._offset_probing),
            "guiOptions": self.gui_options(),
            "defaults": default_parameters(self._files),
            "unitsPerMm": self._files.units_per_mm,
            "path": self._files.prefs_path,
        }

    # ---- HAL ------------------------------------------------------------------------

    def apply_parameters(self) -> Tuple[str, ...]:
        """Push the parameters onto their ``plasmac.*`` setpoints. Returns pins refused.

        This is what a machine needs before it can cut: an ``Arc Maximum Starts`` of 0 stops
        the first pierce dead, and a ``Pid P Gain`` of 0 freezes the THC.
        """
        return self._write_plasmac(parameter_pin_values(self._parameters))

    def apply_offset_probing(self) -> Tuple[str, ...]:
        """Push ``[OFFSET_PROBING]`` onto its pins: where the probe is, and how long it takes."""
        return self._write_plasmac(offset_probing_pin_values(self._offset_probing))

    def powermax_port(self) -> str:
        """``[POWERMAX] Port`` — the serial port the power supply is on, if it has one."""
        return read_powermax_port(self._files.prefs_path)

    def save_powermax_port(self, port: str) -> str:
        write_powermax_port(self._files.prefs_path, port)
        return self.powermax_port()

    def powermax_setpoints(self) -> Dict[str, float]:
        """Cut mode, current and gas pressure for the selected material.

        These are the three values the power supply is told, and they come from the material
        rather than from a screen: a job that changes material changes the supply with it.
        """
        material = self._materials.get(self._selected) if self._selected is not None else None
        if material is None:
            return {"cutMode": 0.0, "cutAmps": 0.0, "gasPressure": 0.0}
        # `values` is keyed by our own JSON names, not the prefs file's keys.
        return {
            "cutMode": float(material.values.get("cutMode", 0.0)),
            "cutAmps": float(material.values.get("cutAmps", 0.0)),
            "gasPressure": float(material.values.get("gasPressure", 0.0)),
        }

    def gui_options(self) -> Dict[str, bool]:
        """``[GUI_OPTIONS]``: the switches QtPlasmaC remembers between runs."""
        return read_gui_options(self._files.prefs_path)

    def save_gui_option(self, name: str, value: bool) -> Dict[str, bool]:
        write_gui_option(self._files.prefs_path, name, value)
        return self.gui_options()

    def peripheral_offset(self, section: str) -> Dict[str, float]:
        """``[LASER_OFFSET]`` / ``[CAMERA_OFFSET]``: where the peripheral sits vs the torch."""
        return read_peripheral_offset(self._files.prefs_path, section)

    def save_peripheral_offset(self, section: str, values: Mapping[str, Any]) -> Dict[str, float]:
        write_peripheral_offset(self._files.prefs_path, section, values)
        return self.peripheral_offset(section)

    def set_laser(self, on: bool) -> None:
        """Our own ``qtplasmac.laser_on``, which a machine wires to the alignment laser."""
        self._bridge.request_write(QTPLASMAC_COMPONENT, "laser_on", bool(on))

    def save_offset_probing(self, values: Mapping[str, Any]) -> Dict[str, float]:
        """Store the offset probe settings and put them on the pins straight away."""
        merged = dict(self._offset_probing)
        merged.update(values)
        write_offset_probing(self._files.prefs_path, merged)
        self._offset_probing = read_offset_probing(self._files.prefs_path)
        self.apply_offset_probing()
        return dict(self._offset_probing)

    def apply_enables(self) -> Tuple[str, ...]:
        """Restore the remembered toggles. Without ``THC enable`` the torch height never moves."""
        return self._write_plasmac(self._enables)

    def save_enable(self, pin: str, value: bool) -> None:
        """Remember a toggle the operator flipped, so it survives a restart as it does upstream."""
        if enable_for_pin(pin) is None:
            return
        self._enables[pin] = bool(value)
        try:
            write_enable(self._files.prefs_path, pin, bool(value))
        except OSError:
            logger.exception("plasma: could not remember %s in %s", pin, self._files.prefs_path)

    def apply_selected_material(self) -> Tuple[str, ...]:
        if self._selected is None:
            return ()
        return self.select_material(self._selected)

    def select_material(self, number: int) -> Tuple[str, ...]:
        """Select a material: write its setpoints and tell HAL which one is current."""
        material = self._materials.get(number)
        if material is None:
            raise MaterialError("unknown_material", f"no material numbered {number}")
        self._selected = number
        refused = self._write_plasmac(material_pin_values(material))
        # Panels and the M190 handshake both read the selection back off this pin.
        self._write_own("material_change_number", number)
        return refused

    def _write_plasmac(self, pins: Mapping[str, Any]) -> Tuple[str, ...]:
        refused: List[str] = []
        for name, value in pins.items():
            try:
                self._bridge.request_write(PLASMAC_COMPONENT, name, value)
            except PinWriteRejected as exc:
                # A build without the pin, or a machine that wires it itself: both are the
                # machine's business, not a reason to abandon the rest of the parameters.
                logger.info("plasma: not writing plasmac.%s: %s", name, exc.message)
                refused.append(name)
        return tuple(refused)

    def _write_own(self, name: str, value: Any) -> None:
        try:
            self._bridge.request_write(QTPLASMAC_COMPONENT, name, value)
        except PinWriteRejected:
            logger.exception("plasma: could not write qtplasmac.%s", name)

    def _write_material_ack(self, raised: bool) -> None:
        """``motion.digital-in-03`` is the pin ``M190`` waits on."""
        try:
            self._bridge.request_external_write(MATERIAL_ACK_PIN, raised)
        except PinWriteRejected:
            logger.exception("plasma: could not answer the material change handshake")

    # ---- editing -------------------------------------------------------------------

    def save_material(self, number: int, name: str, values: Mapping[str, Any]) -> Material:
        """Add or update one material and write the file. Returns the stored material.

        Fields the caller leaves out keep whatever the material already had, and only fall
        back to QtPlasmaC's defaults for a material that does not exist yet — an edit of one
        field must not quietly reset a shop's pierce height.
        """
        existing = self._materials.get(number)
        merged: Dict[str, Any] = dict(existing.values) if existing is not None else {}
        merged.update(values)
        material = make_material(number, name, merged, self._files.units_per_mm)
        if material.temporary:
            raise MaterialError(
                "temporary_material",
                f"material numbers from {material.number} up belong to a program, not the file",
            )
        self._materials[material.number] = material
        write_materials(self._files.materials_path, list(self._materials.values()))
        self.load()
        if self._selected == material.number:
            self.select_material(material.number)
        return self._materials[material.number]

    def delete_material(self, number: int) -> None:
        if number not in self._materials:
            raise MaterialError("unknown_material", f"no material numbered {number}")
        del self._materials[number]
        write_materials(self._files.materials_path, list(self._materials.values()))
        self.load()
        if self._selected is not None and self._selected in self._materials:
            self.select_material(self._selected)

    def set_default_material(self, number: int) -> None:
        if number not in self._materials:
            raise MaterialError("unknown_material", f"no material numbered {number}")
        parser = read_config(self._files.prefs_path)
        if not parser.has_section(GUI_SECTION):
            parser.add_section(GUI_SECTION)
        parser.set(GUI_SECTION, DEFAULT_MATERIAL_KEY, str(number))
        write_config(self._files.prefs_path, parser)
        self._default = number

    def save_parameters(self, values: Mapping[str, Any]) -> Dict[str, Any]:
        """Store parameter edits, then push them to HAL so they take effect immediately.

        Every edit is checked against its bounds first, and the whole save is refused if one
        is out of range: these land on live setpoints, and a half-applied set of parameters is
        harder to reason about than a rejected one.
        """
        merged = dict(self._parameters)
        merged.update(check_parameters(self._files, values, self._parameters))
        write_parameters(self._files.prefs_path, merged)
        self._parameters = read_parameters(
            self._files.prefs_path, default_parameters(self._files)
        )
        self.apply_parameters()
        return dict(self._parameters)

    def reload(self) -> None:
        """Re-read both files and re-apply them, which is QtPlasmaC's RELOAD button."""
        self.load()
        self.apply_parameters()
        self.apply_enables()
        self.apply_offset_probing()
        self.apply_selected_material()

    # ---- the material change protocol ----------------------------------------------

    def observe(self, diff: Mapping[str, Mapping[str, Any]]) -> List[Tuple[str, Dict[str, Any]]]:
        """React to our own pins changing. Returns ``(event, payload)`` pairs to publish.

        Only pins in ``diff`` are looked at, so a program's ``M190`` is handled on the poll
        it happens and nothing is re-run on unrelated pin traffic.
        """
        own = diff.get(QTPLASMAC_COMPONENT, {})
        events: List[Tuple[str, Dict[str, Any]]] = []

        if "material_temp" in own:
            events += self._on_material_temp(own["material_temp"])
        if "material_reload" in own and own["material_reload"]:
            self.reload()
            events.append((MATERIALS_EVENT, self.materials_payload()))
            events.append((PARAMETERS_EVENT, self.parameters_payload()))
        if "material_change_number" in own:
            events += self._on_material_number(own["material_change_number"])
        if "material_change" in own:
            self._on_material_change(own["material_change"])
        if "material_change_timeout" in own and own["material_change_timeout"]:
            events += self._on_material_timeout()
        return events

    def _on_material_number(self, raw: Any) -> List[Tuple[str, Dict[str, Any]]]:
        try:
            number = int(raw)
        except (TypeError, ValueError):
            return []
        if number == -1:
            if self._default is None:
                return []
            number = self._default
        if number == self._selected:
            return []

        if number not in self._materials:
            # Upstream reports this and leaves the selection alone; M190 then times out.
            return [
                (
                    ERROR_EVENT,
                    {
                        "code": "unknown_material",
                        "message": f"Material #{number} is not in the material list",
                    },
                )
            ]

        automatic = self._own_value("material_change") == 1
        self.select_material(number)
        if automatic:
            self._write_material_ack(False)
            self._write_own("material_change", 2)
            self._write_material_ack(True)
        return [(MATERIALS_EVENT, self.materials_payload())]

    def _on_material_change(self, raw: Any) -> None:
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return
        if value == 0:
            self._write_material_ack(False)
        elif value == 3:
            # M190 asked for the material that is already selected: just acknowledge.
            self._write_material_ack(True)
            self._write_own("material_change", 0)

    def _on_material_timeout(self) -> List[Tuple[str, Dict[str, Any]]]:
        if self._selected is not None:
            self._write_own("material_change_number", self._selected)
        self._write_own("material_change_timeout", False)
        self._write_material_ack(False)
        return [
            (
                ERROR_EVENT,
                {
                    "code": "material_change_timeout",
                    "message": f"Material change timeout occurred for material #{self._selected}",
                },
            )
        ]

    def _on_material_temp(self, raw: Any) -> List[Tuple[str, Dict[str, Any]]]:
        try:
            number = int(raw)
        except (TypeError, ValueError):
            return []
        if not number:
            return []
        try:
            material = read_temporary_material(
                self._temp_material_path, number, self._files.units_per_mm
            )
        except (OSError, MaterialError) as exc:
            self._write_own("material_temp", 0)
            return [
                (
                    ERROR_EVENT,
                    {"code": "temporary_material_failed", "message": str(exc)},
                )
            ]

        self._materials[material.number] = material
        if self._selected == material.number:
            self.select_material(material.number)
        self._write_own("material_temp", 0)
        return [(MATERIALS_EVENT, self.materials_payload())]

    # ---- helpers -------------------------------------------------------------------

    def _own_value(self, name: str) -> Any:
        return self._bridge.snapshot().get(QTPLASMAC_COMPONENT, {}).get(name)
