#!/usr/bin/env python3
"""Small cross-module integration tests for the fixed-egress orchestrator."""

from __future__ import annotations

from pathlib import Path
import socket
import tempfile
import unittest
from urllib.parse import urlsplit

from miniapp_fixed_egress_preflight import FixedEgressConfig
from miniapp_fixed_egress_runtime import acquire_upload_lock, run_lifecycle


class IntegrationChannel:
    def __init__(self):
        self.closed = False
        self.timeout = None

    def recv(self, _size):
        return b""

    def sendall(self, _data):
        return None

    def shutdown_write(self):
        return None

    def settimeout(self, timeout):
        self.timeout = timeout

    def close(self):
        self.closed = True


class IntegrationTransport:
    def __init__(self):
        self.opened = []
        self.channels = []

    def is_active(self):
        return True

    def open_channel(self, kind, destination, origin, timeout=None):
        self.opened.append((kind, destination, origin, timeout))
        channel = IntegrationChannel()
        self.channels.append(channel)
        return channel


class IntegrationSsh:
    def __init__(self, transport, events):
        self.transport = transport
        self.events = events

    def get_transport(self):
        return self.transport

    def close(self):
        self.events.append("ssh-close")


class FixedEgressIntegrationTests(unittest.TestCase):
    def test_probe_only_owns_real_lock_proxy_ssh_and_handler_cleanup(self):
        config = FixedEgressConfig(
            fixed_egress_ip="203.0.113.17",
            echo_url="https://echo.example/ip",
            allowlist=frozenset({("servicewechat.com", 443)}),
            health_urls=("https://health.example/check",),
            expected_version="7.2.10",
        )
        transport = IntegrationTransport()
        events = []

        def probe_real_proxy(proxy_url, _echo_url, _fixed_ip):
            parsed = urlsplit(proxy_url)
            client = socket.create_connection((parsed.hostname, parsed.port), timeout=1)
            client.settimeout(1)
            try:
                client.sendall(
                    b"CONNECT servicewechat.com:443 HTTP/1.1\r\n\r\n"
                )
                client.shutdown(socket.SHUT_WR)
                response = client.recv(4096)
                self.assertTrue(response.startswith(b"HTTP/1.1 200 "))
            finally:
                client.close()
            events.append("probe")

        with tempfile.TemporaryDirectory() as temp_dir:
            lock_path = Path(temp_dir) / "fixed-egress.lock"
            run_lifecycle(
                config,
                probe_only=True,
                env={},
                lock_path=lock_path,
                health_checker=lambda *_args: events.append("health"),
                ssh_connector=lambda: IntegrationSsh(transport, events),
                proxy_prober=probe_real_proxy,
            )
            reacquired = acquire_upload_lock(lock_path)
            reacquired.release()

        self.assertEqual(events, ["health", "probe", "health", "ssh-close"])
        self.assertEqual(len(transport.opened), 1)
        self.assertGreater(transport.opened[0][3], 0)
        self.assertTrue(transport.channels[0].closed)


if __name__ == "__main__":
    unittest.main(verbosity=2)
