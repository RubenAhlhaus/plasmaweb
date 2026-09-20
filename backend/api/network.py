"""Where this backend can be reached from — the address to type on another machine.

The browser only ever knows the URL it was opened with, which on the machine's own panel is
``127.0.0.1``. That is exactly the address no phone or laptop on the shop network can use, so
the addresses have to come from the host rather than from ``window.location``.

The address is reported whatever the bind host is, because it is the same address either way
and it is what someone types on the other machine. Whether it *works* is a separate question:
launched as LinuxCNC's ``[DISPLAY]`` program the backend binds loopback on purpose
(``backend/config.py``), and until that is widened no outside machine can reach it however
good the address looks. That is what ``reachableFromNetwork`` reports.

``host`` and ``port`` are the configured ones, which is also what the launcher binds: it
exports ``LCNCGUI_HOST``/``LCNCGUI_PORT`` from the values it passes to uvicorn
(``bin/plasmaweb``), so the two cannot drift apart in a real launch.
"""

from __future__ import annotations

import ipaddress
import socket
from typing import List

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

#: Hosts that mean "every interface", i.e. the LAN addresses are actually reachable.
_WILDCARD_HOSTS = frozenset({"0.0.0.0", "::", "*", ""})


class NetworkInfoResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: The host the server was asked to bind, verbatim from the config.
    host: str
    port: int
    #: False when the backend binds loopback only, so nothing else can reach it *yet*.
    reachableFromNetwork: bool
    #: ``http://<addr>:<port>`` for every LAN address of this host, whatever the bind is.
    #:
    #: Reported even on a loopback bind: the address is what someone types on another machine,
    #: and it is the same address before and after the bind is widened, so showing it is the
    #: useful thing to do. ``reachableFromNetwork`` is what says whether it works today.
    urls: List[str]


def local_ipv4_addresses() -> List[str]:
    """Every non-loopback IPv4 address of this host, best guess first.

    Resolving the hostname is what a Linux box will normally answer with; the UDP-connect
    trick is the fallback that works when ``/etc/hosts`` maps the hostname to 127.0.1.1, which
    Debian — and therefore the LinuxCNC ISO — does by default.
    """
    found: List[str] = []

    def add(raw: str) -> None:
        try:
            address = ipaddress.IPv4Address(raw)
        except ipaddress.AddressValueError:
            return
        if address.is_loopback or address.is_link_local or address.is_unspecified:
            return
        if raw not in found:
            found.append(raw)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Never sends a packet; it only makes the kernel pick the outbound interface.
        sock.connect(("192.0.2.1", 9))
        add(sock.getsockname()[0])
    except OSError:
        pass
    finally:
        sock.close()

    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            add(info[4][0])
    except OSError:
        pass

    return found


def create_network_router(*, host: str, port: int) -> APIRouter:
    router = APIRouter(prefix="/api", tags=["network"])

    @router.get("/network", response_model=NetworkInfoResponse)
    async def get_network() -> NetworkInfoResponse:
        addresses = local_ipv4_addresses()
        wildcard = host.strip() in _WILDCARD_HOSTS
        return NetworkInfoResponse(
            host=host,
            port=port,
            reachableFromNetwork=wildcard and bool(addresses),
            urls=[f"http://{address}:{port}" for address in addresses],
        )

    return router
