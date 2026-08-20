"""``<machine>_material.cfg``: the cut materials, and what selecting one writes to HAL.

The file is INI-shaped, one ``[MATERIAL_NUMBER_<n>]`` section per material with exactly the
fourteen keys ``read_one_material()`` reads (``qtplasmac_handler.py:5299``). Material numbers
below 1000000 are the saved ones; **1000000 and up are temporary** materials that a program
declares through a magic comment, which QtPlasmaC keeps in memory only and drops on reload
(``remove_temp_materials()``) — so they must never reach the file.

Selecting a material is what actually cuts: QtPlasmaC pushes its values into the parameter
widgets, whose HAL pins are netted to ``plasmac.*`` setpoints (``change_material()``). We
write those setpoints directly, for the reason given in :mod:`backend.plasma.parameters`.

Three of the fourteen keys are not plasmac's business at all: ``CUT_AMPS``, ``GAS_PRESSURE``
and ``CUT_MODE`` are for a Hypertherm PowerMax over RS485 (``qtplasmac.adoc`` "Hypertherm
PowerMax Communications"), and reach it through the ``pmx485`` pins rather than plasmac.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List, Mapping, NamedTuple, Optional, Tuple

from backend.plasma.machine_files import read_config, write_config

logger = logging.getLogger(__name__)

SECTION_PREFIX = "MATERIAL_NUMBER_"

#: QtPlasmaC's boundary between saved and temporary materials.
TEMPORARY_FROM = 1_000_000


class MaterialField(NamedTuple):
    """One key of a material section: its file key, our JSON name, and where it goes."""

    key: str
    name: str
    #: ``units_per_mm`` → default, for a key the file does not have.
    default: Callable[[float], float]
    #: The ``plasmac.*`` setpoint this field drives, or ``None`` when it is not plasmac's.
    pin: Optional[str]


def _fixed(value: float) -> Callable[[float], float]:
    return lambda _units_per_mm: value


def _scaled(value: float) -> Callable[[float], float]:
    return lambda units_per_mm: value * units_per_mm


#: The fourteen keys, in the order QtPlasmaC writes them, so a section we write reads back the
#: way it went in.
#:
#: The unit-scaled defaults *multiply* by ``units_per_mm``. Upstream's ``read_one_material``
#: divides (``1.0 / self.unitsPerMm``), which on an imperial machine turns a 1 mm kerf default
#: into 25.4 inches; it only ever shows up for a key missing from the file, and matching the
#: bug would be worse than being quietly right.
MATERIAL_FIELDS: Tuple[MaterialField, ...] = (
    MaterialField("NAME", "name", _fixed(0.0), None),
    MaterialField("KERF_WIDTH", "kerfWidth", _scaled(1.0), "kerf-width"),
    MaterialField("PIERCE_HEIGHT", "pierceHeight", _scaled(3.0), "pierce-height"),
    MaterialField("PIERCE_DELAY", "pierceDelay", _fixed(0.2), "pierce-delay"),
    MaterialField("PUDDLE_JUMP_HEIGHT", "puddleJumpHeight", _fixed(0.0), "puddle-jump-height"),
    MaterialField("PUDDLE_JUMP_DELAY", "puddleJumpDelay", _fixed(0.0), "puddle-jump-delay"),
    MaterialField("CUT_HEIGHT", "cutHeight", _scaled(1.0), "cut-height"),
    MaterialField("CUT_SPEED", "cutSpeed", _scaled(2000.0), "cut-feed-rate"),
    MaterialField("CUT_AMPS", "cutAmps", _fixed(45.0), None),
    MaterialField("CUT_VOLTS", "cutVolts", _fixed(100.0), "cut-volts"),
    MaterialField("PAUSE_AT_END", "pauseAtEnd", _fixed(0.0), "pause-at-end"),
    MaterialField("GAS_PRESSURE", "gasPressure", _fixed(0.0), None),
    MaterialField("CUT_MODE", "cutMode", _fixed(1.0), None),
    MaterialField("THICKNESS", "thickness", _fixed(0.0), "material-thickness"),
)

_VALUE_FIELDS: Tuple[MaterialField, ...] = tuple(f for f in MATERIAL_FIELDS if f.key != "NAME")
_BY_NAME: Dict[str, MaterialField] = {f.name: f for f in MATERIAL_FIELDS}


class MaterialError(ValueError):
    """A material that cannot be stored, with a machine-readable ``code``."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class Material(NamedTuple):
    """One material: its number, its name, and the twelve numbers that define the cut."""

    number: int
    name: str
    values: Dict[str, float]

    @property
    def temporary(self) -> bool:
        return self.number >= TEMPORARY_FROM

    def as_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"number": self.number, "name": self.name}
        payload.update(self.values)
        payload["temporary"] = self.temporary
        return payload


def section_name(number: int) -> str:
    return f"{SECTION_PREFIX}{number}"


def material_number(section: str) -> Optional[int]:
    if not section.startswith(SECTION_PREFIX):
        return None
    try:
        return int(section[len(SECTION_PREFIX):])
    except ValueError:
        return None


def make_material(
    number: int,
    name: str,
    values: Mapping[str, Any],
    units_per_mm: float = 1.0,
) -> Material:
    """Build a material, filling absent fields with QtPlasmaC's defaults.

    Rejects a saved number in the temporary range and a negative one: the first would put a
    program's throwaway material in the file, the second has no section name QtPlasmaC reads.
    """
    if number < 0:
        raise MaterialError("invalid_material_number", "material numbers cannot be negative")

    resolved: Dict[str, float] = {}
    for field in _VALUE_FIELDS:
        raw = values.get(field.name, None)
        if raw is None:
            resolved[field.name] = float(field.default(units_per_mm))
            continue
        try:
            resolved[field.name] = float(raw)
        except (TypeError, ValueError):
            raise MaterialError(
                "invalid_material_value", f"{field.name} is not a number: {raw!r}"
            ) from None
    return Material(number=number, name=str(name), values=resolved)


def read_materials(path: str, units_per_mm: float = 1.0) -> List[Material]:
    """Every material in the file, lowest number first, which is the order QtPlasmaC shows.

    A section whose number will not parse is skipped with a warning rather than failing the
    read: one bad section should not hide the rest of a shop's materials.
    """
    parser = read_config(path)
    materials: List[Material] = []
    for section in parser.sections():
        number = material_number(section)
        if number is None:
            if section.startswith(SECTION_PREFIX):
                logger.warning("plasma: %s: cannot read a material number from [%s]", path, section)
            continue
        values: Dict[str, Any] = {}
        for field in _VALUE_FIELDS:
            if parser.has_option(section, field.key):
                values[field.name] = parser.get(section, field.key)
        name = parser.get(section, "NAME") if parser.has_option(section, "NAME") else "Material"
        try:
            materials.append(make_material(number, name, values, units_per_mm))
        except MaterialError as exc:
            logger.warning("plasma: %s: skipping [%s]: %s", path, section, exc.message)
    return sorted(materials, key=lambda material: material.number)


def write_materials(path: str, materials: List[Material]) -> None:
    """Replace the file's material sections with ``materials``, keeping any other section.

    Temporary materials are dropped rather than rejected: they arrive from a program's magic
    comment, and QtPlasmaC's rule is that they never outlive the session.
    """
    parser = read_config(path)
    for section in list(parser.sections()):
        if material_number(section) is not None:
            parser.remove_section(section)

    for material in sorted(materials, key=lambda m: m.number):
        if material.temporary:
            logger.debug("plasma: not saving temporary material %d", material.number)
            continue
        section = section_name(material.number)
        parser.add_section(section)
        for field in MATERIAL_FIELDS:
            if field.key == "NAME":
                parser.set(section, field.key, material.name)
            else:
                parser.set(section, field.key, str(float(material.values[field.name])))
    write_config(path, parser)


def material_pin_values(material: Material) -> Dict[str, Any]:
    """``{plasmac pin: value}`` for selecting this material, as ``change_material()`` does."""
    return {
        field.pin: material.values[field.name]
        for field in _VALUE_FIELDS
        if field.pin is not None
    }


def read_temporary_material(path: str, number: int, units_per_mm: float = 1.0) -> Material:
    """Read the temporary material a program declared, from the file QtPlasmaC's filter wrote.

    The file is ``/tmp/qtplasmac/<machine>_material.gcode`` and is *not* INI: it is a flat
    ``KEY = value`` list per material (``material_temp_pin_changed()``), so it gets its own
    reader rather than going through configparser.
    """
    values: Dict[str, Any] = {}
    name = f"Temporary {number}"
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            key, _, raw = line.partition("=")
            key, raw = key.strip(), raw.strip()
            if not raw:
                continue
            if key == "NAME":
                name = raw
                continue
            for field in _VALUE_FIELDS:
                if field.key == key:
                    values[field.name] = raw
                    break
    return make_material(number, name, values, units_per_mm)
