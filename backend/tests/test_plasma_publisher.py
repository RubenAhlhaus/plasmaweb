"""Publisher tests: the bridge thread hands over diffs, the loop broadcasts them.

The repo has no async pytest plugin, so each test drives its own loop with
``asyncio.run`` — same as ``backend/tests/test_command_bus.py``.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

from backend.plasma.pins import PLASMAC_COMPONENT, QTPLASMAC_COMPONENT
from backend.plasma.service import PlasmaService
from backend.services.plasma_publisher import (
    PINS_CHANGED_EVENT,
    PINS_SNAPSHOT_EVENT,
    STATE_CHANGED_EVENT,
    PlasmaPublisher,
    snapshot_event,
)
from backend.tests.test_plasma_hal_bridge import FakeHalRuntime, make_bridge


class FakeManager:
    def __init__(self, connected: bool = True) -> None:
        self.active_connections: List[object] = [object()] if connected else []
        self.broadcasts: List[Dict[str, Any]] = []
        self.sent: List[Dict[str, Any]] = []

    async def broadcast_json(self, message: Dict[str, Any]) -> None:
        self.broadcasts.append(message)

    async def send_json(self, websocket: object, message: Dict[str, Any]) -> None:
        self.sent.append(message)


def build(connected: bool = True, **runtime_kwargs: Any):
    runtime = FakeHalRuntime(**runtime_kwargs)
    bridge = make_bridge(runtime)
    bridge.poll_once()
    service = PlasmaService(bridge)
    manager = FakeManager(connected=connected)
    return PlasmaPublisher(manager=manager, service=service), manager, bridge, runtime


async def _wait_for(predicate, timeout_s: float = 2.0) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_s
    while not predicate() and loop.time() < deadline:
        await asyncio.sleep(0.01)


def test_diff_is_broadcast_as_a_pins_changed_event() -> None:
    publisher, manager, _, _ = build()
    asyncio.run(publisher.publish_diff({PLASMAC_COMPONENT: {"torch-on": True}}))

    assert len(manager.broadcasts) == 1
    event = manager.broadcasts[0]
    assert event["type"] == "machine_event"
    assert event["event"] == PINS_CHANGED_EVENT
    assert event["payload"] == {"pins": {PLASMAC_COMPONENT: {"torch-on": True}}}


def test_nothing_is_sent_without_clients() -> None:
    publisher, manager, _, _ = build(connected=False)
    asyncio.run(publisher.publish_diff({PLASMAC_COMPONENT: {"torch-on": True}}))
    assert manager.broadcasts == []


def test_nothing_is_sent_for_an_empty_diff() -> None:
    publisher, manager, _, _ = build()
    asyncio.run(publisher.publish_diff({}))
    assert manager.broadcasts == []


def test_state_pins_also_emit_a_decoded_state_event() -> None:
    publisher, manager, bridge, runtime = build()
    runtime.plasmac_values["state-out"] = 11
    bridge.poll_once()

    asyncio.run(publisher.publish_diff({PLASMAC_COMPONENT: {"state-out": 11}}))

    assert [event["event"] for event in manager.broadcasts] == [
        PINS_CHANGED_EVENT,
        STATE_CHANGED_EVENT,
    ]
    assert manager.broadcasts[1]["payload"]["stateName"] == "CUT_MODE_01"
    assert manager.broadcasts[1]["payload"]["isCutting"] is True


def test_state_event_is_not_repeated_when_the_decoded_state_is_unchanged() -> None:
    publisher, manager, bridge, runtime = build()
    runtime.plasmac_values["state-out"] = 6
    bridge.poll_once()

    async def _run() -> None:
        await publisher.publish_diff({PLASMAC_COMPONENT: {"state-out": 6}})
        await publisher.publish_diff({PLASMAC_COMPONENT: {"state-out": 6}})

    asyncio.run(_run())
    assert [event["event"] for event in manager.broadcasts].count(STATE_CHANGED_EVENT) == 1


def test_ordinary_pin_changes_do_not_emit_a_state_event() -> None:
    publisher, manager, _, _ = build()
    asyncio.run(publisher.publish_diff({PLASMAC_COMPONENT: {"arc-voltage-out": 101.2}}))
    assert [event["event"] for event in manager.broadcasts] == [PINS_CHANGED_EVENT]


def test_queued_diffs_are_merged_into_one_broadcast() -> None:
    """A backed-up loop must not replay every intermediate value of a pin."""
    publisher, manager, _, _ = build()

    async def _run() -> None:
        publisher.start()
        try:
            publisher.submit_change({PLASMAC_COMPONENT: {"arc-voltage-out": 1.0}})
            publisher.submit_change({PLASMAC_COMPONENT: {"arc-voltage-out": 2.0}})
            publisher.submit_change({QTPLASMAC_COMPONENT: {"laser-on": True}})
            await _wait_for(lambda: bool(manager.broadcasts))
        finally:
            await publisher.stop()

    asyncio.run(_run())

    assert len(manager.broadcasts) == 1
    assert manager.broadcasts[0]["payload"]["pins"] == {
        PLASMAC_COMPONENT: {"arc-voltage-out": 2.0},
        QTPLASMAC_COMPONENT: {"laser-on": True},
    }


def test_bridge_changes_reach_the_loop_from_the_bridge_thread() -> None:
    publisher, manager, bridge, runtime = build()

    async def _run() -> None:
        publisher.start()
        try:
            bridge.start()
            runtime.plasmac_values["torch-on"] = True
            await _wait_for(
                lambda: any(
                    event["payload"].get("pins", {}).get(PLASMAC_COMPONENT, {}).get("torch-on")
                    for event in manager.broadcasts
                )
            )
        finally:
            bridge.stop()
            await publisher.stop()

    asyncio.run(_run())

    assert any(
        event["payload"].get("pins", {}).get(PLASMAC_COMPONENT, {}).get("torch-on")
        for event in manager.broadcasts
    ), "torch-on change never reached the event loop"


def test_snapshot_event_carries_the_full_state() -> None:
    publisher, _, bridge, runtime = build(absent=("dry-run",))
    runtime.plasmac_values["state-out"] = 0
    bridge.poll_once()

    event = publisher.snapshot_event()
    assert event["event"] == PINS_SNAPSHOT_EVENT
    assert event["payload"]["state"]["stateName"] == "IDLE"
    assert event["payload"]["missingPins"] == ["plasmac.dry-run"]
    assert "torch-on" in event["payload"]["pins"][PLASMAC_COMPONENT]

    # the module-level helper the WebSocket route uses must produce the same thing
    assert snapshot_event(PlasmaService(bridge)) == event


def test_a_probe_error_stops_the_probe_test_even_with_nobody_watching() -> None:
    """The torch is on its way down; the browser being closed must not matter."""
    from backend.services.plasma_publisher import PROBE_ERROR_EVENT

    publisher, manager, bridge, runtime = build()

    asyncio.run(publisher.publish_diff({PLASMAC_COMPONENT: {"probe-test-error": True}}))
    bridge._apply_pending_writes()

    assert ("plasmac.probe-test", "0") in runtime.set_p_calls
    # The error goes out first, then the diff that carried it.
    assert [msg["event"] for msg in manager.broadcasts][0] == PROBE_ERROR_EVENT


def test_no_probe_error_means_no_interference() -> None:
    publisher, manager, bridge, runtime = build()

    asyncio.run(publisher.publish_diff({PLASMAC_COMPONENT: {"torch-on": True}}))
    bridge._apply_pending_writes()

    assert not any(call[0] == "plasmac.probe-test" for call in runtime.set_p_calls)


def test_a_probe_error_also_cancels_the_countdown() -> None:
    """Otherwise the dead test's timer arrives mid-way through the next one."""
    publisher, _manager, bridge, _runtime = build()

    class FakeTimer:
        def __init__(self) -> None:
            self.cancelled = False

        def done(self) -> bool:
            return False

        def cancel(self) -> None:
            self.cancelled = True

    timer = FakeTimer()
    publisher._service.set_probe_test_timer(timer)

    asyncio.run(publisher.publish_diff({PLASMAC_COMPONENT: {"probe-test-error": True}}))

    assert timer.cancelled is True
    assert publisher._service.probe_test_running() is False


def test_a_write_hal_refused_is_reported_rather_than_only_logged() -> None:
    """The ack went out when the write was accepted; the refusal happens later, in the thread."""
    from backend.services.plasma_publisher import WRITE_ERROR_EVENT

    publisher, manager, bridge, _runtime = build()
    bridge.allow_external_pin("motion.digital-out-00")
    bridge.request_external_write("motion.digital-out-00", True)
    bridge._apply_pending_writes()  # the fake runtime accepts it, so fake a refusal instead
    bridge._write_errors.append("motion.digital-out-00: pin has a writer")

    asyncio.run(publisher.publish_diff({PLASMAC_COMPONENT: {"torch-on": False}}))

    events = [msg for msg in manager.broadcasts if msg["event"] == WRITE_ERROR_EVENT]
    assert events and "pin has a writer" in events[0]["payload"]["message"]
    # Reported once, then forgotten.
    assert bridge.take_write_errors() == ()


def test_a_refused_write_is_reported_even_when_no_pin_moved() -> None:
    """An idle machine produces no diff, and that is when a write is most likely refused."""
    from backend.services.plasma_publisher import WRITE_ERROR_EVENT

    publisher, manager, bridge, _runtime = build()
    bridge._write_errors.append("motion.digital-out-00: pin is not writable")

    asyncio.run(publisher.publish_diff({}))

    events = [msg for msg in manager.broadcasts if msg["event"] == WRITE_ERROR_EVENT]
    assert events and "not writable" in events[0]["payload"]["message"]
