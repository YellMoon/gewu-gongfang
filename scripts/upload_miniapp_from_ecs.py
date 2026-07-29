#!/usr/bin/env python3
"""Upload the production miniapp through the fixed Alibaba Cloud egress.

The WeChat CI private key is copied to a newly-created 0700 remote directory
only for this upload.  The directory is removed in ``finally`` on both success
and failure; neither the key nor its contents are written to output files.
"""

import argparse
import json
import os
import posixpath
import re
import shlex
import sys
import tarfile
import tempfile
import uuid
from datetime import date
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import deploy  # noqa: E402


REMOTE_CACHE_BASE = "/root/.cache/gewu-miniapp-ci"
REMOTE_RELEASE_PREFIX = "release-"
EXCLUDED_PATH_PARTS = frozenset({"node_modules", "dist", ".git", "__pycache__"})


def build_remote_layout(run_name):
    name = str(run_name or "")
    if not re.fullmatch(r"release-[A-Za-z0-9-]{8,100}", name):
        raise ValueError("ECS_UPLOAD_RUN_NAME_INVALID")
    root = posixpath.join(REMOTE_CACHE_BASE, name)
    return {
        "root": root,
        "key": posixpath.join(root, ".private-key"),
        "archive": posixpath.join(root, "source.tar.gz"),
        "log": posixpath.join(root, "upload.log"),
        "pid": posixpath.join(root, "upload.pid"),
    }


def safe_cleanup_command(remote_root):
    normalized = posixpath.normpath(str(remote_root or ""))
    parent, leaf = posixpath.dirname(normalized), posixpath.basename(normalized)
    if parent != REMOTE_CACHE_BASE or not re.fullmatch(r"release-[A-Za-z0-9-]{8,100}", leaf):
        raise ValueError("ECS_UPLOAD_CLEANUP_PATH_INVALID")
    return f"rm -rf -- {shlex.quote(normalized)}"


def is_uploadable_relative_path(relative_path):
    normalized = str(relative_path or "").replace("\\", "/").strip("/")
    if not normalized or normalized.startswith("../"):
        return False
    parts = normalized.split("/")
    if any(part in EXCLUDED_PATH_PARTS for part in parts):
        return False
    if normalized.endswith((".db", ".db-wal", ".db-shm")):
        return False
    return posixpath.basename(normalized) != "project.private.config.json"


def read_appid():
    config_path = PROJECT_ROOT / "miniapp" / "project.config.json"
    try:
        appid = json.loads(config_path.read_text(encoding="utf-8")).get("appid")
    except (OSError, ValueError, TypeError) as error:
        raise RuntimeError("ECS_UPLOAD_APPID_REQUIRED") from error
    if not isinstance(appid, str) or not appid.strip():
        raise RuntimeError("ECS_UPLOAD_APPID_REQUIRED")
    return appid.strip()


def resolve_private_key(explicit_path=""):
    configured = str(explicit_path or os.getenv("WECHAT_MINIAPP_PRIVATE_KEY_PATH") or "").strip()
    candidate = Path(configured).expanduser() if configured else Path.home() / ".ssh" / f"private.{read_appid()}.key"
    try:
        resolved = candidate.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise RuntimeError("ECS_UPLOAD_PRIVATE_KEY_REQUIRED") from error
    if not resolved.is_file():
        raise RuntimeError("ECS_UPLOAD_PRIVATE_KEY_REQUIRED")
    return resolved


def release_version():
    try:
        version = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8")).get("version")
    except (OSError, ValueError, TypeError) as error:
        raise RuntimeError("ECS_UPLOAD_VERSION_REQUIRED") from error
    if not isinstance(version, str) or not version.strip():
        raise RuntimeError("ECS_UPLOAD_VERSION_REQUIRED")
    return version.strip()


def build_remote_upload_command(layout, *, version, desc, robot):
    root = shlex.quote(layout["root"])
    key = shlex.quote(layout["key"])
    return " && ".join([
        "set -e",
        f"cd {root}",
        f"tar -xzf {shlex.quote(layout['archive'])}",
        f"rm -f -- {shlex.quote(layout['archive'])}",
        "npm ci --prefix miniapp --include=dev",
        "npm --prefix miniapp run build:weapp",
        f"WECHAT_MINIAPP_PRIVATE_KEY_PATH={key} node scripts/upload-miniapp.js --upload-mode=miniprogram-ci --version {shlex.quote(str(version))} --desc {shlex.quote(str(desc))} --robot {int(robot)}",
    ])


def build_remote_start_command(layout, upload_command):
    wrapped = shlex.quote(upload_command)
    return " && ".join([
        f"rm -f -- {shlex.quote(layout['log'])} {shlex.quote(layout['pid'])}",
        "(" + f"nohup sh -lc {wrapped} > {shlex.quote(layout['log'])} 2>&1 < /dev/null & "
        + f"echo $! > {shlex.quote(layout['pid'])}" + ")",
        f"cat {shlex.quote(layout['pid'])}",
    ])


def parse_remote_upload_state(process_running, output):
    if process_running:
        return "running"
    return "succeeded" if '"success":true' in str(output or "").replace(" ", "") else "failed"


def iter_upload_files():
    miniapp_root = PROJECT_ROOT / "miniapp"
    if not miniapp_root.is_dir():
        raise RuntimeError("ECS_UPLOAD_MINIAPP_SOURCE_REQUIRED")
    for source in miniapp_root.rglob("*"):
        if not source.is_file():
            continue
        relative = source.relative_to(PROJECT_ROOT).as_posix()
        if is_uploadable_relative_path(relative):
            yield source, relative
    for relative in ("package.json", "scripts/upload-miniapp.js"):
        source = PROJECT_ROOT / relative
        if not source.is_file():
            raise RuntimeError("ECS_UPLOAD_SOURCE_REQUIRED")
        yield source, relative


def remote_run(ssh, command, timeout=900):
    return deploy.run(ssh, command, timeout=timeout)


def create_source_archive():
    archive = tempfile.NamedTemporaryFile(prefix="gewu-miniapp-ecs-", suffix=".tar.gz", delete=False)
    archive_path = Path(archive.name)
    archive.close()
    try:
        with tarfile.open(archive_path, "w:gz") as bundle:
            for source, relative in iter_upload_files():
                bundle.add(source, arcname=relative, recursive=False)
        return archive_path
    except Exception:
        archive_path.unlink(missing_ok=True)
        raise


def stage_release(ssh, layout, private_key, source_archive):
    remote_run(ssh, f"mkdir -p {shlex.quote(REMOTE_CACHE_BASE)} && chmod 700 {shlex.quote(REMOTE_CACHE_BASE)}")
    remote_run(ssh, f"mkdir -m 700 {shlex.quote(layout['root'])}")
    sftp = ssh.open_sftp()
    try:
        sftp.put(str(source_archive), layout["archive"])
        sftp.put(str(private_key), layout["key"])
        sftp.chmod(layout["key"], 0o600)
    finally:
        sftp.close()


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Upload miniapp through Alibaba Cloud fixed egress")
    parser.add_argument("--version", default="")
    parser.add_argument("--desc", default="")
    parser.add_argument("--robot", type=int, default=1)
    parser.add_argument("--private-key", default="")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--run-id", default="")
    return parser.parse_args(argv)


def read_remote_status(ssh, layout):
    command = " ".join([
        f"if [ -s {shlex.quote(layout['pid'])} ] && kill -0 \"$(cat {shlex.quote(layout['pid'])})\" 2>/dev/null; then echo __GEWU_RUNNING__; else echo __GEWU_STOPPED__; fi;",
        f"tail -c 65536 {shlex.quote(layout['log'])} 2>/dev/null || true",
    ])
    output, _ = remote_run(ssh, command, timeout=60)
    running = "__GEWU_RUNNING__" in output
    cleaned = output.replace("__GEWU_RUNNING__", "").replace("__GEWU_STOPPED__", "").strip()
    return parse_remote_upload_state(running, cleaned), cleaned


def main(argv=None):
    options = parse_args(argv or sys.argv[1:])
    if options.status:
        layout = build_remote_layout(options.run_id)
        ssh = deploy.connect()
        try:
            state, output = read_remote_status(ssh, layout)
            print(f"ECS_MINIAPP_UPLOAD_STATE={state} run_id={options.run_id}")
            if output:
                print(output)
            if state != "running":
                remote_run(ssh, safe_cleanup_command(layout["root"]), timeout=120)
                print("ECS_MINIAPP_TEMPORARY_KEY_CLEANED")
        finally:
            ssh.close()
        return
    if options.robot < 1:
        raise SystemExit("ECS_UPLOAD_ROBOT_INVALID")
    version = str(options.version or release_version()).strip()
    desc = str(options.desc or f"格物工坊小程序发布 {date.today().isoformat()}").strip()
    if not version or not desc:
        raise SystemExit("ECS_UPLOAD_METADATA_REQUIRED")
    layout = build_remote_layout(f"{REMOTE_RELEASE_PREFIX}{uuid.uuid4().hex}")
    private_key = resolve_private_key(options.private_key)
    ssh = deploy.connect()
    source_archive = create_source_archive()
    started = False
    try:
        stage_release(ssh, layout, private_key, source_archive)
        upload_command = build_remote_upload_command(layout, version=version, desc=desc, robot=options.robot)
        remote_run(ssh, build_remote_start_command(layout, upload_command), timeout=60)
        started = True
        print(f"ECS_MINIAPP_UPLOAD_STARTED version={version} run_id={posixpath.basename(layout['root'])}")
    finally:
        try:
            if not started:
                remote_run(ssh, safe_cleanup_command(layout["root"]), timeout=120)
                print("ECS_MINIAPP_TEMPORARY_KEY_CLEANED")
        finally:
            ssh.close()
            source_archive.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
