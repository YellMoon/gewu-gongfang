#!/usr/bin/env python3
"""Offline tests for stable, redacted CLI failure output."""

from contextlib import redirect_stderr, redirect_stdout
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from miniapp_fixed_egress_common import (
    FixedEgressError,
    FixedEgressCompositeError,
    MINIAPP_FIXED_EGRESS_INVALID_CONFIG,
    MINIAPP_FIXED_EGRESS_INVALID_ARGUMENTS,
    MINIAPP_FIXED_EGRESS_UNEXPECTED,
)
import miniapp_fixed_egress as target


class CliErrorMappingTests(unittest.TestCase):
    def test_normal_mode_loads_dotenv_before_environment_snapshot(self):
        captured = {}
        secret_value = "dotenv-only-normal-secret"
        original_loader = target._load_deploy_module
        original_config = target.config_from_env
        original_lifecycle = target.run_lifecycle

        class Deploy:
            connect = object()

        def capture_config(environment):
            captured["config_environment"] = dict(environment)
            return object()

        def capture_lifecycle(_config, **kwargs):
            captured["lifecycle_environment"] = dict(kwargs["env"])

        try:
            target._load_deploy_module = lambda: Deploy()
            target.config_from_env = capture_config
            target.run_lifecycle = capture_lifecycle
            with tempfile.TemporaryDirectory() as temporary_directory:
                dotenv_path = Path(temporary_directory) / ".env.local"
                dotenv_path.write_text(
                    "FIXED_EGRESS_HOST=203.0.113.41\n"
                    f"WECHAT_MINIAPP_PRIVATE_KEY_PATH={secret_value}\n",
                    encoding="utf-8",
                )
                stdout = io.StringIO()
                stderr = io.StringIO()
                with patch.dict(
                    os.environ,
                    {"DOTENV_CONFIG_PATH": str(dotenv_path)},
                    clear=True,
                ), redirect_stdout(stdout), redirect_stderr(stderr):
                    status = target.main([])
        finally:
            target._load_deploy_module = original_loader
            target.config_from_env = original_config
            target.run_lifecycle = original_lifecycle

        self.assertEqual(status, 0)
        self.assertEqual(
            captured["config_environment"]["FIXED_EGRESS_HOST"],
            "203.0.113.41",
        )
        self.assertEqual(
            captured["lifecycle_environment"]["WECHAT_MINIAPP_PRIVATE_KEY_PATH"],
            secret_value,
        )
        self.assertNotIn(secret_value, stdout.getvalue() + stderr.getvalue())

    def test_reconcile_mode_loads_dotenv_without_importing_ssh_module(self):
        captured = {}
        secret_value = "dotenv-only-reconcile-secret"
        original_loader = target._load_deploy_module
        original_config = target.config_from_env
        original_reconciliation = target.run_receipt_reconciliation

        def capture_config(environment):
            captured["config_environment"] = dict(environment)
            return object()

        def capture_reconciliation(_config, **kwargs):
            captured["reconciliation_environment"] = dict(kwargs["env"])

        try:
            target._load_deploy_module = lambda: self.fail(
                "reconciliation must not import the SSH deploy module"
            )
            target.config_from_env = capture_config
            target.run_receipt_reconciliation = capture_reconciliation
            with tempfile.TemporaryDirectory() as temporary_directory:
                dotenv_path = Path(temporary_directory) / ".env.local"
                dotenv_path.write_text(
                    "FIXED_EGRESS_HOST=203.0.113.42\n"
                    f"WECHAT_MINIAPP_PRIVATE_KEY_PATH={secret_value}\n",
                    encoding="utf-8",
                )
                stdout = io.StringIO()
                stderr = io.StringIO()
                with patch.dict(
                    os.environ,
                    {"DOTENV_CONFIG_PATH": str(dotenv_path)},
                    clear=True,
                ), redirect_stdout(stdout), redirect_stderr(stderr):
                    status = target.main(["--reconcile-receipt"])
        finally:
            target._load_deploy_module = original_loader
            target.config_from_env = original_config
            target.run_receipt_reconciliation = original_reconciliation

        self.assertEqual(status, 0)
        self.assertEqual(
            captured["config_environment"]["FIXED_EGRESS_HOST"],
            "203.0.113.42",
        )
        self.assertEqual(
            captured["reconciliation_environment"][
                "WECHAT_MINIAPP_PRIVATE_KEY_PATH"
            ],
            secret_value,
        )
        self.assertNotIn(secret_value, stdout.getvalue() + stderr.getvalue())

    def test_reconcile_mode_uses_only_validator_health_and_finalizer_composition(self):
        captured = {}
        child_calls = []
        original_loader = target._load_deploy_module
        original_config = target.config_from_env
        original_reconciliation = getattr(target, "run_receipt_reconciliation", None)
        original_child = target.run_exact_child

        def reconciliation(_config, **kwargs):
            captured.update(kwargs)

        try:
            target._load_deploy_module = lambda: self.fail(
                "reconciliation must not load the SSH deploy module"
            )
            target.config_from_env = lambda _env: object()
            target.run_receipt_reconciliation = reconciliation
            target.run_exact_child = lambda argv, **kwargs: child_calls.append(
                (list(argv), kwargs)
            )
            status = target.main(["--reconcile-receipt"])
            self.assertEqual(status, 0)
            self.assertTrue(callable(captured.get("receipt_validator")))
            self.assertTrue(callable(captured.get("receipt_finalizer")))
            captured["receipt_validator"]()
            captured["receipt_finalizer"]()
        finally:
            target._load_deploy_module = original_loader
            target.config_from_env = original_config
            if original_reconciliation is None:
                delattr(target, "run_receipt_reconciliation")
            else:
                target.run_receipt_reconciliation = original_reconciliation
            target.run_exact_child = original_child

        self.assertEqual(
            [call[0][1:] for call in child_calls],
            [
                ["scripts/upload-miniapp.js", "--validate-deferred-receipt"],
                ["scripts/upload-miniapp.js", "--finalize-deferred-receipt"],
            ],
        )

    def test_probe_and_reconcile_modes_are_mutually_exclusive(self):
        output = io.StringIO()
        with redirect_stderr(output):
            status = target.main(["--probe-only", "--reconcile-receipt"])
        self.assertEqual(status, 1)
        self.assertEqual(output.getvalue(), MINIAPP_FIXED_EGRESS_INVALID_ARGUMENTS + "\n")

    def test_receipt_finalizer_removes_private_key_environment(self):
        child_calls = []
        target.finalize_deferred_receipt(
            {
                "SAFE_VALUE": "kept",
                "WECHAT_MINIAPP_PRIVATE_KEY_PATH": "C:/sensitive/wechat.key",
                "MINIAPP_PRIVATE_KEY_PATH": "C:/sensitive/miniapp.key",
                "WX_PRIVATE_KEY_PATH": "C:/sensitive/wx.key",
            },
            command_runner=lambda argv, **kwargs: child_calls.append(
                (list(argv), kwargs)
            ),
        )
        self.assertEqual(len(child_calls), 1)
        child_env = child_calls[0][1]["env"]
        self.assertEqual(child_env["SAFE_VALUE"], "kept")
        self.assertNotIn("WECHAT_MINIAPP_PRIVATE_KEY_PATH", child_env)
        self.assertNotIn("MINIAPP_PRIVATE_KEY_PATH", child_env)
        self.assertNotIn("WX_PRIVATE_KEY_PATH", child_env)

    def test_main_supplies_exact_local_node_receipt_finalizer(self):
        captured = {}
        child_calls = []
        original_loader = target._load_deploy_module
        original_config = target.config_from_env
        original_lifecycle = target.run_lifecycle
        original_child = target.run_exact_child

        class Deploy:
            connect = object()

        def lifecycle(_config, **kwargs):
            captured.update(kwargs)

        try:
            target._load_deploy_module = lambda: Deploy()
            target.config_from_env = lambda _env: object()
            target.run_lifecycle = lifecycle
            target.run_exact_child = lambda argv, **kwargs: child_calls.append(
                (list(argv), kwargs)
            )
            status = target.main([])
            self.assertEqual(status, 0)
            self.assertTrue(callable(captured.get("receipt_finalizer")))
            captured["receipt_finalizer"]()
        finally:
            target._load_deploy_module = original_loader
            target.config_from_env = original_config
            target.run_lifecycle = original_lifecycle
            target.run_exact_child = original_child

        self.assertEqual(len(child_calls), 1)
        argv, kwargs = child_calls[0]
        self.assertEqual(
            argv[1:],
            ["scripts/upload-miniapp.js", "--finalize-deferred-receipt"],
        )
        self.assertEqual(Path(kwargs["cwd"]), target.PROJECT_ROOT)
        self.assertIsInstance(kwargs["env"], dict)
        self.assertGreater(kwargs["timeout"], 0)

    def test_invalid_arguments_are_redacted_before_argparse_can_echo_them(self):
        output = io.StringIO()
        with redirect_stderr(output):
            status = target.main(["--secret-token=do-not-print"])
        self.assertEqual(status, 1)
        stderr = output.getvalue()
        self.assertEqual(stderr, MINIAPP_FIXED_EGRESS_INVALID_ARGUMENTS + "\n")
        self.assertNotIn("secret-token", stderr)

    def invoke_with_loader_error(self, error):
        original_loader = target._load_deploy_module

        def fail():
            raise error

        target._load_deploy_module = fail
        output = io.StringIO()
        try:
            with redirect_stderr(output):
                status = target.main([])
        finally:
            target._load_deploy_module = original_loader
        return status, output.getvalue()

    def test_expected_error_prints_only_its_stable_code(self):
        status, stderr = self.invoke_with_loader_error(
            FixedEgressError(
                MINIAPP_FIXED_EGRESS_INVALID_CONFIG,
                "C:/sensitive/private.key",
            )
        )
        self.assertEqual(status, 1)
        self.assertEqual(stderr, MINIAPP_FIXED_EGRESS_INVALID_CONFIG + "\n")

    def test_composite_failure_prints_primary_and_cleanup_codes_only(self):
        status, stderr = self.invoke_with_loader_error(
            FixedEgressCompositeError(
                (
                    "MINIAPP_FIXED_EGRESS_MISMATCH",
                    "MINIAPP_FIXED_EGRESS_CLEANUP_FAILED",
                )
            )
        )
        self.assertEqual(status, 1)
        self.assertEqual(
            stderr,
            "MINIAPP_FIXED_EGRESS_MISMATCH\n"
            "MINIAPP_FIXED_EGRESS_CLEANUP_FAILED\n",
        )

    def test_interrupted_cleanup_failure_keeps_exit_130_and_both_codes(self):
        status, stderr = self.invoke_with_loader_error(
            FixedEgressCompositeError(
                (
                    "MINIAPP_FIXED_EGRESS_INTERRUPTED",
                    "MINIAPP_FIXED_EGRESS_CLEANUP_FAILED",
                ),
                exit_status=130,
            )
        )
        self.assertEqual(status, 130)
        self.assertEqual(
            stderr,
            "MINIAPP_FIXED_EGRESS_INTERRUPTED\n"
            "MINIAPP_FIXED_EGRESS_CLEANUP_FAILED\n",
        )

    def test_unknown_exception_is_redacted_without_traceback(self):
        status, stderr = self.invoke_with_loader_error(
            RuntimeError("secret-token=do-not-print")
        )
        self.assertEqual(status, 1)
        self.assertEqual(stderr, MINIAPP_FIXED_EGRESS_UNEXPECTED + "\n")
        self.assertNotIn("secret-token", stderr)
        self.assertNotIn("Traceback", stderr)

    def test_operational_system_exit_is_redacted(self):
        status, stderr = self.invoke_with_loader_error(
            SystemExit("secret deploy configuration")
        )
        self.assertEqual(status, 1)
        self.assertEqual(stderr, MINIAPP_FIXED_EGRESS_UNEXPECTED + "\n")


if __name__ == "__main__":
    unittest.main(verbosity=2)
