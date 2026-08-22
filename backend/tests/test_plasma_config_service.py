"""Materials and parameters against HAL: applying a selection, and the M190 handshake."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Tuple

import pytest

from backend.plasma.config_service import (
    ERROR_EVENT,
    MATERIAL_ACK_PIN,
    MATERIALS_EVENT,
    PlasmaConfigService,
)
from backend.plasma.hal_bridge import HalBridge, PinWriteRejected
from backend.plasma.machine_files import machine_files
from backend.plasma.materials import TEMPORARY_FROM, MaterialError
from backend.plasma.pins import QTPLASMAC_COMPONENT
from backend.tests.test_plasma_hal_bridge import FakeHalRuntime

INI = """\
[EMC]
MACHINE = my_plasma

[TRAJ]
LINEAR_UNITS = mm
MAX_LINEAR_VELOCITY = 250

[AXIS_X]
MAX_VELOCITY = 500.0

[AXIS_Y]
MAX_VELOCITY = 500.0

[AXIS_Z]
MAX_VELOCITY = 120.0
OFFSET_AV_RATIO = 0.5
"""

CFG = """\
[MATERIAL_NUMBER_0]
NAME = Default material
KERF_WIDTH = 1.0
PIERCE_HEIGHT = 3.0
PIERCE_DELAY = 0.2
PUDDLE_JUMP_HEIGHT = 0.0
PUDDLE_JUMP_DELAY = 0.0
CUT_HEIGHT = 1.0
CUT_SPEED = 2000.0
CUT_AMPS = 45.0
CUT_VOLTS = 100.0
PAUSE_AT_END = 0.0
GAS_PRESSURE = 0.0
CUT_MODE = 1.0
THICKNESS = 0.0

[MATERIAL_NUMBER_3]
NAME = 5mm mild steel
KERF_WIDTH = 1.5
PIERCE_HEIGHT = 3.6
PIERCE_DELAY = 0.1
PUDDLE_JUMP_HEIGHT = 0.0
PUDDLE_JUMP_DELAY = 0.0
CUT_HEIGHT = 1.4
CUT_SPEED = 4100.0
CUT_AMPS = 45.0
CUT_VOLTS = 122.0
PAUSE_AT_END = 0.0
GAS_PRESSURE = 0.0
CUT_MODE = 1.0
THICKNESS = 5.0

"""


@pytest.fixture(autouse=True)
def _no_inherited_ini(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("INI_FILE_NAME", "LINUXCNC_INI", "INI_FILE"):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture()
def service(tmp_path: Path):
    (tmp_path / "machine.ini").write_text(INI)
    (tmp_path / "my_plasma_material.cfg").write_text(CFG)
    files = machine_files(str(tmp_path / "machine.ini"))
    assert files is not None

    runtime = FakeHalRuntime()
    bridge = HalBridge(runtime)
    bridge.create_component()
    bridge.ready()
    config = PlasmaConfigService(
        bridge, files, temp_material_path=str(tmp_path / "my_plasma_material.gcode")
    )
    config.load()
    return config, bridge, runtime


def written(runtime: FakeHalRuntime) -> Dict[str, str]:
    return dict(runtime.set_p_calls)


def flush(bridge: HalBridge) -> None:
    bridge._apply_pending_writes()


def own_pins(runtime: FakeHalRuntime) -> Dict[str, Any]:
    return runtime.components[QTPLASMAC_COMPONENT].values


def test_loading_reads_both_files_and_picks_the_lowest_material(service) -> None:
    config, _bridge, _runtime = service

    materials = config.materials_payload()
    assert [m["number"] for m in materials["materials"]] == [0, 3]
    assert materials["selected"] == 0
    assert materials["default"] == 0
    assert config.parameters_payload()["values"]["Pid P Gain"] == 10.0


def test_the_stored_default_material_wins_when_it_exists(tmp_path: Path) -> None:
    (tmp_path / "machine.ini").write_text(INI)
    (tmp_path / "my_plasma_material.cfg").write_text(CFG)
    (tmp_path / "my_plasma.prefs").write_text("[GUI_OPTIONS]\nDefault material = 3\n\n")
    files = machine_files(str(tmp_path / "machine.ini"))
    assert files is not None
    bridge = HalBridge(FakeHalRuntime())
    bridge.create_component()
    bridge.ready()

    config = PlasmaConfigService(bridge, files)
    config.load()

    assert config.materials_payload()["selected"] == 3


def test_applying_parameters_puts_them_on_the_plasmac_setpoints(service) -> None:
    """Zeroed parameters are what stops a machine cutting, so this is the load-bearing one."""
    config, bridge, runtime = service

    config.apply_parameters()
    flush(bridge)
    values = written(runtime)

    assert values["plasmac.pid-p-gain"] == "10.0"
    assert values["plasmac.arc-max-starts"] == "3"
    assert values["plasmac.thc-delay"] == "0.5"
    assert values["plasmac.arc-fail-delay"] == "3.0"
    # A GUI-only parameter has no pin to write.
    assert not any("pierce-offset" in name for name in values)


def test_selecting_a_material_writes_its_setpoints_and_the_number_pin(service) -> None:
    config, bridge, runtime = service

    config.select_material(3)
    flush(bridge)

    values = written(runtime)
    assert values["plasmac.cut-feed-rate"] == "4100.0"
    assert values["plasmac.cut-volts"] == "122.0"
    assert values["plasmac.material-thickness"] == "5.0"
    assert own_pins(runtime)["material_change_number"] == 3
    assert config.materials_payload()["selected"] == 3


def test_selecting_a_material_that_does_not_exist_is_refused(service) -> None:
    config, _bridge, _runtime = service

    with pytest.raises(MaterialError) as excinfo:
        config.select_material(99)

    assert excinfo.value.code == "unknown_material"


def test_saving_a_material_writes_the_file_and_reapplies_the_selection(service) -> None:
    config, bridge, runtime = service
    config.select_material(3)

    config.save_material(3, "5mm mild steel", {"cutVolts": 118.0, "cutSpeed": 4000.0})
    flush(bridge)

    assert written(runtime)["plasmac.cut-volts"] == "118.0"
    reread = PlasmaConfigService(bridge, config._files)  # noqa: SLF001 — reading the file back
    reread.load()
    saved = [m for m in reread.materials_payload()["materials"] if m["number"] == 3][0]
    assert saved["cutVolts"] == 118.0
    assert saved["cutSpeed"] == 4000.0
    # Untouched fields keep the value the file had.
    assert saved["pierceHeight"] == 3.6


def test_a_temporary_number_cannot_be_saved_to_the_file(service) -> None:
    config, _bridge, _runtime = service

    with pytest.raises(MaterialError) as excinfo:
        config.save_material(TEMPORARY_FROM, "nope", {})

    assert excinfo.value.code == "temporary_material"


def test_deleting_a_material_removes_it_from_the_file(service) -> None:
    config, _bridge, _runtime = service

    config.delete_material(3)

    assert [m["number"] for m in config.materials_payload()["materials"]] == [0]


def test_saving_parameters_writes_the_file_and_pushes_them_to_hal(service) -> None:
    config, bridge, runtime = service

    values = config.save_parameters({"Pid P Gain": 15.0})
    flush(bridge)

    assert values["Pid P Gain"] == 15.0
    assert written(runtime)["plasmac.pid-p-gain"] == "15.0"
    assert "Pid P Gain = 15.0" in Path(config.parameters_payload()["path"]).read_text()


def test_setting_the_default_material_is_stored_in_the_prefs(service) -> None:
    config, _bridge, _runtime = service

    config.set_default_material(3)

    text = Path(config.parameters_payload()["path"]).read_text()
    assert "Default material = 3" in text
    assert config.materials_payload()["default"] == 3


# ---- the material change protocol ---------------------------------------------------


def diff(**own: Any) -> Dict[str, Dict[str, Any]]:
    return {QTPLASMAC_COMPONENT: dict(own)}


def acks(runtime: FakeHalRuntime) -> List[Tuple[str, str]]:
    return [call for call in runtime.set_p_calls if call[0] == MATERIAL_ACK_PIN]


def test_m190_changing_material_selects_it_and_answers_the_handshake(service) -> None:
    config, bridge, runtime = service
    # M190 raises material_change first, then writes the number it wants.
    runtime.components[QTPLASMAC_COMPONENT].values["material_change"] = 1
    bridge.poll_once()

    events = config.observe(diff(material_change_number=3))
    flush(bridge)

    assert [event for event, _ in events] == [MATERIALS_EVENT]
    assert written(runtime)["plasmac.cut-volts"] == "122.0"
    assert own_pins(runtime)["material_change"] == 2
    # Dropped and raised again, which is the edge M190's poll is waiting for.
    assert acks(runtime)[-2:] == [(MATERIAL_ACK_PIN, "0"), (MATERIAL_ACK_PIN, "1")]


def test_a_manual_selection_does_not_touch_the_handshake(service) -> None:
    config, bridge, runtime = service
    bridge.poll_once()

    config.observe(diff(material_change_number=3))
    flush(bridge)

    assert acks(runtime) == []
    assert own_pins(runtime)["material_change"] == 0


def test_m190_asking_for_the_material_already_selected_is_acknowledged(service) -> None:
    config, bridge, runtime = service

    config.observe(diff(material_change=3))
    flush(bridge)

    assert acks(runtime) == [(MATERIAL_ACK_PIN, "1")]
    assert own_pins(runtime)["material_change"] == 0


def test_m190_finishing_drops_the_acknowledgement(service) -> None:
    config, bridge, runtime = service

    config.observe(diff(material_change=0))
    flush(bridge)

    assert acks(runtime) == [(MATERIAL_ACK_PIN, "0")]


def test_an_unknown_material_number_is_reported_and_changes_nothing(service) -> None:
    config, bridge, runtime = service

    events = config.observe(diff(material_change_number=42))
    flush(bridge)

    assert events[0][0] == ERROR_EVENT
    assert events[0][1]["code"] == "unknown_material"
    assert config.materials_payload()["selected"] == 0
    assert acks(runtime) == []


def test_minus_one_means_the_default_material(service) -> None:
    config, bridge, runtime = service
    config.set_default_material(3)
    config.select_material(0)

    config.observe(diff(material_change_number=-1))
    flush(bridge)

    assert config.materials_payload()["selected"] == 3


def test_a_timeout_is_reported_and_the_pins_are_put_back(service) -> None:
    config, bridge, runtime = service
    config.select_material(3)
    flush(bridge)

    events = config.observe(diff(material_change_timeout=True))
    flush(bridge)

    assert events[0][1]["code"] == "material_change_timeout"
    assert own_pins(runtime)["material_change_number"] == 3
    assert own_pins(runtime)["material_change_timeout"] is False
    assert acks(runtime)[-1] == (MATERIAL_ACK_PIN, "0")


def test_a_program_declared_material_is_added_and_the_pin_cleared(service, tmp_path) -> None:
    config, bridge, runtime = service
    (tmp_path / "my_plasma_material.gcode").write_text(
        "NAME = from the program\nCUT_VOLTS = 111\nCUT_SPEED = 3300\n"
    )

    events = config.observe(diff(material_temp=TEMPORARY_FROM + 5))
    flush(bridge)

    numbers = [m["number"] for m in config.materials_payload()["materials"]]
    assert TEMPORARY_FROM + 5 in numbers
    assert [event for event, _ in events] == [MATERIALS_EVENT]
    assert own_pins(runtime)["material_temp"] == 0


def test_a_missing_temporary_material_file_is_reported_not_raised(service) -> None:
    config, bridge, runtime = service

    events = config.observe(diff(material_temp=TEMPORARY_FROM + 6))
    flush(bridge)

    assert events[0][1]["code"] == "temporary_material_failed"
    assert own_pins(runtime)["material_temp"] == 0


def test_a_reload_pin_pulse_rereads_both_files(service) -> None:
    config, bridge, runtime = service
    Path(config.parameters_payload()["path"]).write_text(
        "[PLASMA_PARAMETERS]\nPid P Gain = 33.0\n\n"
    )

    events = config.observe(diff(material_reload=True))
    flush(bridge)

    assert config.parameters_payload()["values"]["Pid P Gain"] == 33.0
    assert written(runtime)["plasmac.pid-p-gain"] == "33.0"
    assert {event for event, _ in events} == {MATERIALS_EVENT, "plasma.parameters.changed"}


def test_only_the_handshake_pin_may_be_written_outside_the_plasma_components(service) -> None:
    _config, bridge, _runtime = service

    with pytest.raises(PinWriteRejected) as excinfo:
        bridge.request_external_write("motion.digital-out-01", True)

    assert excinfo.value.code == "pin_not_writable"


def test_a_machine_with_no_material_file_gets_qtplasmacs_default(tmp_path: Path) -> None:
    """Without a material there is nothing to select, so the cut parameters stay at zero."""
    (tmp_path / "machine.ini").write_text(INI)
    files = machine_files(str(tmp_path / "machine.ini"))
    assert files is not None
    runtime = FakeHalRuntime()
    bridge = HalBridge(runtime)
    bridge.create_component()
    bridge.ready()

    config = PlasmaConfigService(bridge, files)
    config.load()
    config.apply_selected_material()
    flush(bridge)

    assert [m["number"] for m in config.materials_payload()["materials"]] == [0]
    assert written(runtime)["plasmac.cut-feed-rate"] == "4000.0"
    assert Path(files.materials_path).exists()


def test_the_remembered_toggles_are_restored_to_hal(service) -> None:
    """A cut with THC enable off never moves the torch, however good the parameters are."""
    config, bridge, runtime = service

    config.apply_enables()
    flush(bridge)

    assert written(runtime)["plasmac.thc-enable"] == "1"
    assert written(runtime)["plasmac.cornerlock-enable"] == "1"
    assert written(runtime)["plasmac.voidlock-enable"] == "0"


def test_flipping_a_toggle_is_remembered_for_next_start(service) -> None:
    config, bridge, runtime = service

    config.save_enable("thc-enable", False)
    reloaded = PlasmaConfigService(bridge, config._files)  # noqa: SLF001 — reads the file back
    reloaded.load()
    reloaded.apply_enables()
    flush(bridge)

    assert written(runtime)["plasmac.thc-enable"] == "0"


def test_conversational_settings_are_read_and_saved(service) -> None:
    config, _bridge, _runtime = service

    before = config.conversational_settings()
    after = config.save_conversational_settings({"Leadin": 6.0, "Hole speed": 55})

    assert before["Leadin"] == 0.0
    assert after["Leadin"] == 6.0
    assert after["Hole speed"] == 55
    # And they are what the next generated shape will use.
    assert config.conversational_defaults()["leadinLength"] == 6.0
    assert config.conversational_defaults()["smallHoleSpeed"] == 55


def test_offset_probing_is_applied_to_its_pins(service) -> None:
    """A probe that is not under the torch has to be told where it is."""
    config, bridge, runtime = service
    config.save_offset_probing({"X axis": 25.0, "Y axis": -10.0, "Delay": 0.4})
    flush(bridge)

    values = written(runtime)
    assert values["plasmac.offset-probe-x"] == "25.0"
    assert values["plasmac.offset-probe-y"] == "-10.0"
    assert values["plasmac.offset-probe-delay"] == "0.4"
    assert config.parameters_payload()["offsetProbing"]["X axis"] == 25.0


def test_the_powermax_setpoints_come_from_the_selected_material(service) -> None:
    """A job that changes material changes what the power supply is told."""
    config, _bridge, _runtime = service

    setpoints = config.powermax_setpoints()

    assert setpoints["cutAmps"] > 0
    assert setpoints["cutMode"] > 0
