"""Loopback HTTP CONNECT proxy backed by Paramiko direct-tcpip channels."""

from __future__ import annotations

import re
import socket
import socketserver
import threading
import time
from typing import Iterable

from miniapp_fixed_egress_common import (
    FixedEgressError,
    MINIAPP_FIXED_EGRESS_CLEANUP_FAILED,
    MINIAPP_FIXED_EGRESS_CONCURRENCY_LIMIT,
    MINIAPP_FIXED_EGRESS_PROXY_FAILURE,
    MINIAPP_FIXED_EGRESS_SSH_INACTIVE,
)


MAX_HEADER_BYTES = 16 * 1024
HEADER_READ_TIMEOUT = 5.0
RELAY_IDLE_TIMEOUT = 30.0
SSH_CHANNEL_OPEN_TIMEOUT = 10.0
PROXY_CLEANUP_TIMEOUT = 2.0
MAX_PROXY_CONNECTIONS = 8
MAX_PROXY_REJECTION_CONNECTIONS = 2


class ConnectTargetError(ValueError):
    pass


class _HeaderReadError(Exception):
    def __init__(self, status: int, code: str):
        self.status = status
        self.code = code
        super().__init__(code)


def parse_connect_target(authority: str) -> tuple[str, int]:
    """Parse a strict ASCII host:port CONNECT authority."""
    if not isinstance(authority, str) or not authority:
        raise ConnectTargetError("authority is required")
    try:
        authority.encode("ascii", "strict")
    except UnicodeEncodeError as error:
        raise ConnectTargetError("authority must be ASCII") from error
    if any(character in authority for character in "\r\n@"):
        raise ConnectTargetError("authority contains a forbidden character")
    host, separator, raw_port = authority.rpartition(":")
    if not separator or not host or not raw_port:
        raise ConnectTargetError("authority must be host:port")
    if ":" in host or not re.fullmatch(r"[A-Za-z0-9.-]+", host):
        raise ConnectTargetError("host syntax is invalid")
    if not re.fullmatch(r"[0-9]+", raw_port):
        raise ConnectTargetError("port syntax is invalid")
    port = int(raw_port, 10)
    if port < 1 or port > 65535:
        raise ConnectTargetError("port is out of range")
    return host.lower(), port


def _safe_close(resource) -> None:
    try:
        resource.close()
    except Exception:
        pass


def _safe_shutdown_write(resource) -> None:
    try:
        method = getattr(resource, "shutdown_write", None)
        if callable(method):
            method()
        else:
            resource.shutdown(socket.SHUT_WR)
    except Exception:
        pass


def _relay_bidirectional(client: socket.socket, channel) -> None:
    def pump(source, destination):
        try:
            while True:
                data = source.recv(64 * 1024)
                if not data:
                    break
                destination.sendall(data)
        except (OSError, EOFError, socket.timeout):
            pass
        finally:
            _safe_shutdown_write(destination)

    client_to_channel = threading.Thread(
        target=pump,
        args=(client, channel),
        daemon=True,
        name="miniapp-proxy-client-to-ssh",
    )
    channel_to_client = threading.Thread(
        target=pump,
        args=(channel, client),
        daemon=True,
        name="miniapp-proxy-ssh-to-client",
    )
    client_to_channel.start()
    channel_to_client.start()
    client_to_channel.join()
    channel_to_client.join()


class _ConnectRequestHandler(socketserver.BaseRequestHandler):
    def _send_status(self, status: int, phrase: str, code: str) -> None:
        body = (code + "\n").encode("ascii", "strict")
        response = (
            f"HTTP/1.1 {status} {phrase}\r\n"
            "Connection: close\r\n"
            "Content-Type: text/plain; charset=us-ascii\r\n"
            f"Content-Length: {len(body)}\r\n\r\n"
        ).encode("ascii") + body
        try:
            self.request.sendall(response)
        except OSError:
            pass

    def _read_header(self) -> tuple[bytes, bytes]:
        buffer = bytearray()
        self.request.settimeout(HEADER_READ_TIMEOUT)
        while True:
            try:
                chunk = self.request.recv(4096)
            except socket.timeout as error:
                raise _HeaderReadError(
                    400, "MINIAPP_FIXED_EGRESS_HEADER_TIMEOUT"
                ) from error
            if not chunk:
                raise _HeaderReadError(400, "MINIAPP_FIXED_EGRESS_BAD_REQUEST")
            buffer.extend(chunk)
            marker = buffer.find(b"\r\n\r\n")
            if marker >= 0:
                header_end = marker + 4
                if header_end > MAX_HEADER_BYTES:
                    raise _HeaderReadError(
                        431, "MINIAPP_FIXED_EGRESS_HEADER_TOO_LARGE"
                    )
                return bytes(buffer[:header_end]), bytes(buffer[header_end:])
            if len(buffer) > MAX_HEADER_BYTES:
                raise _HeaderReadError(
                    431, "MINIAPP_FIXED_EGRESS_HEADER_TOO_LARGE"
                )

    def _send_header_error(self, error: _HeaderReadError) -> None:
        phrase = (
            "Request Header Fields Too Large"
            if error.status == 431
            else "Bad Request"
        )
        self._send_status(error.status, phrase, error.code)

    def handle(self) -> None:
        server = self.server
        client = self.request
        channel = None
        admission = server.admission_for(client)
        if not server.register_client(client):
            return
        try:
            if admission == "rejection":
                try:
                    self._read_header()
                except _HeaderReadError as error:
                    self._send_header_error(error)
                    return
                self._send_status(
                    503,
                    "Service Unavailable",
                    MINIAPP_FIXED_EGRESS_CONCURRENCY_LIMIT,
                )
                return
            if admission != "normal":
                return
            try:
                header, tail = self._read_header()
            except _HeaderReadError as error:
                self._send_header_error(error)
                return
            request_line = header.split(b"\r\n", 1)[0]
            try:
                decoded_line = request_line.decode("ascii", "strict")
            except UnicodeDecodeError:
                self._send_status(
                    400, "Bad Request", "MINIAPP_FIXED_EGRESS_BAD_REQUEST"
                )
                return
            parts = decoded_line.split(" ")
            if len(parts) != 3 or not parts[0]:
                self._send_status(
                    400, "Bad Request", "MINIAPP_FIXED_EGRESS_BAD_REQUEST"
                )
                return
            method, authority, http_version = parts
            if method != "CONNECT":
                self._send_status(
                    405, "Method Not Allowed", "MINIAPP_FIXED_EGRESS_CONNECT_ONLY"
                )
                return
            if http_version not in ("HTTP/1.0", "HTTP/1.1"):
                self._send_status(
                    400, "Bad Request", "MINIAPP_FIXED_EGRESS_BAD_REQUEST"
                )
                return
            try:
                destination = parse_connect_target(authority)
            except ConnectTargetError:
                self._send_status(
                    400, "Bad Request", "MINIAPP_FIXED_EGRESS_BAD_TARGET"
                )
                return
            if destination[1] != 443 or destination not in server.allowlist:
                self._send_status(
                    403, "Forbidden", "MINIAPP_FIXED_EGRESS_TARGET_FORBIDDEN"
                )
                return
            try:
                if not server.transport or not server.transport.is_active():
                    raise FixedEgressError(MINIAPP_FIXED_EGRESS_SSH_INACTIVE)
                channel = server.transport.open_channel(
                    "direct-tcpip",
                    destination,
                    self.client_address,
                    timeout=SSH_CHANNEL_OPEN_TIMEOUT,
                )
                if channel is None:
                    raise OSError("SSH returned no channel")
                set_channel_timeout = getattr(channel, "settimeout", None)
                if not callable(set_channel_timeout):
                    raise OSError("SSH channel does not support bounded I/O")
                set_channel_timeout(RELAY_IDLE_TIMEOUT)
            except Exception:
                self._send_status(
                    502, "Bad Gateway", MINIAPP_FIXED_EGRESS_PROXY_FAILURE
                )
                return
            if not server.register_channel(channel):
                return
            client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            if tail:
                channel.sendall(tail)
            client.settimeout(RELAY_IDLE_TIMEOUT)
            _relay_bidirectional(client, channel)
        except (OSError, EOFError, socket.timeout):
            pass
        finally:
            if channel is not None:
                _safe_close(channel)
                server.unregister_channel(channel)
            _safe_close(client)
            server.unregister_client(client)


class _LoopbackThreadingServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    block_on_close = False

    def __init__(self, transport, allowlist, max_connections):
        self.transport = transport
        self.allowlist = frozenset(allowlist)
        self._normal_slots = threading.BoundedSemaphore(max_connections)
        self._rejection_slots = threading.BoundedSemaphore(
            MAX_PROXY_REJECTION_CONNECTIONS
        )
        self._admission_lock = threading.Lock()
        self._admissions = {}
        self._handler_threads_lock = threading.Lock()
        self._handler_threads = set()
        self._handler_thread_name_prefix = (
            f"miniapp-fixed-egress-handler-{id(self):x}"
        )
        self._resource_lock = threading.Lock()
        self._closing = threading.Event()
        self._clients = set()
        self._channels = set()
        super().__init__(("127.0.0.1", 0), _ConnectRequestHandler)

    def _release_slot(self, admission):
        if admission == "normal":
            self._normal_slots.release()
        elif admission == "rejection":
            self._rejection_slots.release()

    def _acquire_admission(self, request_socket):
        if self._normal_slots.acquire(blocking=False):
            admission = "normal"
        elif self._rejection_slots.acquire(blocking=False):
            admission = "rejection"
        else:
            return None
        with self._admission_lock:
            if self._closing.is_set():
                accepted = False
            else:
                self._admissions[request_socket] = admission
                accepted = True
        if not accepted:
            self._release_slot(admission)
            return None
        return admission

    def admission_for(self, request_socket):
        with self._admission_lock:
            return self._admissions.get(request_socket)

    def _release_admission(self, request_socket):
        with self._admission_lock:
            admission = self._admissions.pop(request_socket, None)
        if admission is not None:
            self._release_slot(admission)

    def _close_unadmitted(self, request_socket):
        try:
            request_socket.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        _safe_close(request_socket)

    def process_request(self, request_socket, client_address):
        admission = self._acquire_admission(request_socket)
        if admission is None:
            self._close_unadmitted(request_socket)
            return
        thread = threading.Thread(
            target=self._run_admitted_request,
            args=(request_socket, client_address),
            daemon=self.daemon_threads,
            name=f"{self._handler_thread_name_prefix}-{admission}",
        )
        with self._handler_threads_lock:
            self._handler_threads.add(thread)
        try:
            thread.start()
        except BaseException:
            with self._handler_threads_lock:
                self._handler_threads.discard(thread)
            self._release_admission(request_socket)
            raise

    def _run_admitted_request(self, request_socket, client_address):
        try:
            try:
                self.finish_request(request_socket, client_address)
            except Exception:
                self.handle_error(request_socket, client_address)
            finally:
                self.shutdown_request(request_socket)
        finally:
            self._release_admission(request_socket)
            with self._handler_threads_lock:
                self._handler_threads.discard(threading.current_thread())

    @property
    def active_handler_count(self):
        with self._admission_lock:
            return len(self._admissions)

    @property
    def handler_thread_count(self):
        with self._handler_threads_lock:
            return sum(thread.is_alive() for thread in self._handler_threads)

    def join_handler_threads(self, timeout):
        deadline = time.monotonic() + timeout
        while True:
            with self._handler_threads_lock:
                threads = tuple(
                    thread
                    for thread in self._handler_threads
                    if thread is not threading.current_thread() and thread.is_alive()
                )
            if not threads:
                return True
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            for thread in threads:
                thread.join(timeout=max(0, deadline - time.monotonic()))

    def register_client(self, client):
        with self._resource_lock:
            if self._closing.is_set():
                accepted = False
            else:
                self._clients.add(client)
                accepted = True
        if not accepted:
            _safe_close(client)
        return accepted

    def unregister_client(self, client):
        with self._resource_lock:
            self._clients.discard(client)

    def register_channel(self, channel):
        with self._resource_lock:
            if self._closing.is_set():
                accepted = False
            else:
                self._channels.add(channel)
                accepted = True
        if not accepted:
            _safe_close(channel)
        return accepted

    def unregister_channel(self, channel):
        with self._resource_lock:
            self._channels.discard(channel)

    def close_tracked(self):
        with self._resource_lock:
            clients = tuple(self._clients)
            channels = tuple(self._channels)
        for client in clients:
            try:
                client.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            _safe_close(client)
        for channel in channels:
            _safe_close(channel)

    def begin_close(self):
        with self._admission_lock:
            self._closing.set()
        self.close_tracked()

    @property
    def tracked_resource_counts(self):
        with self._resource_lock:
            return len(self._clients), len(self._channels)

class SshConnectProxy:
    """Loopback-only HTTP CONNECT server backed by Paramiko direct-tcpip."""

    def __init__(
        self,
        transport,
        allowlist: Iterable[tuple[str, int]],
        max_connections: int = MAX_PROXY_CONNECTIONS,
    ):
        if max_connections < 1:
            raise ValueError("max_connections must be positive")
        normalized = frozenset((host.lower(), port) for host, port in allowlist)
        if any(port != 443 for _host, port in normalized):
            raise ValueError("proxy allowlist permits port 443 only")
        self._server = _LoopbackThreadingServer(
            transport,
            normalized,
            max_connections,
        )
        self._thread = None
        self._closed = False
        self._shutdown_started = False
        self._lifecycle_lock = threading.Lock()

    @property
    def server_address(self):
        return self._server.server_address

    @property
    def url(self):
        host, port = self.server_address
        return f"http://{host}:{port}"

    @property
    def tracked_resource_counts(self):
        return self._server.tracked_resource_counts

    @property
    def active_handler_count(self):
        return self._server.active_handler_count

    @property
    def handler_thread_count(self):
        return self._server.handler_thread_count

    def start(self):
        with self._lifecycle_lock:
            if self._closed:
                raise RuntimeError("proxy is closed")
            if self._thread is not None:
                return self
            thread = threading.Thread(
                target=self._server.serve_forever,
                kwargs={"poll_interval": 0.05},
                daemon=True,
                name="miniapp-fixed-egress-proxy",
            )
            self._thread = thread
            try:
                thread.start()
            except BaseException:
                is_alive = getattr(thread, "is_alive", lambda: False)
                if not is_alive():
                    self._thread = None
                raise
        return self

    def shutdown_resources(self):
        """Stop admission and close tracked sockets/channels without hiding them."""
        with self._lifecycle_lock:
            if self._shutdown_started:
                return
            self._shutdown_started = True
            self._closed = True
            thread = self._thread
        self._server.begin_close()
        if thread is not None and thread.is_alive():
            self._server.shutdown()
        self._server.server_close()
        if thread is not None:
            thread.join(timeout=PROXY_CLEANUP_TIMEOUT)
        self._server.close_tracked()

    def wait_closed(self, timeout: float = PROXY_CLEANUP_TIMEOUT):
        """Confirm all proxy handlers released their tracked resources."""
        self.shutdown_resources()
        self._server.close_tracked()
        handlers_stopped = self._server.join_handler_threads(timeout=timeout)
        server_stopped = self._thread is None or not self._thread.is_alive()
        fully_released = (
            handlers_stopped
            and server_stopped
            and self.handler_thread_count == 0
            and self.active_handler_count == 0
            and self.tracked_resource_counts == (0, 0)
        )
        if not fully_released:
            raise FixedEgressError(MINIAPP_FIXED_EGRESS_CLEANUP_FAILED)

    def close(self, timeout: float = PROXY_CLEANUP_TIMEOUT):
        self.shutdown_resources()
        self.wait_closed(timeout=timeout)

    def __enter__(self):
        return self.start()

    def __exit__(self, _exc_type, _exc, _traceback):
        self.close()
        return False
