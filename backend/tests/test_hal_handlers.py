import asyncio
import subprocess

from backend.application.command_bus import CommandBus
from backend.application.context import AppContext
from backend.contracts.messages import CommandEnvelope
from backend.handlers.hal import handle_hal_softkey_pulse
from backend.tests.test_command_bus import FakeGateway
from backend.ws.connection_manager import ConnectionManager


def test_hal_set_bit_success(monkeypatch) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway

    gateway = LinuxCncGateway()
    calls: list[list[str]] = []

    def fake_run(cmd, **kwargs):
        calls.append(list(cmd))
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    monkeypatch.setattr("backend.adapters.linuxcnc_gateway.shutil.which", lambda _: "/bin/halcmd")
    monkeypatch.setattr("backend.adapters.linuxcnc_gateway.subprocess.run", fake_run)

    assert gateway.hal_set_bit("lcncgui-sk-14.in", True, timeout_s=1.0).ok is True
    assert calls[-1] == ["/bin/halcmd", "-s", "setp", "lcncgui-sk-14.in", "1"]


def test_hal_pulse_rising_edge_sequence(monkeypatch) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway

    gateway = LinuxCncGateway()
    values: list[str] = []

    def fake_run(cmd, **kwargs):
        values.append(cmd[-1])
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    monkeypatch.setattr("backend.adapters.linuxcnc_gateway.shutil.which", lambda _: "/bin/halcmd")
    monkeypatch.setattr("backend.adapters.linuxcnc_gateway.subprocess.run", fake_run)

    result = gateway.hal_pulse_rising_edge("lcncgui-sk-15.in", timeout_s=1.0)
    assert result.ok is True
    assert values == ["0", "1", "0"]


def test_hal_set_bit_halcmd_unavailable(monkeypatch) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway

    gateway = LinuxCncGateway()
    monkeypatch.setattr("backend.adapters.linuxcnc_gateway.shutil.which", lambda _: None)

    result = gateway.hal_set_bit("lcncgui-sk-14.in", True)
    assert result.ok is False
    assert result.error_code == "halcmd_unavailable"


def test_command_bus_routes_hal_softkey_pulse(monkeypatch) -> None:
    gateway = FakeGateway()
    pulses: list[str] = []

    def fake_pulse(pin: str, *, timeout_s: float = 3.0):
        pulses.append(pin)
        from backend.adapters.linuxcnc_gateway import GatewayCommandResult

        return GatewayCommandResult(ok=True, noop=False)

    monkeypatch.setattr(gateway, "hal_pulse_rising_edge", fake_pulse)

    bus = CommandBus()
    bus.register("hal", "softkey_pulse", handle_hal_softkey_pulse)
    ctx = AppContext(manager=ConnectionManager(), gateway=gateway)  # type: ignore[arg-type]

    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-hal-sk",
        category="hal",
        action="softkey_pulse",
        params={"slot": 14},
    )

    result = asyncio.run(bus.dispatch(command, ctx))
    assert result.ack.ok is True
    assert pulses == ["lcncgui-sk-14.in"]


def test_get_hal_softkey_feedback(monkeypatch) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway

    gateway = LinuxCncGateway()
    calls: list[str] = []

    def fake_get_bit(pin: str, *, timeout_s: float = 3.0):
        calls.append(pin)
        return pin.endswith("14-fb.out")

    monkeypatch.setattr(gateway, "hal_get_bit", fake_get_bit)

    fb = gateway.get_hal_softkey_feedback()
    assert fb == {"14": 1, "15": 0, "16": 0}
    assert calls == [
        "lcncgui-sk-14-fb.out",
        "lcncgui-sk-15-fb.out",
        "lcncgui-sk-16-fb.out",
    ]


def test_get_hal_softkey_feedback_omits_unreadable_pins(monkeypatch) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway

    gateway = LinuxCncGateway()

    def fake_get_bit(pin: str, *, timeout_s: float = 3.0):
        if pin.endswith("14-fb.out"):
            return True
        if pin.endswith("15-fb.out"):
            return False
        return None

    monkeypatch.setattr(gateway, "hal_get_bit", fake_get_bit)

    assert gateway.get_hal_softkey_feedback() == {"14": 1, "15": 0}


def test_hal_softkey_pulse_invalid_slot() -> None:
    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]
    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-hal-bad",
        category="hal",
        action="softkey_pulse",
        params={"slot": 99},
    )

    result = asyncio.run(handle_hal_softkey_pulse(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None


def test_set_jog_wheel_scale_writes_all_pins(monkeypatch) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway

    gateway = LinuxCncGateway()
    calls: list[list[str]] = []

    def fake_run(cmd, **kwargs):
        calls.append(list(cmd))
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    monkeypatch.setattr("backend.adapters.linuxcnc_gateway.shutil.which", lambda _: "/bin/halcmd")
    monkeypatch.setattr("backend.adapters.linuxcnc_gateway.subprocess.run", fake_run)

    assert gateway.set_jog_wheel_scale(0.1, timeout_s=1.0).ok is True
    assert calls == [
        ["/bin/halcmd", "-s", "setp", "axis.x.jog-scale", "0.1"],
        ["/bin/halcmd", "-s", "setp", "axis.y.jog-scale", "0.1"],
        ["/bin/halcmd", "-s", "setp", "axis.z.jog-scale", "0.1"],
    ]


def test_set_jog_wheel_scale_missing_pin_is_noop(monkeypatch) -> None:
    from backend.adapters.linuxcnc_gateway import LinuxCncGateway

    gateway = LinuxCncGateway()

    def fake_run(cmd, **kwargs):
        return subprocess.CompletedProcess(
            args=cmd,
            returncode=1,
            stdout="",
            stderr="<commandline>:0: pin or parameter 'axis.x.jog-scale' not found\n",
        )

    monkeypatch.setattr("backend.adapters.linuxcnc_gateway.shutil.which", lambda _: "/bin/halcmd")
    monkeypatch.setattr("backend.adapters.linuxcnc_gateway.subprocess.run", fake_run)

    result = gateway.set_jog_wheel_scale(1.0, timeout_s=1.0)
    assert result.ok is True
    assert result.noop is True


def test_hal_set_jog_wheel_scale_invalid_params() -> None:
    from backend.handlers.hal import handle_hal_set_jog_wheel_scale

    ctx = AppContext(manager=ConnectionManager(), gateway=FakeGateway())  # type: ignore[arg-type]
    command = CommandEnvelope(
        type="command",
        protocolVersion=1,
        commandId="id-jog-scale-bad",
        category="hal",
        action="set_jog_wheel_scale",
        params={"scale": 0},
    )
    result = asyncio.run(handle_hal_set_jog_wheel_scale(command, ctx))
    assert result.ack.ok is False
    assert result.ack.error is not None
    assert result.ack.error.code == "invalid_params"
