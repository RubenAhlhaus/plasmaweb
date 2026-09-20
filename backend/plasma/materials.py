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


def default_material(units_per_mm: float = 1.0) -> Material:
    """Material 0 as QtPlasmaC creates it for a machine that has never had a material file.

    Values from ``updater.move_default_material()``, which is where upstream ends up when it
    finds no ``[MATERIAL_NUMBER_0]``: a 1 mm kerf, 3 mm pierce height, 4000 mm/min and 99 V.
    They are not good cut settings for any particular torch, but they are the settings
    QtPlasmaC would show, and they are not zeros — a material of zeros cannot cut at all.
    """
    return make_material(
        0,
        "Default",
        {
            "kerfWidth": round(1.0 * units_per_mm, 2),
            "pierceHeight": round(3.0 * units_per_mm, 2),
            "pierceDelay": 0.0,
            "puddleJumpHeight": 0.0,
            "puddleJumpDelay": 0.0,
            "cutHeight": round(1.0 * units_per_mm, 2),
            "cutSpeed": round(4000.0 * units_per_mm, 0),
            "cutAmps": 45.0,
            "cutVolts": 99.0,
            "pauseAtEnd": 0.0,
            "gasPressure": 0.0,
            "cutMode": 1.0,
            "thickness": 0.0,
        },
        units_per_mm,
    )


class _StarterCut(NamedTuple):
    """One row of the starting cut chart: everything that varies with plate thickness."""

    thickness: float
    kerf_width: float
    pierce_height: float
    pierce_delay: float
    cut_height: float
    cut_speed: float
    cut_volts: float
    #: What to dial the source to on its own front panel; see :data:`STARTER_CUT_AMPS`.
    cut_amps: float


#: Mild steel on an ANDELI CUT-65 (FPT60 torch, air), 1 mm to 10 mm in 0.5 mm steps.
#:
#: ANDELI publishes no cut chart — the datasheet gives only a maximum cut thickness — so the
#: speeds and pierce delays here are interpolated from the Thermal Dynamics Cutmaster 82
#: 60 A mechanized mild-steel chart (SL60 torch, exposed tip, air; manual 0-4979 section
#: 4T.08), which is the nearest published chart for a 60-65 A air plasma and is taken at 60 A
#: rather than 65 A so the numbers stay on the conservative side.
#:
#: Two columns are *not* from that chart and have to be dialled in on the machine:
#:
#: * ``cut_height`` / ``pierce_height`` — the Cutmaster chart's 4.8 mm standoff is measured to
#:   the shield face, not the tip, so it cannot be used as a QtPlasmaC cut height. These are
#:   the normal FPT60 tip-to-work heights instead, with pierce height at twice cut height.
#: * ``cut_volts`` — arc voltage depends on the source's own arc characteristic and on the cut
#:   height above, so no chart transfers. The ramp is anchored at a typical 60-65 A air arc at
#:   1.5 mm and follows the Cutmaster chart's slope (about 1.9 V per mm of plate). **Measure
#:   it**: cut a test piece with THC off, read the actual arc volts, save that back.
#:
#: Lengths and speeds are in millimetres and are scaled by ``units_per_mm`` when the machine is
#: imperial; volts, amps and delays are not.
_STARTER_CHART: Tuple[_StarterCut, ...] = (
    #          thick  kerf  pierceH  delay  cutH   speed   volts  amps
    _StarterCut(1.0 , 1.50, 3.0,     0.00,  1.5,   7350.0, 105.0, 30.0),
    _StarterCut(1.5 , 1.55, 3.0,     0.00,  1.5,   7350.0, 106.0, 30.0),
    _StarterCut(2.0 , 1.55, 3.0,     0.10,  1.5,   6900.0, 107.0, 35.0),
    _StarterCut(2.5 , 1.60, 3.0,     0.10,  1.5,   5500.0, 108.0, 40.0),
    _StarterCut(3.0 , 1.65, 3.0,     0.10,  1.5,   4550.0, 109.0, 40.0),
    _StarterCut(3.5 , 1.65, 3.0,     0.10,  1.5,   4150.0, 110.0, 45.0),
    _StarterCut(4.0 , 1.70, 3.0,     0.15,  1.5,   3350.0, 111.0, 45.0),
    _StarterCut(4.5 , 1.75, 3.0,     0.20,  1.5,   2800.0, 112.0, 50.0),
    _StarterCut(5.0 , 1.75, 3.0,     0.20,  1.5,   2450.0, 113.0, 50.0),
    _StarterCut(5.5 , 1.80, 3.6,     0.25,  1.8,   2300.0, 114.0, 55.0),
    _StarterCut(6.0 , 1.80, 3.6,     0.25,  1.8,   2150.0, 114.0, 55.0),
    _StarterCut(6.5 , 1.85, 3.6,     0.30,  1.8,   2000.0, 115.0, 60.0),
    _StarterCut(7.0 , 1.90, 3.6,     0.35,  1.8,   1850.0, 116.0, 60.0),
    _StarterCut(7.5 , 1.90, 3.6,     0.35,  1.8,   1700.0, 117.0, 65.0),
    _StarterCut(8.0 , 1.95, 3.6,     0.40,  1.8,   1550.0, 118.0, 65.0),
    _StarterCut(8.5 , 2.00, 4.0,     0.45,  2.0,   1450.0, 119.0, 65.0),
    _StarterCut(9.0 , 2.00, 4.0,     0.45,  2.0,   1350.0, 120.0, 65.0),
    _StarterCut(9.5 , 2.05, 4.0,     0.50,  2.0,   1250.0, 121.0, 65.0),
    _StarterCut(10.0, 2.10, 4.0,     0.55,  2.0,   1150.0, 122.0, 65.0),
)

#: The chart is a 60 A chart, so the speeds assume the source is near its rating. The per-row
#: ``cut_amps`` is what to set on the CUT-65's own panel — it rides down for thin sheet, where
#: full current burns more than it cuts. It reaches plasmac through nothing: ``CUT_AMPS`` is a
#: PowerMax RS485 field, and the CUT-65 has no RS485, so it is a note to the operator. Running
#: a thin-sheet row at less than its stated amps means cutting slower than its stated speed.
STARTER_CUT_AMPS = 65.0


def starter_material_name(thickness: float) -> str:
    """``3.5 mm mild steel`` — the thickness first, so the list reads thinnest to thickest."""
    return f"{thickness:g} mm mild steel"


def starter_materials(units_per_mm: float = 1.0) -> List[Material]:
    """The 1–10 mm mild steel chart as materials 1..19, thinnest first.

    Numbered from 1 in ascending thickness so that QtPlasmaC's own ordering — by material
    number — is also thickness order; material 0 stays QtPlasmaC's ``Default``.
    """
    materials: List[Material] = []
    for index, cut in enumerate(_STARTER_CHART, start=1):
        materials.append(
            make_material(
                index,
                starter_material_name(cut.thickness),
                {
                    "kerfWidth": round(cut.kerf_width * units_per_mm, 3),
                    "pierceHeight": round(cut.pierce_height * units_per_mm, 3),
                    "pierceDelay": cut.pierce_delay,
                    "puddleJumpHeight": 0.0,
                    "puddleJumpDelay": 0.0,
                    "cutHeight": round(cut.cut_height * units_per_mm, 3),
                    "cutSpeed": round(cut.cut_speed * units_per_mm, 1),
                    "cutAmps": cut.cut_amps,
                    "cutVolts": cut.cut_volts,
                    "pauseAtEnd": 0.0,
                    "gasPressure": 0.0,
                    "cutMode": 1.0,
                    "thickness": round(cut.thickness * units_per_mm, 3),
                },
                units_per_mm,
            )
        )
    return materials

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
