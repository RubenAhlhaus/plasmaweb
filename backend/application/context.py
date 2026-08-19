from dataclasses import dataclass

from backend.adapters.linuxcnc_gateway import LinuxCncGateway
from backend.ws.connection_manager import ConnectionManager


@dataclass
class AppContext:
    manager: ConnectionManager
    gateway: LinuxCncGateway
