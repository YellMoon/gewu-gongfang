#!/usr/bin/env python3
"""Offline tests for stable, redacted CLI failure output."""

from contextlib import redirect_stderr
import io
import unittest

from miniapp_fixed_egress_common import (
    FixedEgressError,
    FixedEgressCompositeError,
    MINIAPP_FIXED_EGRESS_INVALID_CONFIG,
    MINIAPP_FIXED_EGRESS_INVALID_ARGUMENTS,
    MINIAPP_FIXED_EGRESS_UNEXPECTED,
)
import miniapp_fixed_egress as target


class CliErrorMappingTests(unittest.TestCase):
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
