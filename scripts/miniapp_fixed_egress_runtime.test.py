#!/usr/bin/env python3
"""Focused offline tests for fixed-egress lifecycle cleanup semantics."""

from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest

from miniapp_fixed_egress_common import (
    FixedEgressError,
    MINIAPP_FIXED_EGRESS_CLEANUP_FAILED,
    MINIAPP_FIXED_EGRESS_LOCK_FAILED,
)
from miniapp_fixed_egress_preflight import FixedEgressConfig
import miniapp_fixed_egress_runtime as target


class RecordingLock:
    def __init__(self, events):
        self.events = events

    def release(self):
        self.events.append("lock-release")


class FakeProcess:
    def __init__(
        self,
        wait_results,
        *,
        terminate_error=None,
        kill_error=None,
        poll_result=None,
    ):
        self.wait_results = list(wait_results)
        self.terminate_error = terminate_error
        self.kill_error = kill_error
        self.poll_result = poll_result
        self.terminated = False
        self.killed = False
        self.wait_timeouts = []
        self.poll_calls = 0

    def wait(self, timeout=None):
        self.wait_timeouts.append(timeout)
        result = self.wait_results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result

    def terminate(self):
        self.terminated = True
        if self.terminate_error:
            raise self.terminate_error

    def kill(self):
        self.killed = True
        if self.kill_error:
            raise self.kill_error

    def poll(self):
        self.poll_calls += 1
        return self.poll_result


class RecordingSsh:
    def __init__(self, events):
        self.events = events

    def get_transport(self):
        return self

    def is_active(self):
        return True

    def close(self):
        self.events.append("ssh-close")


class TwoPhaseProxy:
    url = "http://127.0.0.1:18080"

    def __init__(self, events, wait_error=None):
        self.events = events
        self.wait_error = wait_error

    def start(self):
        self.events.append("proxy-start")

    def shutdown_resources(self):
        self.events.append("proxy-shutdown-resources")

    def wait_closed(self):
        self.events.append("proxy-wait-closed")
        if self.wait_error:
            raise self.wait_error


class LifecycleCleanupTests(unittest.TestCase):
    def config(self):
        return FixedEgressConfig(
            fixed_egress_ip="203.0.113.17",
            echo_url="https://echo.example/ip",
            allowlist=frozenset({("echo.example", 443)}),
            health_urls=("https://health.example/check",),
            expected_miniapp_version="7.2.10",
            expected_cloud_business_version="9.4.3",
        )

    def run_with(self, events, *, wait_error=None, probe_error=None):
        ssh = RecordingSsh(events)
        proxy = TwoPhaseProxy(events, wait_error)

        def prober(*_args):
            events.append("probe")
            if probe_error:
                raise probe_error

        return target.run_lifecycle(
            self.config(),
            probe_only=True,
            env={},
            lock_path=Path("unused.lock"),
            lock_factory=lambda _path: RecordingLock(events),
            health_checker=lambda *_args: events.append("health"),
            ssh_connector=lambda: ssh,
            proxy_factory=lambda *_args: proxy,
            proxy_prober=prober,
        )

    def test_cleanup_closes_proxy_resources_then_ssh_before_waiting_for_handlers(self):
        events = []
        self.run_with(events)
        self.assertEqual(
            events[-4:],
            [
                "proxy-shutdown-resources",
                "ssh-close",
                "proxy-wait-closed",
                "lock-release",
            ],
        )

    def test_probe_only_never_finalizes_a_receipt(self):
        events = []
        ssh = RecordingSsh(events)
        proxy = TwoPhaseProxy(events)
        target.run_lifecycle(
            self.config(),
            probe_only=True,
            env={},
            lock_path=Path("unused.lock"),
            lock_factory=lambda _path: RecordingLock(events),
            health_checker=lambda *_args: events.append("health"),
            ssh_connector=lambda: ssh,
            proxy_factory=lambda *_args: proxy,
            proxy_prober=lambda *_args: events.append("probe"),
            receipt_finalizer=lambda: events.append("receipt"),
        )
        self.assertNotIn("receipt", events)

    def test_cleanup_failure_on_success_returns_stable_error(self):
        events = []
        with self.assertRaises(FixedEgressError) as caught:
            self.run_with(
                events,
                wait_error=RuntimeError("sensitive cleanup implementation detail"),
            )
        self.assertEqual(caught.exception.code, MINIAPP_FIXED_EGRESS_CLEANUP_FAILED)
        self.assertEqual(events[-1], "lock-release")

    def test_cleanup_failure_preserves_unknown_primary_as_cause_and_stable_code(self):
        events = []
        primary = RuntimeError("primary upload failure")
        with self.assertRaises(FixedEgressError) as caught:
            self.run_with(
                events,
                wait_error=RuntimeError("cleanup failed"),
                probe_error=primary,
            )
        self.assertEqual(
            caught.exception.codes,
            (
                "MINIAPP_FIXED_EGRESS_UNEXPECTED",
                "MINIAPP_FIXED_EGRESS_CLEANUP_FAILED",
            ),
        )
        self.assertIs(caught.exception.__cause__, primary)
        self.assertEqual(events[-1], "lock-release")

    def test_primary_and_all_cleanup_failures_are_stably_observable(self):
        events = []
        primary = FixedEgressError(
            "MINIAPP_FIXED_EGRESS_MISMATCH",
            "sensitive primary detail",
        )

        class FailingLock:
            def release(self):
                events.append("lock-release")
                raise OSError("sensitive lock cleanup")

        class FailingSsh(RecordingSsh):
            def close(self):
                events.append("ssh-close")
                raise OSError("sensitive ssh cleanup")

        class FailingProxy(TwoPhaseProxy):
            def shutdown_resources(self):
                events.append("proxy-shutdown-resources")
                raise OSError("sensitive proxy shutdown")

            def wait_closed(self):
                events.append("proxy-wait-closed")
                raise OSError("sensitive handler cleanup")

        ssh = FailingSsh(events)
        proxy = FailingProxy(events)
        with self.assertRaises(FixedEgressError) as caught:
            target.run_lifecycle(
                self.config(),
                probe_only=True,
                env={},
                lock_path=Path("unused.lock"),
                lock_factory=lambda _path: FailingLock(),
                health_checker=lambda *_args: None,
                ssh_connector=lambda: ssh,
                proxy_factory=lambda *_args: proxy,
                proxy_prober=lambda *_args: (_ for _ in ()).throw(primary),
            )
        self.assertEqual(
            caught.exception.codes,
            (
                "MINIAPP_FIXED_EGRESS_MISMATCH",
                "MINIAPP_FIXED_EGRESS_CLEANUP_FAILED",
            ),
        )
        self.assertIs(caught.exception.__cause__, primary)
        self.assertEqual(
            events[-4:],
            [
                "proxy-shutdown-resources",
                "ssh-close",
                "proxy-wait-closed",
                "lock-release",
            ],
        )
        self.assertNotIn("sensitive", str(caught.exception))


class UploadLockFailureTests(unittest.TestCase):
    def test_post_acquisition_owner_write_failure_releases_the_os_lock(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            lock_path = Path(temp_dir) / "upload.lock"
            original_writer = target._write_lock_owner

            def fail_owner_write(_file_object, _pid):
                raise OSError("simulated disk failure")

            target._write_lock_owner = fail_owner_write
            try:
                with self.assertRaises(FixedEgressError) as caught:
                    target.acquire_upload_lock(lock_path)
            finally:
                target._write_lock_owner = original_writer
            self.assertEqual(caught.exception.code, MINIAPP_FIXED_EGRESS_LOCK_FAILED)
            reacquired = target.acquire_upload_lock(lock_path)
            reacquired.release()


class LockAndExactChildTests(unittest.TestCase):
    def test_lock_holds_descriptor_and_conflicts_with_another_process(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            lock_path = Path(temp_dir) / "cross-process.lock"
            lock = target.acquire_upload_lock(lock_path)
            holder_code = (
                "import pathlib,sys;"
                "sys.path.insert(0,sys.argv[1]);"
                "import miniapp_fixed_egress_runtime as target;"
                "p=pathlib.Path(sys.argv[2]);"
                "\ntry: target.acquire_upload_lock(p)"
                "\nexcept target.FixedEgressError as e: print(e.code); sys.exit(7)"
                "\nsys.exit(0)"
            )
            try:
                result = subprocess.run(
                    [
                        sys.executable,
                        "-c",
                        holder_code,
                        str(Path(__file__).resolve().parent),
                        str(lock_path),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=5,
                    check=False,
                )
                self.assertEqual(result.returncode, 7)
                self.assertIn("MINIAPP_FIXED_EGRESS_ALREADY_RUNNING", result.stdout)
            finally:
                lock.release()
            reacquired = target.acquire_upload_lock(lock_path)
            reacquired.release()

    def test_child_env_forces_loopback_proxy_and_removes_bypass(self):
        environment = target.build_child_env(
            {
                "HTTP_PROXY": "http://wrong",
                "https_proxy": "http://wrong",
                "NO_PROXY": "*",
                "no_proxy": "localhost",
            },
            "http://127.0.0.1:18080",
        )
        for name in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
            self.assertEqual(environment[name], "http://127.0.0.1:18080")
        self.assertNotIn("NO_PROXY", environment)
        self.assertNotIn("no_proxy", environment)

    def test_timeout_terminates_then_kills_only_the_exact_child(self):
        process = FakeProcess(
            [
                subprocess.TimeoutExpired(["node"], 5),
                subprocess.TimeoutExpired(["node"], 1),
                -9,
            ]
        )
        with self.assertRaises(subprocess.TimeoutExpired):
            target.run_exact_child(
                ["node", "safe-script.js"],
                cwd=Path.cwd(),
                env={},
                timeout=5,
                cleanup_timeout=1,
                popen_factory=lambda _argv, **_kwargs: process,
            )
        self.assertTrue(process.terminated)
        self.assertTrue(process.killed)

    def test_three_failed_cleanup_waits_and_signal_errors_are_not_swallowed(self):
        original_timeout = subprocess.TimeoutExpired(["node"], 5)
        process = FakeProcess(
            [
                original_timeout,
                subprocess.TimeoutExpired(["node"], 1),
                subprocess.TimeoutExpired(["node"], 1),
                subprocess.TimeoutExpired(["node"], 1),
            ],
            terminate_error=OSError("sensitive terminate failure"),
            kill_error=OSError("sensitive kill failure"),
            poll_result=None,
        )
        with self.assertRaises(FixedEgressError) as caught:
            target.run_exact_child(
                ["node", "safe-script.js"],
                cwd=Path.cwd(),
                env={},
                timeout=5,
                cleanup_timeout=1,
                popen_factory=lambda _argv, **_kwargs: process,
            )
        self.assertEqual(
            caught.exception.codes,
            (
                "MINIAPP_FIXED_EGRESS_CHILD_TIMEOUT",
                "MINIAPP_FIXED_EGRESS_CLEANUP_FAILED",
            ),
        )
        self.assertIs(caught.exception.__cause__, original_timeout)
        self.assertEqual(len(process.wait_timeouts), 4)
        self.assertGreaterEqual(process.poll_calls, 1)
        self.assertNotIn("sensitive", str(caught.exception))

    def test_interrupt_cleanup_failure_keeps_interrupt_and_cleanup_codes(self):
        original_interrupt = KeyboardInterrupt()
        process = FakeProcess(
            [
                original_interrupt,
                subprocess.TimeoutExpired(["node"], 1),
                subprocess.TimeoutExpired(["node"], 1),
                subprocess.TimeoutExpired(["node"], 1),
            ],
            terminate_error=OSError("terminate failed"),
            kill_error=OSError("kill failed"),
            poll_result=None,
        )
        with self.assertRaises(FixedEgressError) as caught:
            target.run_exact_child(
                ["node", "safe-script.js"],
                cwd=Path.cwd(),
                env={},
                timeout=5,
                cleanup_timeout=1,
                popen_factory=lambda _argv, **_kwargs: process,
            )
        self.assertEqual(
            caught.exception.codes,
            (
                "MINIAPP_FIXED_EGRESS_INTERRUPTED",
                "MINIAPP_FIXED_EGRESS_CLEANUP_FAILED",
            ),
        )
        self.assertEqual(caught.exception.exit_status, 130)
        self.assertIs(caught.exception.__cause__, original_interrupt)

    def test_nonzero_child_exit_is_reported_without_broad_cleanup(self):
        process = FakeProcess([7])
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            target.run_exact_child(
                ["node", "safe-script.js"],
                cwd=Path.cwd(),
                env={},
                timeout=5,
                popen_factory=lambda _argv, **_kwargs: process,
            )
        self.assertEqual(caught.exception.returncode, 7)
        self.assertFalse(process.terminated)
        self.assertFalse(process.killed)

    def test_keyboard_interrupt_cleans_exact_child_without_hiding_interrupt(self):
        process = FakeProcess([KeyboardInterrupt(), 0])
        with self.assertRaises(KeyboardInterrupt):
            target.run_exact_child(
                ["node", "safe-script.js"],
                cwd=Path.cwd(),
                env={},
                timeout=5,
                popen_factory=lambda _argv, **_kwargs: process,
            )
        self.assertTrue(process.terminated)
        self.assertFalse(process.killed)


class FullLifecycleUnitTests(unittest.TestCase):
    def test_build_upload_post_health_receipt_and_cleanup_order(self):
        events = []
        config = FixedEgressConfig(
            fixed_egress_ip="203.0.113.17",
            echo_url="https://echo.example/ip",
            allowlist=frozenset({("echo.example", 443)}),
            health_urls=("https://health.example/check",),
            expected_miniapp_version="7.2.10",
            expected_cloud_business_version="9.4.3",
        )
        ssh = RecordingSsh(events)
        proxy = TwoPhaseProxy(events)
        health_versions = []

        def command_runner(argv, **_kwargs):
            if "miniapp:release-check" in argv:
                events.append("build")
                return
            events.append("upload")
            self.assertIn("--upload-mode=miniprogram-ci", argv)
            self.assertIn("--proxy=http://127.0.0.1:18080", argv)
            self.assertIn("--threads=1", argv)
            self.assertIn("--defer-receipt", argv)

        target.run_lifecycle(
            config,
            probe_only=False,
            env={},
            lock_path=Path("unused.lock"),
            lock_factory=lambda _path: RecordingLock(events),
            health_checker=lambda _url, version: (
                events.append("health"), health_versions.append(version)
            ),
            local_preflight=lambda _env: events.append("local-preflight"),
            ssh_connector=lambda: ssh,
            proxy_factory=lambda *_args: proxy,
            proxy_prober=lambda *_args: events.append("probe"),
            command_runner=command_runner,
            receipt_finalizer=lambda: events.append("receipt"),
        )
        self.assertLess(events.index("build"), events.index("proxy-start"))
        self.assertLess(events.index("probe"), events.index("upload"))
        self.assertLess(events.index("upload"), events.index("receipt"))
        self.assertEqual(health_versions, ["9.4.3", "9.4.3"])
        self.assertEqual(
            events[-4:],
            [
                "proxy-shutdown-resources",
                "ssh-close",
                "proxy-wait-closed",
                "lock-release",
            ],
        )


class ReceiptReconciliationTests(unittest.TestCase):
    def config(self):
        return FixedEgressConfig(
            fixed_egress_ip="203.0.113.17",
            echo_url="https://echo.example/ip",
            allowlist=frozenset({("echo.example", 443)}),
            health_urls=(
                "https://health.example/backend",
                "https://health.example/gateway",
            ),
            expected_miniapp_version="7.2.10",
            expected_cloud_business_version="9.4.3",
        )

    def test_reconciliation_holds_lock_validates_then_checks_dual_health_and_finalizes(self):
        events = []

        def lock_factory(_path):
            events.append("lock")
            return RecordingLock(events)

        target.run_receipt_reconciliation(
            self.config(),
            env={},
            lock_path=Path("unused.lock"),
            lock_factory=lock_factory,
            health_checker=lambda url, _version: events.append(f"health:{url}"),
            receipt_validator=lambda: events.append("validate"),
            receipt_finalizer=lambda: events.append("finalize"),
        )
        self.assertEqual(
            events,
            [
                "lock",
                "validate",
                "health:https://health.example/backend",
                "health:https://health.example/gateway",
                "finalize",
                "lock-release",
            ],
        )

    def test_reconciliation_validation_or_health_failure_never_finalizes(self):
        for failure_stage in ("validate", "health"):
            events = []

            def validate():
                events.append("validate")
                if failure_stage == "validate":
                    raise RuntimeError("invalid marker")

            def health(*_args):
                events.append("health")
                if failure_stage == "health":
                    raise RuntimeError("production unhealthy")

            with self.subTest(failure_stage=failure_stage):
                with self.assertRaises(RuntimeError):
                    target.run_receipt_reconciliation(
                        self.config(),
                        env={},
                        lock_path=Path("unused.lock"),
                        lock_factory=lambda _path: RecordingLock(events),
                        health_checker=health,
                        receipt_validator=validate,
                        receipt_finalizer=lambda: events.append("finalize"),
                    )
                self.assertNotIn("finalize", events)
                self.assertEqual(events[-1], "lock-release")

    def test_reconciliation_rejects_concurrent_use_of_the_upload_lock(self):
        events = []
        with tempfile.TemporaryDirectory() as temp_dir:
            lock_path = Path(temp_dir) / "fixed-egress.lock"
            held_lock = target.acquire_upload_lock(lock_path)
            try:
                with self.assertRaises(FixedEgressError):
                    target.run_receipt_reconciliation(
                        self.config(),
                        env={},
                        lock_path=lock_path,
                        health_checker=lambda *_args: events.append("health"),
                        receipt_validator=lambda: events.append("validate"),
                        receipt_finalizer=lambda: events.append("finalize"),
                    )
            finally:
                held_lock.release()
        self.assertEqual(events, [])

    def test_post_health_failure_skips_receipt_and_still_cleans_up(self):
        events = []
        config = FixedEgressConfig(
            fixed_egress_ip="203.0.113.17",
            echo_url="https://echo.example/ip",
            allowlist=frozenset({("echo.example", 443)}),
            health_urls=("https://health.example/check",),
            expected_miniapp_version="7.2.10",
            expected_cloud_business_version="9.4.3",
        )
        ssh = RecordingSsh(events)
        proxy = TwoPhaseProxy(events)
        health_calls = 0

        def health(*_args):
            nonlocal health_calls
            health_calls += 1
            events.append("health")
            if health_calls == 2:
                raise FixedEgressError("MINIAPP_FIXED_EGRESS_HEALTH_UNHEALTHY")

        with self.assertRaises(FixedEgressError):
            target.run_lifecycle(
                config,
                probe_only=False,
                env={},
                lock_path=Path("unused.lock"),
                lock_factory=lambda _path: RecordingLock(events),
                health_checker=health,
                local_preflight=lambda _env: None,
                ssh_connector=lambda: ssh,
                proxy_factory=lambda *_args: proxy,
                proxy_prober=lambda *_args: None,
                command_runner=lambda *_args, **_kwargs: events.append("command"),
                receipt_finalizer=lambda: events.append("receipt"),
            )
        self.assertNotIn("receipt", events)
        self.assertEqual(
            events[-4:],
            [
                "proxy-shutdown-resources",
                "ssh-close",
                "proxy-wait-closed",
                "lock-release",
            ],
        )

if __name__ == "__main__":
    unittest.main(verbosity=2)
