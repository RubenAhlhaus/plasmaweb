"""Tests for lcncgui tool table sidecar (``*.lcncgui-tools.json``)."""

import os

from backend.services import tool_sidecar as ts


def test_sidecar_path_for_tool_table() -> None:
    out = ts.sidecar_path_for_tool_table("/x/y/tools.tbl")
    assert os.path.basename(out) == "tools.lcncgui-tools.json"


def test_short_table_comment_from_meta_truncates() -> None:
    long_name = "x" * 300
    s = ts.short_table_comment_from_meta({"name": long_name})
    assert len(s) == 200


def test_load_save_roundtrip(tmp_path) -> None:
    tbl = tmp_path / "t.tbl"
    tbl.write_text("T1 P1 Z0 D3\n", encoding="utf-8")
    p = str(tbl)
    ts.upsert_tool_in_sidecar(
        p,
        1,
        meta={"name": "Endmill", "type": "Flat End Mill", "material": "VHM"},
        presets=[{"name": "Alu", "spindle_rpm": 12000, "feed_mm_min": 800}],
    )
    doc = ts.load_tool_sidecar(p)
    assert doc["tools"]["1"]["meta"]["name"] == "Endmill"
    assert len(doc["tools"]["1"]["presets"]) == 1
    assert doc["tools"]["1"]["presets"][0]["spindle_rpm"] == 12000
    assert "id" in doc["tools"]["1"]["presets"][0]

    ts.remove_tool_from_sidecar(p, 1)
    doc2 = ts.load_tool_sidecar(p)
    assert "1" not in doc2["tools"]


def test_load_tool_sidecar_invalid_version_does_not_crash(tmp_path) -> None:
    tbl = tmp_path / "tver.tbl"
    tbl.write_text("T1 P1 Z0\n", encoding="utf-8")
    p = str(tbl)
    sc = tmp_path / "tver.lcncgui-tools.json"
    sc.write_text(
        '{"version": "not-a-number", "tools": {"1": {"meta": {"name": "Z"}, "presets": []}}}',
        encoding="utf-8",
    )
    doc = ts.load_tool_sidecar(p)
    assert doc["version"] == ts.SIDECAR_VERSION
    assert doc["tools"]["1"]["meta"]["name"] == "Z"


def test_presets_with_only_id_are_dropped(tmp_path) -> None:
    tbl = tmp_path / "tstub.tbl"
    tbl.write_text("T1 P1 Z0\n", encoding="utf-8")
    p = str(tbl)
    ts.upsert_tool_in_sidecar(
        p, 1, meta={"name": "X"}, presets=[{"id": "abc-123"}]
    )
    doc = ts.load_tool_sidecar(p)
    assert doc["tools"]["1"]["presets"] == []


def test_presets_extended_fields_roundtrip(tmp_path) -> None:
    tbl = tmp_path / "text.tbl"
    tbl.write_text("T9 P9 Z0\n", encoding="utf-8")
    p = str(tbl)
    ts.upsert_tool_in_sidecar(
        p,
        9,
        meta={"name": "Mill"},
        presets=[
            {
                "name": "Stahl schlichten",
                "spindle_rpm": 5000,
                "surface_speed_m_per_min": 94.25,
                "ramp_spindle_rpm": 3000,
                "feed_mm_min": 1000,
                "feed_per_tooth_mm": 0.05,
                "lead_in_feed_mm_min": 800,
                "use_stepdown": True,
                "max_stepdown_mm": 2.5,
                "coolant": "external_water",
            }
        ],
    )
    doc = ts.load_tool_sidecar(p)
    pr = doc["tools"]["9"]["presets"][0]
    assert pr["name"] == "Stahl schlichten"
    assert pr["spindle_rpm"] == 5000
    assert pr["surface_speed_m_per_min"] == 94.25
    assert pr["feed_per_tooth_mm"] == 0.05
    assert pr["use_stepdown"] is True
    assert pr["max_stepdown_mm"] == 2.5
    assert pr["coolant"] == "external_water"


def test_presets_kept_with_coolant_only(tmp_path) -> None:
    tbl = tmp_path / "tcool.tbl"
    tbl.write_text("T8 P8 Z0\n", encoding="utf-8")
    p = str(tbl)
    ts.upsert_tool_in_sidecar(
        p, 8, meta={"name": "X"}, presets=[{"name": "", "coolant": "off"}]
    )
    doc = ts.load_tool_sidecar(p)
    assert len(doc["tools"]["8"]["presets"]) == 1
    assert doc["tools"]["8"]["presets"][0]["coolant"] == "off"


def test_rename_tool_in_sidecar_moves_entry(tmp_path) -> None:
    tbl = tmp_path / "tr.tbl"
    tbl.write_text("T1 P1 Z0\n", encoding="utf-8")
    p = str(tbl)
    ts.upsert_tool_in_sidecar(
        p, 1, meta={"name": "Moved"}, presets=[{"name": "P1", "spindle_rpm": 1000}]
    )
    ts.rename_tool_in_sidecar(p, 1, 5)
    doc = ts.load_tool_sidecar(p)
    assert "1" not in doc["tools"]
    assert doc["tools"]["5"]["meta"]["name"] == "Moved"
    assert doc["tools"]["5"]["presets"][0]["spindle_rpm"] == 1000


def test_sidecar_entry_substantive(tmp_path) -> None:
    tbl = tmp_path / "tsub.tbl"
    tbl.write_text("T1 P1\n", encoding="utf-8")
    p = str(tbl)
    assert ts.sidecar_entry_substantive({"meta": {}, "presets": []}) is False
    assert ts.sidecar_entry_substantive({"meta": {"name": "X"}, "presets": []}) is True
    ts.upsert_tool_in_sidecar(p, 3, meta={"name": "Z"}, presets=[])
    assert ts.sidecar_has_substantive_entry(p, 3) is True
    assert ts.sidecar_has_substantive_entry(p, 99) is False


def test_upsert_presets_only_keeps_meta(tmp_path) -> None:
    tbl = tmp_path / "t2.tbl"
    tbl.write_text("T2 P2 Z0\n", encoding="utf-8")
    p = str(tbl)
    ts.upsert_tool_in_sidecar(p, 2, meta={"name": "A"}, presets=[])
    ts.upsert_tool_in_sidecar(p, 2, meta=ts.MISSING, presets=[{"name": "Rough", "spindle_rpm": 1000}])
    doc = ts.load_tool_sidecar(p)
    assert doc["tools"]["2"]["meta"]["name"] == "A"
    assert len(doc["tools"]["2"]["presets"]) == 1
