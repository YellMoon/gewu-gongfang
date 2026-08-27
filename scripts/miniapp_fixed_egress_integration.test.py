#!/usr/bin/env python3
"""Small cross-module integration tests for the fixed-egress orchestrator."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import unittest
from urllib.parse import urlsplit

import miniapp_fixed_egress as cli_target
from miniapp_fixed_egress_preflight import FixedEgressConfig
from miniapp_fixed_egress_runtime import (
    acquire_upload_lock,
    run_lifecycle,
    run_receipt_reconciliation,
)


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


class OfflineProxy:
    url = "http://127.0.0.1:18080"

    def start(self):
        return None

    def close(self):
        return None


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fixture_manifest_path(root):
    matrix_id = "desktop-7.2.10__cloud-business-7.2.10__storage-proxy-7.2.10__miniapp-7.2.10"
    return root / "output" / f"release-matrix-{matrix_id}" / "active.json"


def prepare_node_release_fixture(root):
    scripts_dir = root / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    source_scripts = Path(__file__).resolve().parent
    shutil.copy2(source_scripts / "upload-miniapp.js", scripts_dir / "upload-miniapp.js")
    shutil.copy2(source_scripts / "release-matrix.js", scripts_dir / "release-matrix.js")
    for relative_path in (
        Path("package.json"),
        Path("cloud-business-api/package.json"),
        Path("storage-agent/package.json"),
        Path("miniapp/package.json"),
    ):
        write_json(root / relative_path, {"version": "7.2.10"})
    write_json(root / "miniapp/project.config.json", {"appid": "wx-offline-test"})
    ci_dir = root / "miniapp/node_modules/miniprogram-ci"
    write_json(
        ci_dir / "package.json",
        {"name": "miniprogram-ci", "version": "2.1.31", "main": "index.js"},
    )
    (ci_dir / "index.js").write_text(
        "const fs = require('fs');\n"
        "const path = require('path');\n"
        "class Project { constructor(options) { this.options = options; } }\n"
        "function proxy() {}\n"
        "async function upload({ project }) {\n"
        "  const counter = path.join(project.options.projectPath, 'upload-count.txt');\n"
        "  const current = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;\n"
        "  fs.writeFileSync(counter, String(current + 1), 'utf8');\n"
        "  return { success: true };\n"
        "}\n"
        "module.exports = { Project, proxy, upload };\n",
        encoding="utf-8",
    )
    compatibility = json.loads((source_scripts.parent / "config/release-compatibility.json").read_text(encoding="utf-8"))
    component_versions = {
        "desktop": "7.2.10",
        "cloud_business": "7.2.10",
        "storage_proxy": "7.2.10",
        "miniapp": "7.2.10",
    }
    manifest = {
        "schema": "gewu.release-compatibility.v2",
        "version": "7.2.10",
        "componentVersions": component_versions,
        "compatibility": compatibility,
        "commit": "离线集成提交",
        "createdAt": "2026-08-01T00:00:00.000Z",
        "targets": {
            target: {"status": "pending"}
            for target in ("desktop", "cloud_business", "storage_proxy", "miniapp")
        },
    }
    write_json(root / "config/release-compatibility.json", compatibility)
    manifest_path = fixture_manifest_path(root)
    write_json(manifest_path, manifest)
    private_key_path = root / "private.wx-offline-test.key"
    private_key_path.write_text("offline-only-key", encoding="utf-8")
    return manifest_path, manifest_path.parent / "miniapp-upload-pending.json", private_key_path


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

    def run_offline_deferred_upload(self, root, *, fail_post_health):
        manifest_path, marker_path, private_key_path = prepare_node_release_fixture(root)
        environment = dict(os.environ)
        environment["WECHAT_MINIAPP_PRIVATE_KEY_PATH"] = str(private_key_path)
        config = FixedEgressConfig(
            fixed_egress_ip="203.0.113.17",
            echo_url="https://echo.example/ip",
            allowlist=frozenset({("servicewechat.com", 443)}),
            health_urls=("https://health.example/check",),
            expected_version="7.2.10",
        )
        health_calls = 0

        def health(*_args):
            nonlocal health_calls
            health_calls += 1
            if fail_post_health and health_calls == 2:
                raise RuntimeError("offline post-health failure")

        def exact_fixture_child(argv, **kwargs):
            if "miniapp:release-check" in argv:
                return
            exact_argv = [argv[0], str(root / "scripts/upload-miniapp.js"), *argv[2:]]
            subprocess.run(
                exact_argv,
                cwd=root,
                env=kwargs["env"],
                check=True,
                timeout=kwargs["timeout"],
                shell=False,
            )

        run_lifecycle(
            config,
            probe_only=False,
            env=environment,
            lock_path=root / "output/locks/integration.lock",
            health_checker=health,
            local_preflight=lambda _env: None,
            ssh_connector=lambda: IntegrationSsh(IntegrationTransport(), []),
            proxy_factory=lambda *_args: OfflineProxy(),
            proxy_prober=lambda *_args: None,
            command_runner=exact_fixture_child,
            receipt_finalizer=lambda: cli_target.finalize_deferred_receipt(
                environment,
                root_dir=root,
            ),
        )
        return manifest_path, marker_path, environment

    def test_cross_process_post_health_failure_preserves_pending_manifest_and_marker(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            with self.assertRaisesRegex(RuntimeError, "offline post-health failure"):
                self.run_offline_deferred_upload(root, fail_post_health=True)
            manifest_path = fixture_manifest_path(root)
            marker_path = manifest_path.parent / "miniapp-upload-pending.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["targets"]["miniapp"]["status"], "pending")
            self.assertTrue(marker_path.exists())
            upload_counter = root / "miniapp/upload-count.txt"
            self.assertEqual(upload_counter.read_text(encoding="utf-8"), "1")

            environment = dict(os.environ)
            environment["WECHAT_MINIAPP_PRIVATE_KEY_PATH"] = str(
                root / "private.wx-offline-test.key"
            )
            health_events = []
            recovery_config = FixedEgressConfig(
                fixed_egress_ip="203.0.113.17",
                echo_url="https://echo.example/ip",
                allowlist=frozenset({("servicewechat.com", 443)}),
                health_urls=(
                    "https://health.example/backend",
                    "https://health.example/gateway",
                ),
                expected_version="7.2.10",
            )
            run_receipt_reconciliation(
                recovery_config,
                env=environment,
                lock_path=root / "output/locks/integration.lock",
                health_checker=lambda url, _version: health_events.append(url),
                receipt_validator=lambda: cli_target.validate_deferred_receipt(
                    environment,
                    root_dir=root,
                ),
                receipt_finalizer=lambda: cli_target.finalize_deferred_receipt(
                    environment,
                    root_dir=root,
                ),
            )
            recovered = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(recovered["targets"]["miniapp"]["status"], "verified")
            self.assertFalse(marker_path.exists())
            self.assertEqual(
                health_events,
                ["https://health.example/backend", "https://health.example/gateway"],
            )
            self.assertEqual(upload_counter.read_text(encoding="utf-8"), "1")

    def test_reconciliation_missing_or_bad_marker_fails_before_health_without_upload(self):
        for marker_content in (None, "{not-json"):
            with self.subTest(marker_content=marker_content):
                with tempfile.TemporaryDirectory() as temp_dir:
                    root = Path(temp_dir)
                    _manifest_path, marker_path, private_key_path = prepare_node_release_fixture(root)
                    if marker_content is not None:
                        marker_path.parent.mkdir(parents=True, exist_ok=True)
                        marker_path.write_text(marker_content, encoding="utf-8")
                    environment = dict(os.environ)
                    environment["WECHAT_MINIAPP_PRIVATE_KEY_PATH"] = str(private_key_path)
                    health_events = []
                    config = FixedEgressConfig(
                        fixed_egress_ip="203.0.113.17",
                        echo_url="https://echo.example/ip",
                        allowlist=frozenset({("servicewechat.com", 443)}),
                        health_urls=(
                            "https://health.example/backend",
                            "https://health.example/gateway",
                        ),
                        expected_version="7.2.10",
                    )
                    with self.assertRaises(subprocess.CalledProcessError):
                        run_receipt_reconciliation(
                            config,
                            env=environment,
                            lock_path=root / "output/locks/integration.lock",
                            health_checker=lambda url, _version: health_events.append(url),
                            receipt_validator=lambda: cli_target.validate_deferred_receipt(
                                environment,
                                root_dir=root,
                            ),
                            receipt_finalizer=lambda: cli_target.finalize_deferred_receipt(
                                environment,
                                root_dir=root,
                            ),
                        )
                    self.assertEqual(health_events, [])
                    self.assertFalse((root / "miniapp/upload-count.txt").exists())

    def test_cross_process_post_health_success_finalizes_once_and_deletes_marker(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path, marker_path, environment = self.run_offline_deferred_upload(
                root,
                fail_post_health=False,
            )
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["targets"]["miniapp"]["status"], "verified")
            self.assertEqual(
                manifest["targets"]["miniapp"]["receipt"]["version"],
                "7.2.10",
            )
            self.assertEqual(manifest["commit"], "离线集成提交")
            self.assertFalse(marker_path.exists())
            manifest_after_finalize = manifest_path.read_bytes()
            with self.assertRaises(subprocess.CalledProcessError):
                cli_target.finalize_deferred_receipt(environment, root_dir=root)
            self.assertEqual(manifest_path.read_bytes(), manifest_after_finalize)


if __name__ == "__main__":
    unittest.main(verbosity=2)
