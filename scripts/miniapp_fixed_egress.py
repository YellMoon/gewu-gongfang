#!/usr/bin/env python3
"""Thin CLI composition root for local miniapp CI through fixed SSH egress."""

from __future__ import annotations

import argparse
import importlib
import os
from pathlib import Path
import subprocess
import sys
from typing import Optional

from miniapp_fixed_egress_common import (
    FixedEgressError,
    MINIAPP_FIXED_EGRESS_CHILD_FAILED,
    MINIAPP_FIXED_EGRESS_CHILD_TIMEOUT,
    MINIAPP_FIXED_EGRESS_INVALID_ARGUMENTS,
    MINIAPP_FIXED_EGRESS_INTERRUPTED,
    MINIAPP_FIXED_EGRESS_INVALID_CONFIG,
    MINIAPP_FIXED_EGRESS_UNEXPECTED,
    PROJECT_ROOT,
)
from miniapp_fixed_egress_preflight import config_from_env
from miniapp_fixed_egress_runtime import (
    UPLOAD_TIMEOUT,
    node_executable,
    run_exact_child,
    run_lifecycle,
    run_receipt_reconciliation,
)


class _StableArgumentParser(argparse.ArgumentParser):
    def error(self, _message):
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_INVALID_ARGUMENTS)


def _load_deploy_module():
    scripts_dir = str(PROJECT_ROOT / "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    return importlib.import_module("deploy")


def _load_protected_dotenv(
    environment=None,
    *,
    root_dir=PROJECT_ROOT,
    dotenv_loader=None,
) -> None:
    """Load local configuration without importing the SSH deployment module."""
    source_environment = environment if environment is not None else os.environ
    configured_path = source_environment.get("DOTENV_CONFIG_PATH")
    dotenv_path = Path(configured_path) if configured_path else root_dir / ".env.local"
    if not dotenv_path.exists():
        return
    try:
        loader = dotenv_loader
        if loader is None:
            from dotenv import load_dotenv

            loader = load_dotenv
        loader(dotenv_path=dotenv_path, override=False)
    except Exception as error:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_INVALID_CONFIG) from error


def _run_deferred_receipt_operation(
    environment,
    operation,
    *,
    root_dir=PROJECT_ROOT,
    command_runner=None,
) -> None:
    runner = command_runner or run_exact_child
    child_environment = dict(environment)
    for variable_name in (
        "WECHAT_MINIAPP_PRIVATE_KEY_PATH",
        "MINIAPP_PRIVATE_KEY_PATH",
        "WX_PRIVATE_KEY_PATH",
    ):
        child_environment.pop(variable_name, None)
    child_environment["GEWU_MINIAPP_INTERNAL_RECEIPT_OPERATION"] = "1"
    runner(
        [
            node_executable(),
            "scripts/upload-miniapp.js",
            operation,
        ],
        cwd=root_dir,
        env=child_environment,
        timeout=UPLOAD_TIMEOUT,
    )


def validate_deferred_receipt(
    environment,
    *,
    root_dir=PROJECT_ROOT,
    command_runner=None,
) -> None:
    """Read and validate the pending receipt context without mutating it."""
    _run_deferred_receipt_operation(
        environment,
        "--validate-deferred-receipt",
        root_dir=root_dir,
        command_runner=command_runner,
    )


def finalize_deferred_receipt(
    environment,
    *,
    root_dir=PROJECT_ROOT,
    command_runner=None,
) -> None:
    """Finalize the one-shot local marker without loading upload credentials."""
    _run_deferred_receipt_operation(
        environment,
        "--finalize-deferred-receipt",
        root_dir=root_dir,
        command_runner=command_runner,
    )


def main(argv: Optional[list[str]] = None) -> int:
    parser = _StableArgumentParser(
        description="Local miniapp CI through the existing fixed SSH egress",
    )
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--probe-only", action="store_true")
    modes.add_argument("--reconcile-receipt", action="store_true")
    try:
        options = parser.parse_args(argv)
    except FixedEgressError as error:
        print(error.code, file=sys.stderr)
        return 1
    try:
        _load_protected_dotenv()
        environment = dict(os.environ)
        if options.reconcile_receipt:
            config = config_from_env(environment)
            run_receipt_reconciliation(
                config,
                env=environment,
                receipt_validator=lambda: validate_deferred_receipt(environment),
                receipt_finalizer=lambda: finalize_deferred_receipt(environment),
            )
        else:
            deploy = _load_deploy_module()
            config = config_from_env(environment)
            run_lifecycle(
                config,
                probe_only=options.probe_only,
                env=environment,
                ssh_connector=deploy.connect,
                receipt_finalizer=lambda: finalize_deferred_receipt(environment),
            )
    except KeyboardInterrupt:
        print(MINIAPP_FIXED_EGRESS_INTERRUPTED, file=sys.stderr)
        return 130
    except FixedEgressError as error:
        for code in error.codes:
            print(code, file=sys.stderr)
        return error.exit_status
    except subprocess.TimeoutExpired:
        print(MINIAPP_FIXED_EGRESS_CHILD_TIMEOUT, file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as error:
        print(
            f"{MINIAPP_FIXED_EGRESS_CHILD_FAILED}:{error.returncode}",
            file=sys.stderr,
        )
        return 1
    except BaseException:
        print(MINIAPP_FIXED_EGRESS_UNEXPECTED, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
