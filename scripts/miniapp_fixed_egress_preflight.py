"""Configuration and offline/network preflight checks for fixed egress."""

from __future__ import annotations

from contextlib import closing
from dataclasses import dataclass
import ipaddress
import json
from pathlib import Path
import socket
import ssl
from typing import Callable, Mapping, Optional
from urllib import request
from urllib.parse import urlsplit

from miniapp_fixed_egress_common import (
    FixedEgressError,
    MINIAPP_FIXED_EGRESS_HEALTH_UNHEALTHY,
    MINIAPP_FIXED_EGRESS_HEALTH_VERSION,
    MINIAPP_FIXED_EGRESS_INVALID_CONFIG,
    MINIAPP_FIXED_EGRESS_LOCAL_PREFLIGHT,
    MINIAPP_FIXED_EGRESS_MISMATCH,
    MINIAPP_FIXED_EGRESS_PROXY_FAILURE,
    PROJECT_ROOT,
)
from miniapp_fixed_egress_proxy import MAX_HEADER_BYTES


HEALTH_TIMEOUT = 5.0
PROBE_TIMEOUT = 8.0
EXPECTED_MINIPROGRAM_CI_VERSION = "2.1.31"
DEFAULT_ECHO_URL = "https://checkip.amazonaws.com/"
DEFAULT_HEALTH_URLS = (
    "https://physicsedu.xyz/cloud-business/api/health",
)


@dataclass(frozen=True)
class FixedEgressConfig:
    fixed_egress_ip: str
    echo_url: str
    allowlist: frozenset[tuple[str, int]]
    health_urls: tuple[str, ...]
    expected_version: str


def read_miniapp_version(root: Path = PROJECT_ROOT) -> str:
    try:
        payload = json.loads((root / "miniapp" / "package.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_LOCAL_PREFLIGHT) from error
    version = payload.get("version")
    if not isinstance(version, str) or not version:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_LOCAL_PREFLIGHT)
    return version


def _validate_https_url(value: str, purpose: str) -> tuple[str, int]:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_INVALID_CONFIG, purpose) from error
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
    ):
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_INVALID_CONFIG, purpose)
    try:
        parsed.hostname.encode("ascii", "strict")
    except UnicodeEncodeError as error:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_INVALID_CONFIG, purpose) from error
    return parsed.hostname.lower(), 443


def config_from_env(
    env: Mapping[str, str],
    expected_version: Optional[str] = None,
) -> FixedEgressConfig:
    raw_ip = (env.get("WECHAT_MINIAPP_FIXED_EGRESS_IP") or "").strip()
    try:
        parsed_ip = ipaddress.ip_address(raw_ip)
    except ValueError as error:
        raise FixedEgressError(
            MINIAPP_FIXED_EGRESS_INVALID_CONFIG,
            "WECHAT_MINIAPP_FIXED_EGRESS_IP",
        ) from error
    if parsed_ip.version != 4 or str(parsed_ip) != raw_ip:
        raise FixedEgressError(
            MINIAPP_FIXED_EGRESS_INVALID_CONFIG,
            "WECHAT_MINIAPP_FIXED_EGRESS_IP",
        )
    echo_url = (
        env.get("WECHAT_MINIAPP_FIXED_EGRESS_ECHO_URL") or DEFAULT_ECHO_URL
    ).strip()
    echo_target = _validate_https_url(echo_url, "fixed-egress echo URL")
    health_urls = (
        env.get("WECHAT_MINIAPP_CLOUD_BUSINESS_HEALTH_URL") or DEFAULT_HEALTH_URLS[0],
    )
    for health_url in health_urls:
        _validate_https_url(health_url, "health URL")
    version = expected_version or read_miniapp_version()
    return FixedEgressConfig(
        fixed_egress_ip=raw_ip,
        echo_url=echo_url,
        allowlist=frozenset({echo_target, ("servicewechat.com", 443)}),
        health_urls=tuple(health_urls),
        expected_version=version,
    )


def build_direct_https_opener():
    """Build a TLS-verifying opener with inherited proxies disabled."""
    context = ssl.create_default_context()
    return request.build_opener(
        request.ProxyHandler({}),
        request.HTTPSHandler(context=context),
    )


def _read_json_response(response_object) -> dict:
    raw = response_object.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError("response is too large")
    payload = json.loads(raw.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("response is not a JSON object")
    return payload


def check_health(
    url: str,
    expected_version: str,
    *,
    timeout: float = HEALTH_TIMEOUT,
    opener=None,
    fetcher: Optional[Callable[[str, float], dict]] = None,
) -> None:
    """Check one public health endpoint directly, without inherited proxies."""
    _validate_https_url(url, "health URL")
    try:
        if fetcher is not None:
            payload = fetcher(url, timeout)
        else:
            direct_opener = opener or build_direct_https_opener()
            health_request = request.Request(
                url,
                headers={"Accept": "application/json"},
                method="GET",
            )
            response_object = direct_opener.open(health_request, timeout=timeout)
            with closing(response_object):
                payload = _read_json_response(response_object)
    except FixedEgressError:
        raise
    except Exception as error:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_HEALTH_UNHEALTHY) from error
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_HEALTH_UNHEALTHY)
    if payload.get("version") != expected_version:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_HEALTH_VERSION)


def _validated_loopback_proxy(proxy_url: str) -> tuple[str, int]:
    try:
        parsed = urlsplit(proxy_url)
        port = parsed.port
    except ValueError as error:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_PROXY_FAILURE) from error
    if (
        parsed.scheme != "http"
        or parsed.hostname != "127.0.0.1"
        or port is None
        or not 1 <= port <= 65535
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_PROXY_FAILURE)
    return parsed.hostname, port


def _extract_observed_ip(raw: bytes) -> str:
    text = raw.decode("utf-8").strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        payload = None
    if isinstance(payload, dict):
        for key in ("ip", "query", "origin"):
            if isinstance(payload.get(key), str):
                return payload[key].strip()
    return text


def _probe_egress(proxy_url: str, echo_url: str, timeout: float) -> str:
    proxy_host, proxy_port = _validated_loopback_proxy(proxy_url)
    context = ssl.create_default_context()
    proxy_opener = request.build_opener(
        request.ProxyHandler({}),
        request.HTTPSHandler(context=context),
    )
    echo_request = request.Request(echo_url, headers={"Accept": "application/json"})
    echo_request.set_proxy(f"{proxy_host}:{proxy_port}", "https")
    response_object = proxy_opener.open(echo_request, timeout=timeout)
    with closing(response_object):
        raw = response_object.read(64 * 1024 + 1)
    if len(raw) > 64 * 1024:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_PROXY_FAILURE)
    return _extract_observed_ip(raw)


def _read_connect_response(sock: socket.socket) -> bytes:
    buffer = bytearray()
    while b"\r\n\r\n" not in buffer:
        chunk = sock.recv(4096)
        if not chunk:
            break
        buffer.extend(chunk)
        if len(buffer) > MAX_HEADER_BYTES:
            raise FixedEgressError(MINIAPP_FIXED_EGRESS_PROXY_FAILURE)
    return bytes(buffer)


def _probe_tls(
    proxy_url: str,
    host: str,
    port: int,
    timeout: float,
) -> bool:
    proxy_address = _validated_loopback_proxy(proxy_url)
    raw_socket = socket.create_connection(proxy_address, timeout=timeout)
    try:
        raw_socket.settimeout(timeout)
        raw_socket.sendall(
            f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n".encode(
                "ascii"
            )
        )
        response_header = _read_connect_response(raw_socket)
        status_line = response_header.split(b"\r\n", 1)[0]
        if not status_line.startswith(b"HTTP/1.1 200 "):
            raise FixedEgressError(MINIAPP_FIXED_EGRESS_PROXY_FAILURE)
        context = ssl.create_default_context()
        tls_socket = context.wrap_socket(raw_socket, server_hostname=host)
        raw_socket = None
        try:
            tls_socket.settimeout(timeout)
            tls_socket.do_handshake()
        finally:
            tls_socket.close()
        return True
    finally:
        if raw_socket is not None:
            raw_socket.close()


def probe_proxy(
    proxy_url: str,
    echo_url: str,
    expected_ip: str,
    *,
    timeout: float = PROBE_TIMEOUT,
    probe: Optional[Callable[..., object]] = None,
) -> None:
    """Prove exact public egress and WeChat TLS through the local proxy."""
    _validated_loopback_proxy(proxy_url)
    _validate_https_url(echo_url, "fixed-egress echo URL")
    try:
        if probe is None:
            observed_ip = _probe_egress(proxy_url, echo_url, timeout)
        else:
            observed_ip = probe(
                "egress",
                proxy_url=proxy_url,
                target_url=echo_url,
                timeout=timeout,
            )
    except FixedEgressError:
        raise
    except Exception as error:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_PROXY_FAILURE) from error
    if not isinstance(observed_ip, str) or observed_ip.strip() != expected_ip:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_MISMATCH)
    try:
        if str(ipaddress.ip_address(observed_ip.strip())) != expected_ip:
            raise ValueError("non-canonical address")
    except ValueError as error:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_MISMATCH) from error
    try:
        if probe is None:
            tls_ok = _probe_tls(proxy_url, "servicewechat.com", 443, timeout)
        else:
            tls_ok = probe(
                "tls",
                proxy_url=proxy_url,
                host="servicewechat.com",
                port=443,
                timeout=timeout,
            )
    except FixedEgressError:
        raise
    except Exception as error:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_PROXY_FAILURE) from error
    if tls_ok is not True:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_PROXY_FAILURE)


def _read_json_file(path: Path) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_LOCAL_PREFLIGHT) from error
    if not isinstance(payload, dict):
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_LOCAL_PREFLIGHT)
    return payload


def _resolve_miniapp_private_key(env: Mapping[str, str], root: Path) -> Path:
    for name in (
        "WECHAT_MINIAPP_PRIVATE_KEY_PATH",
        "MINIAPP_PRIVATE_KEY_PATH",
        "WX_PRIVATE_KEY_PATH",
    ):
        if env.get(name):
            return Path(env[name]).expanduser()
    project_config = _read_json_file(root / "miniapp" / "project.config.json")
    appid = project_config.get("appid")
    if not isinstance(appid, str) or not appid:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_LOCAL_PREFLIGHT)
    return Path.home() / ".ssh" / f"private.{appid}.key"


def verify_local_upload_inputs(
    env: Mapping[str, str],
    *,
    expected_version: str,
    root: Path = PROJECT_ROOT,
) -> None:
    miniapp_package = _read_json_file(root / "miniapp" / "package.json")
    if miniapp_package.get("version") != expected_version:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_LOCAL_PREFLIGHT)
    declared_ci = (miniapp_package.get("devDependencies") or {}).get("miniprogram-ci")
    if declared_ci != EXPECTED_MINIPROGRAM_CI_VERSION:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_LOCAL_PREFLIGHT)
    installed_ci = _read_json_file(
        root / "miniapp" / "node_modules" / "miniprogram-ci" / "package.json"
    )
    if installed_ci.get("version") != EXPECTED_MINIPROGRAM_CI_VERSION:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_LOCAL_PREFLIGHT)
    private_key = _resolve_miniapp_private_key(env, root)
    try:
        valid_key = private_key.resolve(strict=True).is_file()
    except (OSError, RuntimeError):
        valid_key = False
    if not valid_key:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_LOCAL_PREFLIGHT)
