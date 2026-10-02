from __future__ import annotations

import pytest

from src.security import host_allowed, hostname_of


@pytest.mark.parametrize(("header", "name"), [
    ("example.com", "example.com"), ("Example.COM:8765", "example.com"), ("127.0.0.1:8765", "127.0.0.1"),
    ("[::1]:8765", "[::1]"), ("[::1]", "[::1]"), ("", ""), ("[broken", "[broken"),
])
def test_hostname_of(header, name):
    assert hostname_of(header) == name


def test_host_allowed_exact_wildcard_and_star():
    allowed = ["127.0.0.1", "localhost", "[::1]", "*.lan"]
    assert host_allowed("localhost:8765", allowed)
    assert host_allowed("[::1]:8765", allowed)
    assert host_allowed("nas.lan", allowed)
    assert not host_allowed("evil.com", allowed)
    assert not host_allowed("lan", allowed)                  # a wildcard needs a subdomain
    assert not host_allowed("evillan", allowed)
    assert not host_allowed("", allowed)
    assert host_allowed("anything.example", ["*"])
