#!/usr/bin/env python3
"""Focused offline tests for fixed-egress CONNECT proxy boundaries."""

from __future__ import annotations

import socket
import threading
import time
import unittest

from miniapp_fixed_egress_common import (
    FixedEgressError,
    MINIAPP_FIXED_EGRESS_CLEANUP_FAILED,
)
import miniapp_fixed_egress_proxy as target


class MemoryChannel:
    def __init__(self, upstream=b""):
        self.closed = False
        self.timeout = None
        self.upstream = [upstream] if upstream else []
        self.sent = bytearray()

    def recv(self, _size):
        return self.upstream.pop(0) if self.upstream else b""

    def sendall(self, data):
        self.sent.extend(data)

    def shutdown_write(self):
        return None

    def settimeout(self, timeout):
        self.timeout = timeout

    def close(self):
        self.closed = True


class FakeTransport:
    def __init__(self, channel_factory=None, *, active=True, open_error=None):
        self.channel_factory = channel_factory or MemoryChannel
        self.active = active
        self.open_error = open_error
        self.opened = []
        self.channels = []

    def is_active(self):
        return self.active

    def open_channel(self, kind, destination, origin, timeout=None):
        self.opened.append((kind, destination, origin, timeout))
        if self.open_error:
            raise self.open_error
        channel = self.channel_factory()
        self.channels.append(channel)
        return channel


def request_proxy(proxy, payload):
    client = socket.create_connection(proxy.server_address, timeout=1)
    client.settimeout(1)
    try:
        client.sendall(payload)
        client.shutdown(socket.SHUT_WR)
        chunks = []
        while True:
            chunk = client.recv(4096)
            if not chunk:
                return b"".join(chunks)
            chunks.append(chunk)
    finally:
        client.close()


class ParserPolicyAndRelayTests(unittest.TestCase):
    def test_connect_authority_parser_is_strict(self):
        self.assertEqual(
            target.parse_connect_target("servicewechat.com:443"),
            ("servicewechat.com", 443),
        )
        for authority in (
            "",
            ":443",
            "servicewechat.com",
            "user@servicewechat.com:443",
            "servicewechat.com:0",
            "servicewechat.com:65536",
            "servicewechat.com:+443",
            "servicewechat.com:443\r\nX: y",
            "服务微信.com:443",
        ):
            with self.subTest(authority=authority):
                with self.assertRaises(target.ConnectTargetError):
                    target.parse_connect_target(authority)

    def test_real_loopback_proxy_opens_direct_tcpip_and_forwards_header_tail(self):
        transport = FakeTransport(
            channel_factory=lambda: MemoryChannel(b"upstream")
        )
        proxy = target.SshConnectProxy(
            transport,
            {("servicewechat.com", 443)},
        ).start()
        try:
            response = request_proxy(
                proxy,
                b"CONNECT servicewechat.com:443 HTTP/1.1\r\nHost: x\r\n\r\ntail",
            )
        finally:
            proxy.close()
        self.assertEqual(proxy.server_address[0], "127.0.0.1")
        self.assertTrue(response.startswith(b"HTTP/1.1 200 "))
        self.assertIn(b"upstream", response)
        self.assertEqual(transport.channels[0].sent, b"tail")
        kind, destination, _origin, timeout = transport.opened[0]
        self.assertEqual((kind, destination), ("direct-tcpip", ("servicewechat.com", 443)))
        self.assertEqual(timeout, target.SSH_CHANNEL_OPEN_TIMEOUT)

    def test_method_allowlist_and_header_limit_fail_closed(self):
        proxy = target.SshConnectProxy(
            FakeTransport(),
            {("servicewechat.com", 443)},
        ).start()
        try:
            cases = (
                (b"GET / HTTP/1.1\r\n\r\n", b"HTTP/1.1 405 "),
                (
                    b"CONNECT forbidden.example:443 HTTP/1.1\r\n\r\n",
                    b"HTTP/1.1 403 ",
                ),
                (b"CONNECT malformed HTTP/1.1\r\n\r\n", b"HTTP/1.1 400 "),
                (
                    b"CONNECT servicewechat.com:443 HTTP/1.1\r\nX: "
                    + b"a" * target.MAX_HEADER_BYTES
                    + b"\r\n\r\n",
                    b"HTTP/1.1 431 ",
                ),
            )
            for payload, status in cases:
                with self.subTest(status=status):
                    self.assertTrue(request_proxy(proxy, payload).startswith(status))
        finally:
            proxy.close()

    def test_incomplete_header_times_out_with_bounded_400(self):
        original_timeout = target.HEADER_READ_TIMEOUT
        target.HEADER_READ_TIMEOUT = 0.05
        proxy = target.SshConnectProxy(
            FakeTransport(),
            {("servicewechat.com", 443)},
        ).start()
        client = socket.create_connection(proxy.server_address, timeout=1)
        client.settimeout(1)
        try:
            client.sendall(b"CONNECT servicewechat.com:443 HTTP/1.1\r\n")
            self.assertTrue(client.recv(4096).startswith(b"HTTP/1.1 400 "))
        finally:
            client.close()
            proxy.close()
            target.HEADER_READ_TIMEOUT = original_timeout

    def test_slow_header_flood_has_a_hard_handler_and_client_limit(self):
        original_timeout = target.HEADER_READ_TIMEOUT
        target.HEADER_READ_TIMEOUT = 0.2
        proxy = target.SshConnectProxy(
            FakeTransport(),
            {("servicewechat.com", 443)},
            max_connections=1,
        ).start()
        clients = []
        try:
            for _index in range(12):
                client = socket.create_connection(proxy.server_address, timeout=1)
                client.settimeout(1)
                client.sendall(b"CONNECT servicewechat.com:443 HTTP/1.1\r\n")
                clients.append(client)
            time.sleep(0.05)
            self.assertLessEqual(
                proxy.handler_thread_count,
                1 + target.MAX_PROXY_REJECTION_CONNECTIONS,
            )
            self.assertLessEqual(
                proxy.tracked_resource_counts[0],
                1 + target.MAX_PROXY_REJECTION_CONNECTIONS,
            )
        finally:
            for client in clients:
                client.close()
            proxy.close()
            target.HEADER_READ_TIMEOUT = original_timeout

    def test_saturated_proxy_keeps_header_errors_before_bounded_503(self):
        original_timeout = target.HEADER_READ_TIMEOUT
        target.HEADER_READ_TIMEOUT = 0.1
        proxy = target.SshConnectProxy(
            FakeTransport(),
            {("servicewechat.com", 443)},
            max_connections=1,
        ).start()
        first = socket.create_connection(proxy.server_address, timeout=1)
        first.settimeout(1)
        try:
            first.sendall(b"CONNECT servicewechat.com:443 HTTP/1.1\r\n")
            oversized = (
                b"CONNECT servicewechat.com:443 HTTP/1.1\r\nX: "
                + b"a" * target.MAX_HEADER_BYTES
                + b"\r\n\r\n"
            )
            self.assertTrue(
                request_proxy(proxy, oversized).startswith(b"HTTP/1.1 431 ")
            )
            self.assertTrue(
                request_proxy(
                    proxy,
                    b"CONNECT servicewechat.com:443 HTTP/1.1\r\n\r\n",
                ).startswith(b"HTTP/1.1 503 ")
            )
        finally:
            first.close()
            proxy.close()
            target.HEADER_READ_TIMEOUT = original_timeout


class ProxyTimeoutTests(unittest.TestCase):
    def test_open_channel_receives_a_finite_timeout(self):
        class TimeoutTransport:
            def __init__(self):
                self.timeout = None

            def is_active(self):
                return True

            def open_channel(self, _kind, _destination, _origin, timeout=None):
                self.timeout = timeout
                if timeout is None:
                    raise AssertionError("open_channel must be bounded")
                threading.Event().wait(timeout)
                raise socket.timeout("simulated Paramiko timeout")

        transport = TimeoutTransport()
        original_timeout = target.SSH_CHANNEL_OPEN_TIMEOUT
        target.SSH_CHANNEL_OPEN_TIMEOUT = 0.05
        started = time.monotonic()
        try:
            proxy = target.SshConnectProxy(
                transport,
                {("servicewechat.com", 443)},
            ).start()
            try:
                response = request_proxy(
                    proxy,
                    b"CONNECT servicewechat.com:443 HTTP/1.1\r\n\r\n",
                )
            finally:
                proxy.close()
        finally:
            target.SSH_CHANNEL_OPEN_TIMEOUT = original_timeout
        elapsed = time.monotonic() - started
        self.assertTrue(response.startswith(b"HTTP/1.1 502 "))
        self.assertEqual(transport.timeout, 0.05)
        self.assertLess(elapsed, 0.5)

    def test_channel_timeout_is_set_before_a_blocking_tail_send(self):
        events = []

        class TailTimeoutChannel(MemoryChannel):
            def settimeout(self, timeout):
                super().settimeout(timeout)
                events.append(("settimeout", timeout))

            def sendall(self, _data):
                events.append(("sendall", self.timeout))
                if self.timeout is None:
                    raise AssertionError("tail send must be bounded")
                threading.Event().wait(self.timeout)
                raise socket.timeout("simulated bounded tail send")

        channel = TailTimeoutChannel()

        class Transport:
            def is_active(self):
                return True

            def open_channel(self, *_args, timeout=None):
                self.timeout = timeout
                return channel

        original_timeout = target.RELAY_IDLE_TIMEOUT
        target.RELAY_IDLE_TIMEOUT = 0.05
        started = time.monotonic()
        try:
            proxy = target.SshConnectProxy(
                Transport(),
                {("servicewechat.com", 443)},
            ).start()
            try:
                response = request_proxy(
                    proxy,
                    b"CONNECT servicewechat.com:443 HTTP/1.1\r\n\r\ntail",
                )
            finally:
                proxy.close()
        finally:
            target.RELAY_IDLE_TIMEOUT = original_timeout
        elapsed = time.monotonic() - started
        self.assertTrue(response.startswith(b"HTTP/1.1 200 "))
        self.assertEqual([event[0] for event in events[:2]], ["settimeout", "sendall"])
        self.assertEqual(events[0][1], events[1][1])
        self.assertLess(elapsed, 0.5)
        self.assertEqual(proxy.active_handler_count, 0)
        self.assertEqual(proxy.handler_thread_count, 0)


class ProxyCleanupTests(unittest.TestCase):
    def test_thread_start_failure_leaves_proxy_safe_to_close(self):
        real_thread_class = threading.Thread

        class FailingThread:
            def __init__(self, **_kwargs):
                return None

            def start(self):
                raise RuntimeError("thread start failed")

        proxy = target.SshConnectProxy(
            FakeTransport(),
            {("servicewechat.com", 443)},
        )
        target.threading.Thread = FailingThread
        try:
            with self.assertRaisesRegex(RuntimeError, "thread start failed"):
                proxy.start()
        finally:
            target.threading.Thread = real_thread_class
        self.assertIsNone(proxy._thread)
        proxy.close()

    def test_concurrent_close_cannot_miss_a_thread_whose_start_is_returning(self):
        real_thread_class = threading.Thread
        start_entered = threading.Event()
        allow_start_return = threading.Event()

        class DelayedReturnThread(real_thread_class):
            def start(self):
                super().start()
                start_entered.set()
                allow_start_return.wait(1)

        class Transport:
            def is_active(self):
                return True

        proxy = target.SshConnectProxy(
            Transport(),
            {("servicewechat.com", 443)},
        )
        target.threading.Thread = DelayedReturnThread
        starter = real_thread_class(target=proxy.start)
        closer = real_thread_class(target=proxy.close)
        try:
            starter.start()
            self.assertTrue(start_entered.wait(1))
            closer.start()
            allow_start_return.set()
            starter.join(1)
            closer.join(1)
            self.assertFalse(starter.is_alive())
            self.assertFalse(closer.is_alive())
            self.assertIsNotNone(proxy._thread)
            self.assertFalse(proxy._thread.is_alive())
        finally:
            target.threading.Thread = real_thread_class
            allow_start_return.set()
            if proxy._thread is not None and proxy._thread.is_alive():
                proxy._server.shutdown()
                proxy._thread.join(1)
            proxy._server.server_close()

    def test_cleanup_reports_live_handler_without_forgetting_tracked_resources(self):
        release = threading.Event()
        entered = threading.Event()

        class StubbornChannel(MemoryChannel):
            def recv(self, _size):
                entered.set()
                release.wait(2)
                return b""

        channel = StubbornChannel()

        class Transport:
            def is_active(self):
                return True

            def open_channel(self, *_args, timeout=None):
                return channel

        proxy = target.SshConnectProxy(
            Transport(),
            {("servicewechat.com", 443)},
        ).start()
        client = socket.create_connection(proxy.server_address, timeout=1)
        try:
            client.sendall(b"CONNECT servicewechat.com:443 HTTP/1.1\r\n\r\n")
            self.assertTrue(entered.wait(1))
            proxy.shutdown_resources()
            with self.assertRaises(FixedEgressError) as caught:
                proxy.wait_closed(timeout=0.05)
            self.assertEqual(caught.exception.code, MINIAPP_FIXED_EGRESS_CLEANUP_FAILED)
            self.assertNotEqual(proxy.tracked_resource_counts, (0, 0))
        finally:
            release.set()
            client.close()
            proxy.wait_closed(timeout=1)
        self.assertEqual(proxy.tracked_resource_counts, (0, 0))
        self.assertEqual(proxy.active_handler_count, 0)
        self.assertEqual(proxy.handler_thread_count, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
