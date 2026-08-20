from dataclasses import dataclass
from typing import TYPE_CHECKING, Optional

from backend.adapters.linuxcnc_gateway import LinuxCncGateway
from backend.ws.connection_manager import ConnectionManager

if TYPE_CHECKING:  # avoids importing the plasma layer (and hal) at module import time
    from backend.plasma.config_service import PlasmaConfigService
    from backend.plasma.service import PlasmaService


@dataclass
class AppContext:
    manager: ConnectionManager
    gateway: LinuxCncGateway
    #: ``None`` when there is no LinuxCNC HAL in this process (macOS dev, tests, CI).
    plasma: Optional["PlasmaService"] = None
    #: Materials and plasma parameters. ``None`` also when there is no INI to find them in.
    plasma_config: Optional["PlasmaConfigService"] = None
