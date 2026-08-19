from fastapi.testclient import TestClient

from backend.main import app


def test_websocket_ack_format_for_machine_power() -> None:
    client = TestClient(app)
    with client.websocket_connect("/ws") as websocket:
        initial = websocket.receive_json()
        assert initial["type"] == "linuxcnc_status"
        assert initial["protocolVersion"] == 1

        websocket.send_json(
            {
                "type": "command",
                "protocolVersion": 1,
                "commandId": "cmd-1",
                "category": "machine",
                "action": "power",
                "params": {"on": True},
            }
        )

        ack = websocket.receive_json()
        assert ack["type"] == "command_result"
        assert ack["protocolVersion"] == 1
        assert ack["commandId"] == "cmd-1"
        assert ack["ok"] is True
