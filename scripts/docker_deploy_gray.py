#!/usr/bin/env python3
"""Gray deploy helper for the backend Docker service.

The script is designed for GitHub Actions:
- package the checked-out revision and upload it to the server;
- build the Docker image from that uploaded source, not a stale remote folder;
- inject runtime secrets through a chmod 600 env file;
- start the selected image and verify health.
"""

from __future__ import annotations

import argparse
import os
import shlex
import subprocess
import tarfile
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path


EXCLUDES = {
    ".git",
    "node_modules",
    "backend/node_modules",
    "miniapp/node_modules",
    "build",
    "dist",
    ".venv",
    "venv",
}


def quote(value: str) -> str:
    return shlex.quote(str(value))


def run(cmd: list[str], *, input_text: str | None = None) -> str:
    result = subprocess.run(
        cmd,
        input=input_text,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"command failed ({result.returncode}): {' '.join(cmd)}\n{result.stdout}")
    return result.stdout.strip()


@dataclass
class DeployContext:
    host: str
    user: str
    ssh_port: str
    remote_path: str
    dockerfile: str
    build_context: str
    network: str
    volume: str
    health_url: str
    channel: str
    revision: str
    image_repo: str
    container: str
    port_mapping: str
    jwt_secret: str | None = None

    @property
    def ssh_target(self) -> str:
        return f"{self.user}@{self.host}"

    @property
    def source_path(self) -> str:
        return f"{self.remote_path.rstrip('/')}/source"

    @property
    def runtime_env_path(self) -> str:
        return f"{self.remote_path.rstrip('/')}/runtime.env"


def ssh(ctx: DeployContext, command: str) -> str:
    return run(["ssh", "-p", ctx.ssh_port, ctx.ssh_target, command])


def scp(ctx: DeployContext, src: str, dest: str) -> str:
    return run(["scp", "-P", ctx.ssh_port, src, f"{ctx.ssh_target}:{dest}"])


def should_exclude(path: Path) -> bool:
    text = path.as_posix()
    return any(text == item or text.startswith(f"{item}/") for item in EXCLUDES)


def create_source_archive(root: Path) -> str:
    handle = tempfile.NamedTemporaryFile(prefix="scheduling-source-", suffix=".tar.gz", delete=False)
    handle.close()
    archive = handle.name
    with tarfile.open(archive, "w:gz") as tar:
      for path in root.rglob("*"):
          rel = path.relative_to(root)
          if should_exclude(rel):
              continue
          tar.add(path, arcname=rel)
    return archive


def sync_source(ctx: DeployContext) -> None:
    archive = create_source_archive(Path.cwd())
    remote_archive = f"{ctx.remote_path.rstrip('/')}/source.tar.gz"
    try:
        ssh(ctx, f"mkdir -p {quote(ctx.remote_path)} {quote(ctx.source_path)}")
        scp(ctx, archive, remote_archive)
        ssh(
            ctx,
            "set -e; "
            f"rm -rf {quote(ctx.source_path)}; "
            f"mkdir -p {quote(ctx.source_path)}; "
            f"tar -xzf {quote(remote_archive)} -C {quote(ctx.source_path)}; "
            f"rm -f {quote(remote_archive)}",
        )
    finally:
        try:
            os.unlink(archive)
        except OSError:
            pass


def write_runtime_env(ctx: DeployContext) -> None:
    if not ctx.jwt_secret:
        raise ValueError("JWT secret is required for backend deploy")
    content = "\n".join([
        "NODE_ENV=production",
        "PORT=3001",
        "DB_PATH=/app/data/scheduling.db",
        "READ_DB_PATH=/app/data/scheduling.db",
        f"APP_VERSION={ctx.revision}",
        f"DEPLOY_CHANNEL={ctx.channel}",
        f"JWT_SECRET={ctx.jwt_secret}",
        "",
    ])
    ssh(
        ctx,
        "set -e; "
        f"umask 077; cat > {quote(ctx.runtime_env_path)} <<'EOF'\n{content}EOF\n"
        f"chmod 600 {quote(ctx.runtime_env_path)}",
    )


def build_image(ctx: DeployContext, version: str) -> str:
    image = f"{ctx.image_repo}:{version}"
    channel_image = f"{ctx.image_repo}:{ctx.channel}"
    build_date = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    command = (
        "set -e; "
        f"cd {quote(ctx.source_path)}; "
        "docker build "
        f"-f {quote(ctx.dockerfile)} "
        f"--build-arg APP_VERSION={quote(version)} "
        f"--build-arg APP_REVISION={quote(ctx.revision)} "
        f"--build-arg BUILD_DATE={quote(build_date)} "
        f"--label app.gewu.version={quote(version)} "
        f"--label app.gewu.channel={quote(ctx.channel)} "
        f"--label app.gewu.revision={quote(ctx.revision)} "
        f"-t {quote(image)} -t {quote(channel_image)} {quote(ctx.build_context)}"
    )
    ssh(ctx, command)
    return image


def start_container(ctx: DeployContext, image: str) -> None:
    command = (
        "set -e; "
        f"docker rm -f {quote(ctx.container)} 2>/dev/null || true; "
        "docker run -d "
        f"--name {quote(ctx.container)} "
        f"--network {quote(ctx.network)} "
        "--restart unless-stopped "
        f"-p {quote(ctx.port_mapping)} "
        f"-v {quote(ctx.volume)}:/app/data "
        f"--env-file {quote(ctx.runtime_env_path)} "
        f"{quote(image)}"
    )
    ssh(ctx, command)


def assert_healthy(ctx: DeployContext, timeout: int = 90) -> None:
    command = (
        "python3 - <<'PY'\n"
        "import sys, time, urllib.request\n"
        f"url = {ctx.health_url!r}\n"
        f"deadline = time.time() + {timeout}\n"
        "last = ''\n"
        "while time.time() < deadline:\n"
        "    try:\n"
        "        with urllib.request.urlopen(url, timeout=3) as resp:\n"
        "            if resp.status == 200:\n"
        "                print('backend healthy')\n"
        "                sys.exit(0)\n"
        "            last = f'HTTP {resp.status}'\n"
        "    except Exception as exc:\n"
        "        last = str(exc)\n"
        "    time.sleep(3)\n"
        "print(f'health check failed for {url}: {last}', file=sys.stderr)\n"
        "sys.exit(1)\n"
        "PY"
    )
    ssh(ctx, command)


def deploy(ctx: DeployContext, version: str) -> None:
    sync_source(ctx)
    write_runtime_env(ctx)
    image = build_image(ctx, version)
    start_container(ctx, image)
    assert_healthy(ctx)


def rollback(ctx: DeployContext, image: str) -> None:
    if not image:
        raise ValueError("rollback image is required")
    write_runtime_env(ctx)
    start_container(ctx, image)
    assert_healthy(ctx)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["deploy", "rollback"])
    parser.add_argument("--host", required=True)
    parser.add_argument("--user", default="root")
    parser.add_argument("--ssh-port", default="22")
    parser.add_argument("--remote-path", default="/root/scheduling-backend")
    parser.add_argument("--dockerfile", default="backend/Dockerfile")
    parser.add_argument("--build-context", default="backend")
    parser.add_argument("--network", default="app_default")
    parser.add_argument("--volume", default="scheduling_data")
    parser.add_argument("--health-url", default="http://localhost:3001/api/health")
    parser.add_argument("--channel", default="staging")
    parser.add_argument("--revision", required=True)
    parser.add_argument("--version", default="")
    parser.add_argument("--image", default="")
    parser.add_argument("--image-repo", default="scheduling-api")
    parser.add_argument("--container", default="scheduling-backend")
    parser.add_argument("--port-mapping", default="3001:3001")
    parser.add_argument("--jwt-secret", default=os.environ.get("BACKEND_JWT_SECRET", ""))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ctx = DeployContext(
        host=args.host,
        user=args.user,
        ssh_port=args.ssh_port,
        remote_path=args.remote_path,
        dockerfile=args.dockerfile,
        build_context=args.build_context,
        network=args.network,
        volume=args.volume,
        health_url=args.health_url,
        channel=args.channel,
        revision=args.revision,
        image_repo=args.image_repo,
        container=args.container,
        port_mapping=args.port_mapping,
        jwt_secret=args.jwt_secret,
    )
    if args.action == "deploy":
        if not args.version:
            raise ValueError("version is required for deploy")
        deploy(ctx, args.version)
    else:
        rollback(ctx, args.image)


if __name__ == "__main__":
    main()
