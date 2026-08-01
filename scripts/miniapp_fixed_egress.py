#!/usr/bin/env python3
"""Thin CLI composition root for local miniapp CI through fixed SSH egress."""

from __future__ import annotations

import argparse
import importlib
import os
import subprocess
import sys
from typing import Optional

from miniapp_fixed_egress_common import (
    FixedEgressError,
    MINIAPP_FIXED_EGRESS_CHILD_FAILED,
    MINIAPP_FIXED_EGRESS_CHILD_TIMEOUT,
    MINIAPP_FIXED_EGRESS_INVALID_ARGUMENTS,
    MINIAPP_FIXED_EGRESS_INTERRUPTED,
    MINIAPP_FIXED_EGRESS_UNEXPECTED,
    PROJECT_ROOT,
)
from miniapp_fixed_egress_preflight import config_from_env
from miniapp_fixed_egress_runtime import run_lifecycle


class _StableArgumentParser(argparse.ArgumentParser):
    def error(self, _message):
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_INVALID_ARGUMENTS)


def _load_deploy_module():
    scripts_dir = str(PROJECT_ROOT / "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    return importlib.import_module("deploy")


def main(argv: Optional[list[str]] = None) -> int:
    parser = _StableArgumentParser(
        description="Local miniapp CI through the existing fixed SSH egress",
    )
    parser.add_argument("--probe-only", action="store_true")
    try:
        options = parser.parse_args(argv)
    except FixedEgressError as error:
        print(error.code, file=sys.stderr)
        return 1
    try:
        deploy = _load_deploy_module()
        environment = dict(os.environ)
        config = config_from_env(environment)
        run_lifecycle(
            config,
            probe_only=options.probe_only,
            env=environment,
            ssh_connector=deploy.connect,
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
