"""``/api/network``: the address another machine on the shop network would type."""

from __future__ import annotations

from typing import List

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.network import create_network_router, local_ipv4_addresses


def client_for(host: str, port: int = 8765) -> TestClient:
    app = FastAPI()
    app.include_router(create_network_router(host=host, port=port))
    return TestClient(app)


@pytest.fixture
def lan(monkeypatch: pytest.MonkeyPatch):
    def _set(addresses: List[str]) -> None:
        monkeypatch.setattr("backend.api.network.local_ipv4_addresses", lambda: addresses)

    return _set


def test_a_wildcard_bind_reports_the_lan_urls(lan) -> None:
    lan(["192.168.64.2", "10.0.0.5"])

    body = client_for("0.0.0.0").get("/api/network").json()

    assert body["reachableFromNetwork"] is True
    assert body["port"] == 8765
    assert body["urls"] == ["http://192.168.64.2:8765", "http://10.0.0.5:8765"]


def test_a_loopback_bind_still_reports_the_address_but_says_it_is_not_served(lan) -> None:
    """The address is the same either way; only whether it answers today differs.

    Launched as LinuxCNC's [DISPLAY] the backend binds 127.0.0.1, so nothing outside the
    machine gets in — but the LAN address is exactly what someone needs to know to type once
    the bind is widened, so it is reported rather than hidden.
    """
    lan(["192.168.64.2"])

    body = client_for("127.0.0.1").get("/api/network").json()

    assert body["urls"] == ["http://192.168.64.2:8765"]
    assert body["reachableFromNetwork"] is False
    assert body["host"] == "127.0.0.1"


def test_a_host_with_no_lan_address_at_all_has_nothing_to_offer(lan) -> None:
    lan([])

    body = client_for("0.0.0.0").get("/api/network").json()

    assert body["reachableFromNetwork"] is False
    assert body["urls"] == []


def test_the_port_travels_into_every_url(lan) -> None:
    lan(["192.168.1.7"])

    body = client_for("0.0.0.0", port=9000).get("/api/network").json()

    assert body["urls"] == ["http://192.168.1.7:9000"]


def test_loopback_and_link_local_addresses_are_never_offered() -> None:
    """Whatever the host reports, an address no one else can dial is not an answer."""
    assert all(
        not address.startswith(("127.", "169.254."))
        for address in local_ipv4_addresses()
    )
