from types import SimpleNamespace
from pathlib import Path
import subprocess

import pytest

from backend.adapters import linuxcnc_gateway as gateway_module
from backend.adapters.linuxcnc_gateway import LinuxCncGateway

try:
    import linuxcnc  # noqa: F401

    _HAS_LINUXCNC_PY = True
except ImportError:
    _HAS_LINUXCNC_PY = False


def test_read_traj_coordinates_line_scan(tmp_path) -> None:
    from backend.adapters.linuxcnc_gateway import _read_traj_coordinates_line_scan

    ini = tmp_path / "coords.ini"
    ini.write_text(
        "[DISPLAY]\n"
        "FOO = bar\n"
        "[TRAJ]\n"
        "LINEAR_UNITS = mm\n"
        "COORDINATES = X Y Z\n",
        encoding="utf-8",
    )
    assert _read_traj_coordinates_line_scan(str(ini)) == "X Y Z"


def test_display_lathe_truthy() -> None:
    from backend.adapters.linuxcnc_gateway import _display_lathe_truthy

    assert _display_lathe_truthy(True) is True
    assert _display_lathe_truthy(False) is False
    assert _display_lathe_truthy(1) is True
    assert _display_lathe_truthy(0) is False
    assert _display_lathe_truthy("TRUE") is True
    assert _display_lathe_truthy("0") is False
    assert _display_lathe_truthy("2") is True


def test_get_display_coordinates_subtracts_work_and_tool_offsets(
    monkeypatch,
) -> None:
    gateway = LinuxCncGateway()

    # Simulate a polled LinuxCNC status object with 9-axis actual_position.
    gateway._stat = SimpleNamespace(
        actual_position=[10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0],
        tool_offset=[1.0, 2.0, 4.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        poll=lambda: None,
    )

    # Make the linuxcnc availability guard pass and return deterministic offsets.
    monkeypatch.setattr(gateway_module, "linuxcnc", object())
    monkeypatch.setattr(
        gateway_module,
        "get_active_coordinate_system_offsets",
        lambda _s: {
            "x": 1.5,
            "y": -2.0,
            "z": 3.0,
            "a": 0.5,
            "b": 0.0,
            "c": -1.0,
            "u": 10.0,
            "v": -10.0,
            "w": 0.25,
        },
    )

    coords = gateway.get_display_coordinates()

    assert coords == {
        "x": 7.5,
        "y": 20.0,
        "z": 23.0,
        "a": 39.5,
        "b": 50.0,
        "c": 61.0,
        "u": 60.0,
        "v": 90.0,
        "w": 89.75,
    }


def test_get_ini_runtime_config_reads_display_increments_and_units(tmp_path, monkeypatch) -> None:
    ini = tmp_path / "machine.ini"
    ini.write_text(
        "[DISPLAY]\n"
        "INCREMENTS = 5 mm, 1 mm, 0.1 mm\n"
        "LATHE = 1\n"
        "[TRAJ]\n"
        "LINEAR_UNITS = mm\n"
        "ANGULAR_UNITS = degree\n"
        "COORDINATES = X Z\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("INI_FILE_NAME", str(ini))
    gateway = LinuxCncGateway()
    gateway._stat = None

    result = gateway.get_ini_runtime_config(force_reload=True)

    assert result["jog_increments_spec"] == "5 mm, 1 mm, 0.1 mm"
    assert result["linear_units"] == "mm"
    assert result["angular_units"] == "degree"
    assert result["program_units"] == 2
    assert result["traj_coordinates"] == "X Z"
    assert result["display_lathe"] is True
    assert result["source"] == "ini"
    assert Path(result["ini_path"]).name == "machine.ini"


def test_get_ini_runtime_config_uses_defaults_when_no_ini(monkeypatch) -> None:
    monkeypatch.delenv("INI_FILE_NAME", raising=False)
    monkeypatch.delenv("LINUXCNC_INI", raising=False)
    monkeypatch.delenv("INI_FILE", raising=False)
    gateway = LinuxCncGateway()
    gateway._stat = None

    result = gateway.get_ini_runtime_config(force_reload=True)

    assert result["jog_increments_spec"] == "1 mm, 0.5 mm, 0.1 in, 1/16 in"
    assert result["source"] == "default"
    assert result["traj_coordinates"] is None
    assert result["display_lathe"] is False
    assert result["user_macros"] == []


@pytest.mark.skipif(not _HAS_LINUXCNC_PY, reason="linuxcnc Python module not installed")
def test_get_ini_runtime_config_duplicate_ini_keys_still_reads_increments(
    tmp_path, monkeypatch
) -> None:
    """LinuxCNC allows repeated option names; configparser raises — linuxcnc.ini must be used."""
    ini = tmp_path / "dup.ini"
    ini.write_text(
        "[DISPLAY]\n"
        "INCREMENTS = 9 mm, 8 mm\n"
        "[FILTER]\n"
        "PROGRAM_EXTENSION = .foo bar\n"
        "PROGRAM_EXTENSION = .baz qux\n"
        "[TRAJ]\n"
        "LINEAR_UNITS = mm\n"
        "ANGULAR_UNITS = degree\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("INI_FILE_NAME", str(ini))
    gateway = LinuxCncGateway()
    gateway._stat = None

    result = gateway.get_ini_runtime_config(force_reload=True)

    assert result["jog_increments_spec"] == "9 mm, 8 mm"
    assert result["linear_units"] == "mm"
    assert result["angular_units"] == "degree"
    assert result["source"] == "ini"


def test_serialize_tool_table_calls_toolinfo_for_pocket() -> None:
    from backend.adapters.linuxcnc_gateway import _serialize_tool_table

    def toolinfo(n: int) -> dict:
        return {"toolno": n, "pocketno": 42} if n == 3 else {}

    stat = SimpleNamespace(
        tool_table=[{"toolno": 3, "diameter": 1.0, "comment": ""}],
        toolinfo=toolinfo,
    )
    out = _serialize_tool_table(stat)
    assert len(out) == 1
    assert out[0]["pocket"] == 42


def test_serialize_tool_table_entry_and_list() -> None:
    from backend.adapters.linuxcnc_gateway import (
        _serialize_tool_table,
        _serialize_tool_table_entry,
    )

    row = {"toolno": 2, "pocket": 2, "diameter": 10.0, "comment": "note"}
    assert _serialize_tool_table_entry(row)["toolno"] == 2
    assert _serialize_tool_table_entry(row)["comment"] == "note"

    stat = SimpleNamespace(
        tool_table=[row],
    )
    assert _serialize_tool_table(stat) == [row]


def test_enrich_tool_table_pockets_from_toolinfo() -> None:
    """Pocket often only available via stat.toolinfo(toolno)['pocketno'], not on tool_table rows."""
    from backend.adapters.linuxcnc_gateway import (
        _enrich_tool_table_pockets_from_toolinfo,
    )

    rows = [{"toolno": 1, "zoffset": -1.0, "comment": ""}]
    stat = SimpleNamespace(
        toolinfo=lambda n: {"toolno": n, "pocketno": 101, "zoffset": -1.0}
        if n == 1
        else {}
    )
    _enrich_tool_table_pockets_from_toolinfo(stat, rows)
    assert rows[0]["pocket"] == 101

    rows2 = [{"toolno": 2, "pocket": 5}]
    _enrich_tool_table_pockets_from_toolinfo(stat, rows2)
    assert rows2[0]["pocket"] == 5


def test_serialize_tool_table_tuple_row_pocket_from_disk_map() -> None:
    """14-tuple rows have no pocket; supply T→P from parsed tool table file."""
    from backend.adapters.linuxcnc_gateway import _serialize_tool_table

    seq = (4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 8.0, 0.0, 0.0, 0)
    stat = SimpleNamespace(tool_table=[seq])
    out = _serialize_tool_table(stat, pocket_by_tool={4: 99})
    assert len(out) == 1
    assert out[0]["id"] == 4
    assert out[0]["pocket"] == 99


def test_parse_tool_table_pocket_by_toolno_t1_p101(tmp_path) -> None:
    from backend.adapters.linuxcnc_gateway import _parse_tool_table_pocket_by_toolno

    f = tmp_path / "tools.tbl"
    f.write_text("; comment\nT1 P101 Z0 D0\nT2 P2 Z0\n", encoding="utf-8")
    assert _parse_tool_table_pocket_by_toolno(str(f)) == {1: 101, 2: 2}


def test_parse_tool_table_maps_includes_semicolon_comment(tmp_path) -> None:
    from backend.adapters.linuxcnc_gateway import _parse_tool_table_maps

    f = tmp_path / "tools.tbl"
    f.write_text(
        'T1 P1 Z0 D6 ; Allround |LCNCGUI|{"name":"X","type":"Flat End Mill"}\n',
        encoding="utf-8",
    )
    pockets, comments = _parse_tool_table_maps(str(f))
    assert pockets == {1: 1}
    assert "|LCNCGUI|" in comments[1]
    assert "Flat End Mill" in comments[1]


def test_serialize_tool_table_comment_from_disk_map() -> None:
    from backend.adapters.linuxcnc_gateway import _serialize_tool_table

    raw = "Human |LCNCGUI|{\"name\":\"N\",\"type\":\"Drill\",\"material\":\"HSS\"}"
    stat = SimpleNamespace(tool_table=[{"toolno": 3, "zoffset": 0.0}])
    out = _serialize_tool_table(stat, comment_by_tool={3: raw})
    assert out[0]["comment"] == raw


def test_serialize_tool_table_merges_sidecar() -> None:
    from backend.adapters.linuxcnc_gateway import _serialize_tool_table

    stat = SimpleNamespace(tool_table=[{"toolno": 5, "diameter": 6.0, "comment": "short"}])
    side = {
        "version": 1,
        "tools": {
            "5": {
                "meta": {"name": "Sidecar Name", "type": "Drill"},
                "presets": [{"id": "p1", "name": "Steel", "spindle_rpm": 800}],
            }
        },
    }
    out = _serialize_tool_table(stat, sidecar_doc=side)
    assert out[0]["comment"] == "short"
    assert out[0]["lcncgui_meta"]["name"] == "Sidecar Name"
    assert out[0]["lcncgui_presets"][0]["name"] == "Steel"


def test_serialize_tool_table_comment_disk_overrides_stat_truncated_before_pipe() -> None:
    """
    stat.tool_table often carries only the human prefix before `|`; the file has the full
    `|LCNCGUI|` JSON suffix (lcncgui metadata).
    """
    from backend.adapters.linuxcnc_gateway import _serialize_tool_table

    disk = 'Allroundd |LCNCGUI|{"name":"VHM 6mm","type":"Flat End Mill","material":"VHM"}'
    stat = SimpleNamespace(
        tool_table=[{"toolno": 1, "pocket": 187, "diameter": 6.0, "comment": "Allroundd"}]
    )
    out = _serialize_tool_table(stat, comment_by_tool={1: disk})
    assert out[0]["comment"] == disk
    assert "Flat End Mill" in out[0]["comment"]


def test_serialize_tool_table_comment_disk_json_only_when_stat_empty() -> None:
    """`; |LCNCGUI|{...}` on disk — stat comment empty; full JSON must reach the client."""
    from backend.adapters.linuxcnc_gateway import _serialize_tool_table

    disk = '|LCNCGUI|{"name":"VHM 10mm","type":"Flat End Mill","material":"VHM"}'
    stat = SimpleNamespace(
        tool_table=[{"toolno": 2, "pocket": 2, "diameter": 10.0, "comment": ""}]
    )
    out = _serialize_tool_table(stat, comment_by_tool={2: disk})
    assert out[0]["comment"] == disk


def test_serialize_tool_table_comment_disk_overrides_stat_truncated_json_with_delim() -> None:
    """
    stat may include `|LCNCGUI|` but truncate the JSON (fixed buffer). Disk has the full line.
    """
    from backend.adapters.linuxcnc_gateway import _serialize_tool_table

    disk = '|LCNCGUI|{"name":"VHM 10mm","type":"Flat End Mill","material":"VHM"}'
    stat = SimpleNamespace(
        tool_table=[
            {
                "toolno": 2,
                "pocket": 2,
                "comment": '|LCNCGUI|{"name":"VHM 10mm","type":"Flat',
            }
        ]
    )
    out = _serialize_tool_table(stat, comment_by_tool={2: disk})
    assert out[0]["comment"] == disk
    assert "material" in out[0]["comment"]


def test_parse_tool_table_maps_comment_starts_with_lcncgui_delim(tmp_path) -> None:
    from backend.adapters.linuxcnc_gateway import _parse_tool_table_maps

    f = tmp_path / "tools.tbl"
    f.write_text(
        'T2 P2 Z+30 D+10 ; |LCNCGUI|{"name":"VHM 10mm","type":"Flat End Mill"}\n',
        encoding="utf-8",
    )
    _pockets, comments = _parse_tool_table_maps(str(f))
    assert comments[2].startswith("|LCNCGUI|")
    assert "VHM 10mm" in comments[2]


def test_serialize_tool_table_toolinfo_overrides_disk_map() -> None:
    """stat.toolinfo fills pocket first; disk map only fills remaining gaps."""
    from backend.adapters.linuxcnc_gateway import _serialize_tool_table

    stat = SimpleNamespace(
        tool_table=[{"toolno": 1, "comment": ""}],
        toolinfo=lambda n: {"pocketno": 50} if n == 1 else {},
    )
    out = _serialize_tool_table(stat, pocket_by_tool={1: 101})
    assert out[0]["pocket"] == 50


def test_enrich_tool_table_pockets_from_toolinfo_tuple_like_gmoccapy_tooledit() -> None:
    """gmoccapy tooledit get_toolinfo: [0] toggle, [1] tool#, [2] pocket — same as many stat.toolinfo() tuples."""
    from backend.adapters.linuxcnc_gateway import (
        _enrich_tool_table_pockets_from_toolinfo,
    )

    rows = [{"toolno": 3, "zoffset": 0.0, "comment": ""}]
    stat = SimpleNamespace(
        toolinfo=lambda n: (0, 3, 77, 0.0, 0.0, 0.0) if n == 3 else ()
    )
    _enrich_tool_table_pockets_from_toolinfo(stat, rows)
    assert rows[0]["pocket"] == 77


def test_serialize_tool_table_entry_pocketno_sets_pocket() -> None:
    """LinuxCNC often exposes pocket as `pocketno` on tool_table rows."""
    from backend.adapters.linuxcnc_gateway import _serialize_tool_table_entry

    only_pocketno = {"toolno": 3, "pocketno": 7, "diameter": 8.0, "comment": ""}
    out = _serialize_tool_table_entry(only_pocketno)
    assert out["pocketno"] == 7
    assert out["pocket"] == 7

    ns = SimpleNamespace(
        toolno=4,
        pocketno=9,
        diameter=1.0,
        comment="x",
        id=0,
    )
    out2 = _serialize_tool_table_entry(ns)
    assert out2["pocket"] == 9


def test_get_status_snapshot_includes_tool_table(monkeypatch) -> None:
    gateway = LinuxCncGateway()
    fake_lc = SimpleNamespace(
        MODE_MANUAL=1,
        STATE_OFF=3,
        STATE_ON=4,
        STATE_ESTOP=1,
        STATE_ESTOP_RESET=2,
    )
    monkeypatch.setattr(gateway_module, "linuxcnc", fake_lc)

    tool_row = {"toolno": 1, "diameter": 6.0, "comment": "c"}
    gateway._stat = SimpleNamespace(
        poll=lambda: None,
        task_mode=1,
        task_state=4,
        estop=fake_lc.STATE_ESTOP_RESET,
        feedrate=1.0,
        axis_mask=7,
        actual_position=(0.0, 0.0, 0.0),
        homed=(1, 1, 1),
        g5x_index=1,
        g5x_offset=(0.0,) * 9,
        g92_offset=(0.0,) * 9,
        din=(),
        dout=(),
        flood=0,
        mist=0,
        file=None,
        gcodes=(),
        mcodes=(),
        settings=(),
        joint=(),
        axis=(),
        tool_in_spindle=1,
        tool_table=[tool_row],
        pocket_prepped=0,
        tool_from_pocket=0,
        spindle=(),
    )

    snap = gateway.get_status_snapshot()
    assert snap["machine"]["axis_mask"] == 7
    assert snap["machine"]["traj_coordinates_hint"] is None
    assert snap["tools"]["tool_in_spindle"] == 1
    assert snap["tools"]["tool_table"] == [tool_row]
    assert snap["tools"]["pocket_prepped"] == 0
    assert snap["tools"]["tool_from_pocket"] == 0


def test_get_status_snapshot_keeps_homed_flag_per_joint(monkeypatch) -> None:
    """stat.homed is indexed by joint: on trivkins coordinates=xyyz Z is joint 3,
    so the snapshot must not truncate the list to three axis-shaped entries."""
    gateway = LinuxCncGateway()
    fake_lc = SimpleNamespace(
        MODE_MANUAL=1,
        STATE_OFF=3,
        STATE_ON=4,
        STATE_ESTOP=1,
        STATE_ESTOP_RESET=2,
    )
    monkeypatch.setattr(gateway_module, "linuxcnc", fake_lc)

    gateway._stat = SimpleNamespace(
        poll=lambda: None,
        task_mode=1,
        task_state=4,
        estop=fake_lc.STATE_ESTOP_RESET,
        feedrate=1.0,
        axis_mask=7,
        actual_position=(0.0, 0.0, 95.0),
        # XYYZ gantry, only the Z joint (index 3) is homed
        homed=(0, 0, 0, 1, 0, 0, 0, 0, 0),
        g5x_index=1,
        g5x_offset=(0.0,) * 9,
        g92_offset=(0.0,) * 9,
        din=(),
        dout=(),
        flood=0,
        mist=0,
        file=None,
        gcodes=(),
        mcodes=(),
        settings=(),
        joint=(),
        axis=(),
        tool_in_spindle=0,
        tool_table=[],
        pocket_prepped=0,
        tool_from_pocket=0,
        spindle=(),
    )

    snap = gateway.get_status_snapshot()
    assert snap["motion"]["homed"] == [0, 0, 0, 1, 0, 0, 0, 0, 0]


def test_get_status_snapshot_hydrates_coordinate_offsets_from_var(
    tmp_path, monkeypatch
) -> None:
    from backend.coordinate_systems import reset_stored_offsets_state_for_tests

    reset_stored_offsets_state_for_tests()
    var = tmp_path / "sim.var"
    var.write_text("5241\t7.0\n5242\t8.0\n5243\t9.0\n", encoding="utf-8")
    ini = tmp_path / "machine.ini"
    ini.write_text("[RS274NGC]\nPARAMETER_FILE = sim.var\n", encoding="utf-8")

    gateway = LinuxCncGateway()
    fake_lc = SimpleNamespace(
        MODE_MANUAL=1,
        STATE_OFF=3,
        STATE_ON=4,
        STATE_ESTOP=1,
        STATE_ESTOP_RESET=2,
    )
    monkeypatch.setattr(gateway_module, "linuxcnc", fake_lc)
    monkeypatch.setattr(gateway, "_resolve_ini_path", lambda: str(ini))
    monkeypatch.setattr(gateway, "_load_tool_table_maps_from_disk", lambda: ({}, {}))
    monkeypatch.setattr(gateway, "get_hal_softkey_feedback", lambda: {})

    gateway._stat = SimpleNamespace(
        poll=lambda: None,
        task_mode=1,
        task_state=4,
        estop=fake_lc.STATE_ESTOP_RESET,
        feedrate=1.0,
        axis_mask=7,
        actual_position=(0.0, 0.0, 0.0),
        homed=(1, 1, 1),
        g5x_index=1,
        g5x_offset=(0.0,) * 9,
        g92_offset=(0.0,) * 9,
        tool_offset=(0.0,) * 9,
        din=(),
        dout=(),
        flood=0,
        mist=0,
        file=None,
        gcodes=(),
        mcodes=(),
        settings=(),
        joint=(),
        axis=(),
        tool_in_spindle=0,
        tool_table=[],
        pocket_prepped=0,
        tool_from_pocket=0,
        spindle=(),
    )

    snap = gateway.get_status_snapshot()
    systems = snap.get("coordinate_systems") or []
    g55 = next(row for row in systems if row["id"] == "G55")
    assert g55["offsets"]["x"] == 7.0
    assert g55["offsets"]["y"] == 8.0
    assert g55["offsets"]["z"] == 9.0


def test_get_status_snapshot_includes_hal_softkeys(monkeypatch) -> None:
    gateway = LinuxCncGateway()
    fake_lc = SimpleNamespace(
        MODE_MANUAL=1,
        STATE_OFF=3,
        STATE_ON=4,
        STATE_ESTOP=1,
        STATE_ESTOP_RESET=2,
    )
    monkeypatch.setattr(gateway_module, "linuxcnc", fake_lc)
    monkeypatch.setattr(
        gateway,
        "get_hal_softkey_feedback",
        lambda: {"14": 1, "15": 0},
    )

    gateway._stat = SimpleNamespace(
        poll=lambda: None,
        task_mode=1,
        task_state=4,
        estop=fake_lc.STATE_ESTOP_RESET,
        feedrate=1.0,
        axis_mask=7,
        actual_position=(0.0, 0.0, 0.0),
        homed=(1, 1, 1),
        g5x_index=1,
        g5x_offset=(0.0,) * 9,
        g92_offset=(0.0,) * 9,
        tool_offset=(0.0,) * 9,
        din=(),
        dout=(),
        flood=0,
        mist=0,
        file=None,
        gcodes=(),
        mcodes=(),
        settings=(),
        joint=(),
        axis=(),
        tool_in_spindle=0,
        tool_table=[],
        pocket_prepped=0,
        tool_from_pocket=0,
        spindle=(),
    )

    snap = gateway.get_status_snapshot()
    assert snap["io"]["hal_softkeys"] == {"14": 1, "15": 0}


def test_get_status_snapshot_traj_coordinates_hint_when_axis_mask_missing(
    tmp_path, monkeypatch
) -> None:
    gateway = LinuxCncGateway()
    fake_lc = SimpleNamespace(
        MODE_MANUAL=1,
        STATE_OFF=3,
        STATE_ON=4,
        STATE_ESTOP=1,
        STATE_ESTOP_RESET=2,
    )
    monkeypatch.setattr(gateway_module, "linuxcnc", fake_lc)

    ini = tmp_path / "mill.ini"
    ini.write_text("[TRAJ]\nCOORDINATES = X Y Z\n", encoding="utf-8")
    monkeypatch.setattr(gateway, "_resolve_ini_path", lambda: str(ini))

    tool_row = {"toolno": 1, "diameter": 6.0, "comment": "c"}
    gateway._stat = SimpleNamespace(
        poll=lambda: None,
        task_mode=1,
        task_state=4,
        estop=fake_lc.STATE_ESTOP_RESET,
        feedrate=1.0,
        actual_position=(0.0, 0.0, 0.0),
        homed=(1, 1, 1),
        g5x_index=1,
        g5x_offset=(0.0,) * 9,
        g92_offset=(0.0,) * 9,
        din=(),
        dout=(),
        flood=0,
        mist=0,
        file=None,
        gcodes=(),
        mcodes=(),
        settings=(),
        joint=(),
        axis=(),
        tool_in_spindle=0,
        tool_table=[tool_row],
        pocket_prepped=0,
        tool_from_pocket=0,
        spindle=(),
    )

    snap = gateway.get_status_snapshot()
    assert snap["machine"]["axis_mask"] is None
    assert snap["machine"]["traj_coordinates_hint"] == "X Y Z"


def test_rewrite_tool_table_line_content_merges_partial_params() -> None:
    from backend.adapters.linuxcnc_gateway import _rewrite_tool_table_line_content

    body = "T1 P1 Z+0.000000 D+6.000000 ; original"
    out = _rewrite_tool_table_line_content(body, 1, {"toolno": 1, "zoffset": 2.0})
    assert "Z+2.000000" in out
    assert "D+6.000000" in out
    assert out.endswith("; original")


def test_rewrite_tool_table_line_content_comment_override() -> None:
    from backend.adapters.linuxcnc_gateway import _rewrite_tool_table_line_content

    body = "T1 P1 Z+0.000000 D+6.000000 ; old"
    out = _rewrite_tool_table_line_content(
        body,
        1,
        {"toolno": 1, "comment": "new tail |LCNCGUI|{}"},
    )
    assert "D+6.000000" in out
    assert "new tail |LCNCGUI|{}" in out
    assert "old" not in out


def test_rewrite_tool_table_line_content_appends_new_axis_token() -> None:
    from backend.adapters.linuxcnc_gateway import _rewrite_tool_table_line_content

    body = "T2 P2 Z+0.000000 D+5.000000 ; c"
    out = _rewrite_tool_table_line_content(body, 2, {"toolno": 2, "xoffset": 1.25})
    assert "Z+0.000000" in out
    assert "D+5.000000" in out
    assert "X+1.250000" in out


def test_rewrite_tool_table_line_content_pocket_override() -> None:
    from backend.adapters.linuxcnc_gateway import _rewrite_tool_table_line_content

    body = "T1 P3 Z+0 ; x"
    out = _rewrite_tool_table_line_content(body, 1, {"toolno": 1, "pocket": 99})
    assert out.startswith("T1 P99")


def test_rewrite_tool_table_line_content_wrong_tool_returns_none() -> None:
    from backend.adapters.linuxcnc_gateway import _rewrite_tool_table_line_content

    assert _rewrite_tool_table_line_content("T1 P1 Z0 ; c", 2, {"toolno": 2}) is None


def test_apply_tool_table_row_update_to_disk_updates_last_duplicate_t(tmp_path) -> None:
    from backend.adapters.linuxcnc_gateway import _apply_tool_table_row_update_to_disk

    f = tmp_path / "tools.tbl"
    f.write_text(
        "T1 P1 Z+0.000000 D+3.000000 ; first\n"
        "T1 P101 Z+1.000000 D+4.000000 ; second\n",
        encoding="utf-8",
    )
    assert _apply_tool_table_row_update_to_disk(str(f), 1, {"toolno": 1, "comment": "done"}) is None
    text = f.read_text(encoding="utf-8")
    assert "first" in text
    assert "T1 P1 Z+0.000000 D+3.000000 ; first" in text
    assert "T1 P101 Z+1.000000 D+4.000000 ; done" in text


def test_apply_tool_table_row_update_to_disk_tool_missing() -> None:
    from backend.adapters.linuxcnc_gateway import _apply_tool_table_row_update_to_disk

    f = Path(__file__).resolve().parents[2] / "examples" / "sample_tool_table.tbl"
    err = _apply_tool_table_row_update_to_disk(str(f), 9999, {"toolno": 9999})
    assert err is not None
    assert err[0] == "tool_line_not_found"


def test_apply_tool_table_row_update_to_disk_renumbers_t(tmp_path) -> None:
    from backend.adapters.linuxcnc_gateway import _apply_tool_table_row_update_to_disk

    f = tmp_path / "tools.tbl"
    f.write_text("T1 P1 Z+0.000000 D+3.000000 ; x\nT2 P2 Z+0\n", encoding="utf-8")
    assert (
        _apply_tool_table_row_update_to_disk(
            str(f), 1, {"toolno": 1, "comment": "y"}, new_toolno=9
        )
        is None
    )
    text = f.read_text(encoding="utf-8")
    assert "T9 P1" in text
    assert "T1 P1" not in text
    assert "T2 P2" in text


def test_apply_tool_table_row_update_to_disk_rename_conflict(tmp_path) -> None:
    from backend.adapters.linuxcnc_gateway import _apply_tool_table_row_update_to_disk

    f = tmp_path / "tools.tbl"
    f.write_text("T1 P1 Z0\nT2 P2 Z0\n", encoding="utf-8")
    err = _apply_tool_table_row_update_to_disk(str(f), 1, {"toolno": 1}, new_toolno=2)
    assert err is not None
    assert err[0] == "tool_already_exists"


def test_rewrite_tool_table_line_content_output_toolno() -> None:
    from backend.adapters.linuxcnc_gateway import _rewrite_tool_table_line_content

    body = "T1 P3 Z+0 ; c"
    out = _rewrite_tool_table_line_content(body, 1, {"toolno": 1}, output_toolno=7)
    assert out.startswith("T7 P3")


def test_apply_tool_table_row_delete_from_disk_removes_last_duplicate_t(tmp_path) -> None:
    from backend.adapters.linuxcnc_gateway import _apply_tool_table_row_delete_from_disk

    f = tmp_path / "tools.tbl"
    f.write_text(
        "T1 P1 Z+0.000000 ; first\n"
        "T1 P101 Z+1.000000 ; second\n",
        encoding="utf-8",
    )
    assert _apply_tool_table_row_delete_from_disk(str(f), 1) is None
    text = f.read_text(encoding="utf-8")
    assert "first" in text
    assert "second" not in text
    assert "T1 P101" not in text


def test_apply_tool_table_row_append_to_disk(tmp_path) -> None:
    from backend.adapters.linuxcnc_gateway import _apply_tool_table_row_append_to_disk

    f = tmp_path / "tools.tbl"
    f.write_text("T1 P1 Z+0.000000 ; a\n", encoding="utf-8")
    assert _apply_tool_table_row_append_to_disk(str(f), 2, {"toolno": 2, "zoffset": 0.0}) is None
    text = f.read_text(encoding="utf-8")
    assert "T2 P2" in text
    assert "Z+0.000000" in text


def test_apply_tool_table_row_append_to_disk_rejects_duplicate(tmp_path) -> None:
    from backend.adapters.linuxcnc_gateway import _apply_tool_table_row_append_to_disk

    f = tmp_path / "tools.tbl"
    f.write_text("T1 P1\n", encoding="utf-8")
    err = _apply_tool_table_row_append_to_disk(str(f), 1, {"toolno": 1})
    assert err is not None
    assert err[0] == "tool_already_exists"


def test_hal_get_bit_parses_halcmd_output(monkeypatch) -> None:
    gateway = LinuxCncGateway()

    def fake_run(cmd, **kwargs):
        assert "getp" in cmd
        return subprocess.CompletedProcess(
            args=cmd, returncode=0, stdout="iocontrol.0.tool-change TRUE\n", stderr=""
        )

    monkeypatch.setattr("backend.adapters.linuxcnc_gateway.shutil.which", lambda _: "/bin/halcmd")
    monkeypatch.setattr("backend.adapters.linuxcnc_gateway.subprocess.run", fake_run)

    assert gateway.hal_get_bit("iocontrol.0.tool-change", timeout_s=1.0) is True


def test_hal_get_s32_parses_halcmd_output(monkeypatch) -> None:
    gateway = LinuxCncGateway()

    def fake_run(cmd, **kwargs):
        return subprocess.CompletedProcess(
            args=cmd, returncode=0, stdout="iocontrol.0.tool-prep-number 42\n", stderr=""
        )

    monkeypatch.setattr("backend.adapters.linuxcnc_gateway.shutil.which", lambda _: "/bin/halcmd")
    monkeypatch.setattr("backend.adapters.linuxcnc_gateway.subprocess.run", fake_run)

    assert gateway.hal_get_s32("iocontrol.0.tool-prep-number", timeout_s=1.0) == 42


def test_run_shell_command_success(monkeypatch) -> None:
    gateway = LinuxCncGateway()

    def fake_run(cmd, **kwargs):
        assert cmd == "echo ok"
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="ok\n", stderr="")

    monkeypatch.setattr("backend.adapters.linuxcnc_gateway.subprocess.run", fake_run)
    r = gateway.run_shell_command("echo ok")
    assert r.ok is True


def test_get_tool_description_for_number(monkeypatch) -> None:
    gateway = LinuxCncGateway()
    row = SimpleNamespace(
        toolno=3,
        comment="  drill  ",
    )
    gateway._stat = SimpleNamespace(tool_table=[row], poll=lambda: None)
    monkeypatch.setattr(gateway_module, "linuxcnc", object())

    assert gateway.get_tool_description_for_number(3) == "drill"
    assert gateway.get_tool_description_for_number(99) == ""


def test_get_tool_description_for_number_falls_back_to_disk_map(monkeypatch) -> None:
    gateway = LinuxCncGateway()
    row = SimpleNamespace(toolno=3, comment="")
    gateway._stat = SimpleNamespace(tool_table=[row], poll=lambda: None)
    monkeypatch.setattr(gateway_module, "linuxcnc", object())
    monkeypatch.setattr(
        gateway,
        "_load_tool_table_maps_from_disk",
        lambda: ({}, {3: "from tbl file"}),
    )

    assert gateway.get_tool_description_for_number(3) == "from tbl file"


def test_get_tool_description_for_number_disk_when_no_stat(monkeypatch) -> None:
    gateway = LinuxCncGateway()
    gateway._stat = None
    monkeypatch.setattr(
        gateway,
        "_load_tool_table_maps_from_disk",
        lambda: ({}, {2: "only disk"}),
    )

    assert gateway.get_tool_description_for_number(2) == "only disk"


def _mock_linuxcnc_override_module() -> SimpleNamespace:
    return SimpleNamespace(
        STATE_ON=4,
        STATE_OFF=3,
        STATE_ESTOP=1,
    )


def _gateway_for_override_tests(
    monkeypatch,
    *,
    feedrate: float = 1.0,
    rapidrate: float = 1.0,
    task_state: int = 4,
) -> tuple[LinuxCncGateway, list[float], list[float]]:
    gateway = LinuxCncGateway()
    lc = _mock_linuxcnc_override_module()
    monkeypatch.setattr(gateway_module, "linuxcnc", lc)
    rapidrate_calls: list[float] = []
    feedrate_calls: list[float] = []
    gateway._cmd = SimpleNamespace(
        rapidrate=lambda factor: rapidrate_calls.append(float(factor)),
        feedrate=lambda factor: feedrate_calls.append(float(factor)),
    )
    gateway._stat = SimpleNamespace(
        task_state=task_state,
        feedrate=feedrate,
        rapidrate=rapidrate,
        poll=lambda: None,
    )
    return gateway, rapidrate_calls, feedrate_calls


def test_set_rapid_override_clamps_and_calls_rapidrate(monkeypatch) -> None:
    gateway, rapidrate_calls, _ = _gateway_for_override_tests(
        monkeypatch, rapidrate=0.5
    )

    result = gateway.set_rapid_override(1.5)

    assert result.ok is True
    assert result.noop is False
    assert rapidrate_calls == [1.0]


def test_set_rapid_override_clamps_to_zero(monkeypatch) -> None:
    gateway, rapidrate_calls, _ = _gateway_for_override_tests(monkeypatch)

    result = gateway.set_rapid_override(-0.25)

    assert result.ok is True
    assert rapidrate_calls == [0.0]


def test_set_rapid_override_noop_when_unchanged(monkeypatch) -> None:
    gateway, rapidrate_calls, _ = _gateway_for_override_tests(
        monkeypatch, rapidrate=0.5
    )

    result = gateway.set_rapid_override(0.5)

    assert result.ok is True
    assert result.noop is True
    assert rapidrate_calls == []


def test_set_rapid_override_rejects_machine_not_on(monkeypatch) -> None:
    gateway, rapidrate_calls, _ = _gateway_for_override_tests(
        monkeypatch, task_state=3
    )

    result = gateway.set_rapid_override(0.75)

    assert result.ok is False
    assert result.error_code == "machine_not_on"
    assert rapidrate_calls == []


def test_set_feed_override_clamps_and_noop(monkeypatch) -> None:
    gateway, _, feedrate_calls = _gateway_for_override_tests(
        monkeypatch, feedrate=1.0
    )

    unchanged = gateway.set_feed_override(1.0)
    assert unchanged.ok is True
    assert unchanged.noop is True
    assert feedrate_calls == []

    changed = gateway.set_feed_override(3.0)
    assert changed.ok is True
    assert changed.noop is False
    assert feedrate_calls == [2.0]


def _gateway_for_spindle_tests(
    monkeypatch,
    *,
    settings_s: float = 100.0,
    override: float = 0.5,
    task_state: int = 4,
    task_mode: int = 1,
    interp_state: int = 1,
) -> tuple[LinuxCncGateway, list[tuple[object, ...]]]:
    gateway = LinuxCncGateway()
    lc = SimpleNamespace(
        STATE_ON=4,
        STATE_OFF=3,
        STATE_ESTOP=1,
        MODE_MANUAL=1,
        MODE_AUTO=2,
        MODE_MDI=3,
        INTERP_IDLE=1,
        INTERP_READING=2,
        INTERP_WAITING=3,
        SPINDLE_FORWARD=1,
        SPINDLE_REVERSE=-1,
        SPINDLE_OFF=0,
    )
    monkeypatch.setattr(gateway_module, "linuxcnc", lc)
    spindle_calls: list[tuple[object, ...]] = []
    gateway._cmd = SimpleNamespace(
        spindle=lambda *args: spindle_calls.append(tuple(args)),
    )
    gateway._stat = SimpleNamespace(
        task_state=task_state,
        task_mode=task_mode,
        interp_state=interp_state,
        settings=(0.0, 0.0, settings_s),
        spindle=({"override": override, "speed": settings_s},),
        poll=lambda: None,
    )
    return gateway, spindle_calls


def test_set_spindle_commands_programmed_s_not_divided_by_override(
    monkeypatch,
) -> None:
    """Override is applied by LinuxCNC; commanding S/ov would invert (S100@50%→200)."""
    gateway, spindle_calls = _gateway_for_spindle_tests(
        monkeypatch, settings_s=100.0, override=0.5
    )

    result = gateway.set_spindle("forward")

    assert result.ok is True
    assert spindle_calls == [(1, 100.0, 0)]


def test_set_spindle_explicit_speed_not_divided_by_override(monkeypatch) -> None:
    gateway, spindle_calls = _gateway_for_spindle_tests(
        monkeypatch, settings_s=0.0, override=0.5
    )

    result = gateway.set_spindle("forward", speed_rpm=250.0)

    assert result.ok is True
    assert spindle_calls == [(1, 250.0, 0)]

