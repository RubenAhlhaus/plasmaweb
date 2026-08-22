"""The error channel: what reaches the clients, and what reaches the machine log."""

from __future__ import annotations

from backend.services.error_channel_publisher import ErrorChannelPublisher


def test_the_machine_log_records_even_with_nobody_connected() -> None:
    """The fault that happened while the page was closed is the one someone needs later."""
    import asyncio

    from backend.plasma.machine_log import MachineLog

    class FakeManager:
        active_connections: list = []

        async def broadcast_json(self, payload):  # pragma: no cover - never called here
            raise AssertionError("nothing should be broadcast with no connections")

    class FakeGateway:
        def __init__(self) -> None:
            self.messages = [("operator_error", "float switch activated")]

        def poll_error_channel_once(self):
            return self.messages.pop() if self.messages else None

    log = MachineLog()
    publisher = ErrorChannelPublisher(
        manager=FakeManager(), gateway=FakeGateway(), poll_interval_s=0.01, machine_log=log
    )

    async def drive():
        publisher.start()
        await asyncio.sleep(0.1)
        await publisher.stop()

    asyncio.run(drive())

    assert [e["message"] for e in log.entries()] == ["float switch activated"]
    assert log.last_critical() is not None
