#!/usr/bin/env python3
"""Prepare a verified storage-agent image for the classic-UGOS Docker UI.

Classic UGOS exposes no stable, supported SSH automation interface. This tool
therefore has no remote login, password, key, or NAS API support. It produces
the artifact and a non-secret release card for a repeatable Docker-UI update.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path


class DeployError(RuntimeError):
    pass


VERSION = re.compile(r"\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?")
CONTAINER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}")
IMAGE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_./:@-]{0,255}")
ABSOLUTE_PATH = re.compile(r"/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+")


def fail(code: str) -> DeployError:
    return DeployError(code)


def require_version(value: str) -> str:
    if not VERSION.fullmatch(str(value or "")):
        raise fail("NAS_GUI_RELEASE_INVALID_VERSION")
    return value


def require_container(value: str) -> str:
    if not CONTAINER.fullmatch(str(value or "")):
        raise fail("NAS_GUI_RELEASE_INVALID_CONTAINER")
    return value


def require_image(value: str) -> str:
    if not IMAGE.fullmatch(str(value or "")):
        raise fail("NAS_GUI_RELEASE_INVALID_IMAGE")
    return value


def require_absolute_path(value: str) -> str:
    if not ABSOLUTE_PATH.fullmatch(str(value or "")):
        raise fail("NAS_GUI_RELEASE_INVALID_CONTAINER_PATH")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def artifact_details(path_value: str) -> tuple[Path, str]:
    artifact = Path(path_value).expanduser().resolve()
    if artifact.suffix.lower() != ".tar" or not artifact.is_file() or artifact.stat().st_size < 1:
        raise fail("NAS_GUI_RELEASE_ARTIFACT_REQUIRED")
    return artifact, sha256_file(artifact)


def build_artifact(args: argparse.Namespace) -> dict:
    version = require_version(args.version)
    image = require_image(args.image or f"gewu-storage-agent:{version}")
    artifact = Path(args.artifact).expanduser().resolve()
    if artifact.suffix.lower() != ".tar":
        raise fail("NAS_GUI_RELEASE_ARTIFACT_MUST_BE_TAR")
    project_root = Path(__file__).resolve().parent.parent
    dockerfile = project_root / "storage-agent" / "Dockerfile"
    if not dockerfile.is_file():
        raise fail("NAS_GUI_RELEASE_DOCKERFILE_REQUIRED")
    artifact.parent.mkdir(parents=True, exist_ok=True)
    temporary = artifact.with_suffix(".tmp.tar")
    if temporary.exists():
        temporary.unlink()
    try:
        subprocess.run(
            ["docker", "build", "--pull=false", "-t", image, "-f", str(dockerfile), "."],
            cwd=project_root, check=True,
        )
        subprocess.run(["docker", "save", "--output", str(temporary), image], check=True)
        if not temporary.is_file() or temporary.stat().st_size < 1:
            raise fail("NAS_GUI_RELEASE_ARTIFACT_BUILD_FAILED")
        os.replace(temporary, artifact)
    except FileNotFoundError as error:
        raise fail("NAS_GUI_RELEASE_DOCKER_UNAVAILABLE") from error
    except subprocess.CalledProcessError as error:
        raise fail(f"NAS_GUI_RELEASE_DOCKER_BUILD_FAILED: {error.returncode}") from error
    finally:
        if temporary.exists():
            temporary.unlink()
    return {
        "ok": True,
        "version": version,
        "image": image,
        "artifact": str(artifact),
        "sha256": sha256_file(artifact),
    }


def gui_release_plan(args: argparse.Namespace) -> dict:
    version = require_version(args.version)
    image = require_image(args.image or f"gewu-storage-agent:{version}")
    candidate = require_container(args.container or f"gewu-storage-agent-{version}")
    previous = require_container(args.previous_container)
    mount_target = require_absolute_path(args.mount_target)
    config_path = require_absolute_path(args.config_path)
    artifact, digest = artifact_details(args.artifact)
    return {
        "ok": True,
        "workflow": "classic-ugos-docker-ui",
        "version": version,
        "image": image,
        "artifact": {"path": str(artifact), "sha256": digest},
        "newContainer": candidate,
        "rollbackContainer": previous,
        "dockerUiSteps": [
            "Import artifact.path in the NAS Docker application and confirm the image name.",
            "Open rollbackContainer details and copy its host bind source, network mode, and restart policy.",
            "Create newContainer from image with the same bind source, network mode, and restart policy; mount storage at mountTarget.",
            "Start newContainer and run healthCommand in its Docker terminal. Continue only when ok=true, version matches, and writableAuthority=false.",
            "Only after that health check passes, stop rollbackContainer. Keep it for rollback; do not delete it.",
        ],
        "healthCommand": f"node src/healthCli.js {config_path}",
        "rollback": f"If the new container fails health: stop {candidate}, then start {previous}; do not delete either container.",
        "sensitiveData": "No credentials, keys, or agent.env content is emitted.",
    }


def cli() -> None:
    parser = argparse.ArgumentParser(description="Prepare a storage-agent update for the classic-UGOS Docker UI")
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build-artifact", help="Build and save a verified Docker image tarball locally")
    build.add_argument("--version", required=True)
    build.add_argument("--artifact", required=True)
    build.add_argument("--image")

    plan = sub.add_parser("gui-release-plan", help="Print the concise NAS Docker-UI release card")
    plan.add_argument("--version", required=True)
    plan.add_argument("--artifact", required=True)
    plan.add_argument("--image")
    plan.add_argument("--container")
    plan.add_argument("--previous-container", required=True)
    plan.add_argument("--mount-target", default="/nas-storage")
    plan.add_argument("--config-path", default="/nas-storage/agent.env")

    args = parser.parse_args()
    result = build_artifact(args) if args.command == "build-artifact" else gui_release_plan(args)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    try:
        cli()
    except DeployError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
