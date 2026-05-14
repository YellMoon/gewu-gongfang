#!/usr/bin/env python3
"""
Versioned Docker deploy and one-command rollback for the scheduling backend.

Local validation examples:
  python scripts/docker_deploy_gray.py deploy --version 3.0.4-staging --dry-run
  python scripts/docker_deploy_gray.py rollback --image scheduling-api:3.0.3 --dry-run

For a real staging host, provide SSH target details. Authentication is delegated
to the local ssh client, so use an ssh-agent, key file, or host config instead
of committing credentials.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import PurePosixPath


DEFAULT_STATE_FILE = "/root/scheduling-backend/deploy-state.json"


@dataclass
class DeployContext:
    host: str
    user: str
    port: int
    remote_path: str
    dockerfile: str
    build_context: str
    image_repo: str
    container: str
    network: str
    volume: str
    port_mapping: str
    health_url: str
    state_file: str
    dry_run: bool

    @property
    def ssh_target(self) -> str:
        return f"{self.user}@{self.host}" if self.user else self.host


def quote(value: str) -> str:
    return shlex.quote(str(value))


def utc_now() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def run_remote(ctx: DeployContext, command: str, *, check: bool = True) -> str:
    if ctx.dry_run:
        print(f"[dry-run] {command}")
        return ""

    ssh_command = ["ssh", "-p", str(ctx.port), ctx.ssh_target, command]
    result = subprocess.run(ssh_command, text=True, capture_output=True)
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    if check and result.returncode != 0:
        raise SystemExit(result.returncode)
    return result.stdout.strip()


def remote_json_write(ctx: DeployContext, payload: dict) -> None:
    state_path = PurePosixPath(ctx.state_file)
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    command = (
        f"mkdir -p {quote(str(state_path.parent))} && "
        f"cat > {quote(ctx.state_file)} <<'JSON'\n{encoded}\nJSON"
    )
    run_remote(ctx, command)


def remote_json_read_command(path: str, key: str, fallback: str = "") -> str:
    return (
        "python3 - <<'PY'\n"
        "import json\n"
        f"path = {path!r}\n"
        f"key = {key!r}\n"
        f"fallback = {fallback!r}\n"
        "try:\n"
        "    with open(path, 'r', encoding='utf-8') as f:\n"
        "        data = json.load(f)\n"
        "    print(data.get(key) or fallback)\n"
        "except FileNotFoundError:\n"
        "    print(fallback)\n"
        "PY"
    )


def build_image(ctx: DeployContext, version: str, channel: str, revision: str) -> str:
    image = f"{ctx.image_repo}:{version}"
    channel_image = f"{ctx.image_repo}:{channel}"
    build_date = utc_now()
    command = (
        f"cd {quote(ctx.remote_path)} && "
        "docker build "
        f"-f {quote(ctx.dockerfile)} "
        f"--build-arg APP_VERSION={quote(version)} "
        f"--build-arg APP_REVISION={quote(revision)} "
        f"--build-arg BUILD_DATE={quote(build_date)} "
        f"--label app.gewu.version={quote(version)} "
        f"--label app.gewu.channel={quote(channel)} "
        f"--label app.gewu.revision={quote(revision)} "
        f"-t {quote(image)} -t {quote(channel_image)} {quote(ctx.build_context)}"
    )
    run_remote(ctx, command)
    return image


def current_image(ctx: DeployContext) -> str:
    command = f"docker inspect -f '{{{{.Config.Image}}}}' {quote(ctx.container)} 2>/dev/null || true"
    return run_remote(ctx, command, check=False)


def start_container(ctx: DeployContext, image: str, version: str, channel: str) -> None:
    command = (
        f"docker rm -f {quote(ctx.container)} 2>/dev/null || true; "
        "docker run -d "
        f"--name {quote(ctx.container)} "
        f"--network {quote(ctx.network)} "
        "--restart unless-stopped "
        f"-p {quote(ctx.port_mapping)} "
        f"-v {quote(ctx.volume)}:/app/data "
        "-e NODE_ENV=production "
        "-e PORT=3001 "
        "-e DB_PATH=/app/data/scheduling.db "
        f"-e APP_VERSION={quote(version)} "
        f"-e DEPLOY_CHANNEL={quote(channel)} "
        f"{quote(image)}"
    )
    run_remote(ctx, command)


def assert_healthy(ctx: DeployContext, timeout: int) -> None:
    command = (
        "python3 - <<'PY'\n"
        "import sys, time, urllib.request\n"
        f"url = {ctx.health_url!r}\n"
        f"deadline = time.time() + {timeout}\n"
        "last = ''\n"
        "while time.time() < deadline:\n"
        "    try:\n"
        "        with urllib.request.urlopen(url, timeout=3) as resp:\n"
        "            body = resp.read().decode('utf-8', 'replace')\n"
        "            if resp.status == 200:\n"
        "                print(body[:500])\n"
        "                sys.exit(0)\n"
        "            last = f'status={resp.status} body={body[:200]}'\n"
        "    except Exception as exc:\n"
        "        last = repr(exc)\n"
        "    time.sleep(2)\n"
        "print(last)\n"
        "sys.exit(1)\n"
        "PY"
    )
    run_remote(ctx, command)


def deploy(args: argparse.Namespace) -> None:
    ctx = make_context(args)
    previous = args.previous_image or current_image(ctx) or ""
    image = build_image(ctx, args.version, args.channel, args.revision or args.version)
    state = {
        "channel": args.channel,
        "currentImage": image,
        "previousImage": previous,
        "version": args.version,
        "revision": args.revision or args.version,
        "status": "deploying",
        "updatedAt": utc_now(),
        "rollbackNote": "Database rollback is not automatic. Verify schema compatibility before rolling code back.",
    }
    remote_json_write(ctx, state)
    start_container(ctx, image, args.version, args.channel)

    try:
        assert_healthy(ctx, args.health_timeout)
    except SystemExit:
        if previous:
            print(f"Health check failed. Rolling back to {previous}.", file=sys.stderr)
            start_container(ctx, previous, "rollback", args.channel)
            remote_json_write(ctx, {**state, "status": "rolled_back", "failedImage": image, "currentImage": previous})
        raise

    remote_json_write(ctx, {**state, "status": "healthy"})


def rollback(args: argparse.Namespace) -> None:
    ctx = make_context(args)
    image = args.image or run_remote(ctx, remote_json_read_command(ctx.state_file, "previousImage"), check=False)
    image = image.strip()
    if not image:
        raise SystemExit("No rollback image was provided and previousImage is missing from deploy state.")
    start_container(ctx, image, "rollback", args.channel)
    assert_healthy(ctx, args.health_timeout)
    remote_json_write(
        ctx,
        {
            "channel": args.channel,
            "currentImage": image,
            "previousImage": "",
            "version": "rollback",
            "revision": args.revision or "manual-rollback",
            "status": "healthy_after_rollback",
            "updatedAt": utc_now(),
            "rollbackNote": "Code rollback completed. Confirm database schema/data compatibility separately.",
        },
    )


def status(args: argparse.Namespace) -> None:
    ctx = make_context(args)
    run_remote(ctx, f"docker ps --filter name={quote(ctx.container)} --format '{{{{.Names}}}} {{{{.Image}}}} {{{{.Status}}}}'")
    run_remote(ctx, f"cat {quote(ctx.state_file)} 2>/dev/null || true", check=False)


def make_context(args: argparse.Namespace) -> DeployContext:
    return DeployContext(
        host=args.host,
        user=args.user,
        port=args.ssh_port,
        remote_path=args.remote_path,
        dockerfile=args.dockerfile,
        build_context=args.build_context,
        image_repo=args.image_repo,
        container=args.container,
        network=args.network,
        volume=args.volume,
        port_mapping=args.port_mapping,
        health_url=args.health_url,
        state_file=args.state_file,
        dry_run=args.dry_run,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Versioned gray deploy and rollback for Gewu backend.")
    sub = parser.add_subparsers(dest="action", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--host", default="localhost", help="SSH host for staging/prod.")
        p.add_argument("--user", default="", help="SSH user. Empty means use the host as-is.")
        p.add_argument("--ssh-port", type=int, default=22)
        p.add_argument("--remote-path", default="/root/scheduling-backend")
        p.add_argument("--dockerfile", default="backend/Dockerfile")
        p.add_argument("--build-context", default="backend")
        p.add_argument("--image-repo", default="scheduling-api")
        p.add_argument("--container", default="scheduling-backend")
        p.add_argument("--network", default="app_default")
        p.add_argument("--volume", default="scheduling_data")
        p.add_argument("--port-mapping", default="3001:3001")
        p.add_argument("--health-url", default="http://localhost:3001/api/health")
        p.add_argument("--state-file", default=DEFAULT_STATE_FILE)
        p.add_argument("--channel", default="staging", choices=["dev", "staging", "prod"])
        p.add_argument("--revision", default="")
        p.add_argument("--health-timeout", type=int, default=45)
        p.add_argument("--dry-run", action="store_true", help="Print commands without opening SSH.")

    deploy_p = sub.add_parser("deploy", help="Build and deploy a specific image version.")
    common(deploy_p)
    deploy_p.add_argument("--version", required=True, help="Immutable image tag to deploy.")
    deploy_p.add_argument("--previous-image", default="", help="Override detected previous image for dry-run or CI drills.")
    deploy_p.set_defaults(func=deploy)

    rollback_p = sub.add_parser("rollback", help="Rollback to the previous or specified image.")
    common(rollback_p)
    rollback_p.add_argument("--image", default="", help="Explicit rollback image, e.g. scheduling-api:3.0.3.")
    rollback_p.set_defaults(func=rollback)

    status_p = sub.add_parser("status", help="Show container and deploy-state status.")
    common(status_p)
    status_p.set_defaults(func=status)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
