"""Capabilities: what this LinuxCNC can do, and which settings quietly do nothing on it."""

from __future__ import annotations

from backend.plasma.capabilities import FEATURES, capabilities

#: The eighteen pins LinuxCNC 2.9.4 does not export, read off the sim VM.
LINUXCNC_2_9_4_MISSING = (
    "plasmac.creep-speed",
    "plasmac.creep-speed-distance",
    "plasmac.cut-height-delay",
    "plasmac.dry-run",
    "plasmac.gouge-speed",
    "plasmac.gouge-speed-distance",
    "plasmac.laser-mode",
    "plasmac.material-thickness",
    "plasmac.offset-feed-rate",
    "plasmac.offsets-limited",
    "plasmac.pierce-end-height",
    "plasmac.pierce-motion-delay",
    "plasmac.pierce-type",
    "plasmac.probe-out",
    "plasmac.slat-height",
    "plasmac.torch-pulse-abort",
    "plasmac.torch-pulse-hold",
    "plasmac.tube-cut",
)


def test_a_machine_with_every_pin_can_do_everything() -> None:
    report = capabilities(())

    assert all(feature["available"] for feature in report["features"].values())
    assert report["ineffectiveParameters"] == []


def test_on_2_9_4_moving_pierce_and_tube_cutting_are_unavailable() -> None:
    """Neither can be offered on this LinuxCNC: the component has no pins for them."""
    features = capabilities(LINUXCNC_2_9_4_MISSING)["features"]

    assert features["movingPierce"]["available"] is False
    assert "pierce-type" in features["movingPierce"]["missing"]
    assert features["tubeCutting"]["available"] is False
    assert features["laserMode"]["available"] is False


def test_the_features_2_9_4_does_have_are_not_reported_as_missing() -> None:
    features = capabilities(LINUXCNC_2_9_4_MISSING)["features"]

    assert features["probeResult"]["available"] is False  # probe-out is absent
    # Nothing invented: a feature is only unavailable because of a pin it names.
    for feature in FEATURES:
        reported = features[feature.name]
        assert set(reported["missing"]) <= set(feature.pins)


def test_a_parameter_whose_pin_is_absent_is_flagged_as_ineffective() -> None:
    """It saves, it reads back, and it does nothing — the operator has to be told."""
    report = capabilities(LINUXCNC_2_9_4_MISSING)

    keys = {entry["key"] for entry in report["ineffectiveParameters"]}
    assert "Slat Height" in keys
    assert "Offset Feed Rate" in keys
    # A parameter whose pin exists is not flagged.
    assert "Pid P Gain" not in keys


def test_the_ineffective_list_names_the_pin_that_is_missing() -> None:
    report = capabilities(LINUXCNC_2_9_4_MISSING)

    slat = next(e for e in report["ineffectiveParameters"] if e["key"] == "Slat Height")
    assert slat["pin"] == "plasmac.slat-height"


def test_pins_are_reported_back_qualified_however_they_arrive() -> None:
    """The bridge sends `plasmac.dry-run`; the tables hold `dry-run`. Both must match."""
    report = capabilities(("dry-run",))

    assert report["features"]["dryRun"]["available"] is False
    assert report["missingPins"] == ["plasmac.dry-run"]


def test_every_feature_names_at_least_one_pin() -> None:
    """A feature with no pins would always read as available, which is worse than absent."""
    for feature in FEATURES:
        assert feature.pins
        assert feature.description
