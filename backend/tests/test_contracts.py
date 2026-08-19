from pydantic import ValidationError

from backend.contracts.messages import (
    CommandEnvelope,
    ErrorDetails,
    build_async_accepted,
    build_command_completion,
    build_ok,
)


def test_command_envelope_accepts_valid_message() -> None:
    message = {
        "type": "command",
        "protocolVersion": 1,
        "commandId": "abc-123",
        "category": "machine",
        "action": "power",
        "params": {"on": True},
    }

    parsed = CommandEnvelope.model_validate(message)
    assert parsed.commandId == "abc-123"
    assert parsed.params["on"] is True


def test_command_envelope_rejects_unknown_fields() -> None:
    message = {
        "type": "command",
        "protocolVersion": 1,
        "commandId": "abc-123",
        "category": "machine",
        "action": "power",
        "params": {"on": True},
        "unexpected": "value",
    }

    try:
        CommandEnvelope.model_validate(message)
    except ValidationError:
        return

    raise AssertionError("ValidationError expected for unknown fields.")


def test_command_result_async_pending_serializes_with_exclude_none() -> None:
    ack = build_async_accepted("cmd-1")
    assert ack.asyncPending is True
    dumped = ack.model_dump(exclude_none=True)
    assert dumped["asyncPending"] is True
    assert "error" not in dumped or dumped.get("error") is None


def test_command_result_ok_with_result_serializes() -> None:
    ack = build_ok("cmd-2", {"path": "/tmp/x.ngc", "content": "M2\n"})
    dumped = ack.model_dump(exclude_none=True)
    assert dumped["ok"] is True
    assert dumped["result"]["path"] == "/tmp/x.ngc"


def test_command_completion_roundtrip() -> None:
    c = build_command_completion(
        "cmd-1",
        "motion",
        "home",
        ok=False,
        error=ErrorDetails(code="linuxcnc_command_failed", message="limit"),
    )
    assert c.type == "command_completion"
    d = c.model_dump(exclude_none=True)
    assert d["ok"] is False
    assert d["error"]["code"] == "linuxcnc_command_failed"
