#!/usr/bin/env python3
"""Unified offline suite runner for every fixed-egress Python test module."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


TEST_FILES = (
    "miniapp_fixed_egress_integration.test.py",
    "miniapp_fixed_egress_proxy.test.py",
    "miniapp_fixed_egress_preflight.test.py",
    "miniapp_fixed_egress_runtime.test.py",
    "miniapp_fixed_egress_cli.test.py",
)


def _load_test_module(path: Path, index: int):
    module_name = f"miniapp_fixed_egress_suite_{index}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("MINIAPP_FIXED_EGRESS_TEST_LOAD_FAILED")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def build_suite(loader=None):
    test_loader = loader or unittest.defaultTestLoader
    scripts_dir = Path(__file__).resolve().parent
    suite = unittest.TestSuite()
    for index, filename in enumerate(TEST_FILES):
        module = _load_test_module(scripts_dir / filename, index)
        suite.addTests(test_loader.loadTestsFromModule(module))
    return suite


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(build_suite())
    raise SystemExit(0 if result.wasSuccessful() else 1)
