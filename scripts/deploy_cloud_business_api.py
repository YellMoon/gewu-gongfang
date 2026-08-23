#!/usr/bin/env python3
"""Deploy the PostgreSQL-backed cloud business API as a verified Docker release."""

import argparse
import json
import os
import posixpath
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import deploy  # noqa: E402


CURRENT_CONTAINER = "gewu-cloud-business-api"
POSTGRES_CONTAINER = "gewu-postgres17"
REMOTE_BUILD_ROOT = "/root/gewu-cloud-business-builds"
TAG_PATTERN = re.compile(r"^[0-9]+(?:\.[0-9]+){2}-[0-9a-f]{7,40}$")


def failure(code):
    return ValueError(code)


def release_tag(version, revision):
    if not isinstance(version, str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]+){2}", version):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{7,40}", revision):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    return f"{version}-{revision}"


def candidate_name(tag):
    if not isinstance(tag, str) or not TAG_PATTERN.fullmatch(tag):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    return f"gewu-cloud-business-api-candidate-{tag}"


def remote_build_dir(tag):
    if not isinstance(tag, str) or not TAG_PATTERN.fullmatch(tag):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    return f"{REMOTE_BUILD_ROOT}/{tag}"


def remote_env_path(tag):
    if not isinstance(tag, str) or not TAG_PATTERN.fullmatch(tag):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    return f"/tmp/gewu-cloud-business-{tag}.env"


def candidate_command(tag):
    image = f"gewu-cloud-business-api:{tag}"
    candidate = candidate_name(tag)
    env_path = remote_env_path(tag)
    return (
        "set -eu; "
        f"current='{CURRENT_CONTAINER}'; candidate='{candidate}'; env_path='{env_path}'; "
        "network=$(docker inspect -f '{{range $key, $_ := .NetworkSettings.Networks}}{{$key}}{{end}}' \"$current\"); "
        "test -n \"$network\"; "
        "docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' \"$current\" > \"$env_path\"; "
        "chmod 600 \"$env_path\"; "
        "if docker container inspect \"$candidate\" >/dev/null 2>&1; then exit 2; fi; "
        f"docker run -d --name \"$candidate\" --network \"$network\" --restart no --env-file \"$env_path\" -p 127.0.0.1:3003:3002 '{image}'; "
        "rm -f -- \"$env_path\"; "
        "for attempt in 1 2 3 4 5 6 7 8 9 10; do "
        "curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3003/api/health && exit 0; sleep 1; done; exit 1"
    )


def switch_command(tag):
    image = f"gewu-cloud-business-api:{tag}"
    candidate = candidate_name(tag)
    env_path = remote_env_path(tag)
    rollback = f"gewu-cloud-business-api-rollback-{tag}"
    return (
        "set -eu; "
        f"current='{CURRENT_CONTAINER}'; candidate='{candidate}'; rollback='{rollback}'; env_path='{env_path}'; "
        "network=$(docker inspect -f '{{range $key, $_ := .NetworkSettings.Networks}}{{$key}}{{end}}' \"$current\"); "
        "test -n \"$network\"; "
        "docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' \"$current\" > \"$env_path\"; "
        "chmod 600 \"$env_path\"; "
        "if docker container inspect \"$rollback\" >/dev/null 2>&1; then exit 2; fi; "
        "docker rm -f \"$candidate\"; "
        "docker stop \"$current\"; docker rename \"$current\" \"$rollback\"; "
        f"if docker run -d --name \"$current\" --network \"$network\" --restart unless-stopped --env-file \"$env_path\" -p 127.0.0.1:3002:3002 '{image}'; then "
        "for attempt in 1 2 3 4 5 6 7 8 9 10; do "
        "curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3002/api/health && rm -f -- \"$env_path\" && exit 0; sleep 1; done; fi; "
        "docker rm -f \"$current\" >/dev/null 2>&1 || true; "
        "docker rename \"$rollback\" \"$current\"; docker start \"$current\"; rm -f -- \"$env_path\"; exit 1"
    )


def source_version():
    payload = json.loads((ROOT / "cloud-business-api" / "package.json").read_text(encoding="utf-8"))
    value = payload.get("version")
    if not isinstance(value, str):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    return value


def source_revision():
    result = subprocess.run(["git", "rev-parse", "--short=12", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True)
    return result.stdout.strip()


def upload_source(ssh, tag):
    build_dir = remote_build_dir(tag)
    deploy.run(ssh, f"test ! -e '{build_dir}' && mkdir -p '{build_dir}'")
    sftp = ssh.open_sftp()
    try:
        for top_level in ("cloud-business-api", "shared"):
            local_top = ROOT / top_level
            for local_path in local_top.rglob("*"):
                if not local_path.is_file() or "node_modules" in local_path.parts:
                    continue
                relative = local_path.relative_to(ROOT).as_posix()
                remote_path = posixpath.join(build_dir, relative)
                remote_parent = posixpath.dirname(remote_path)
                deploy.run(ssh, f"mkdir -p '{remote_parent}'")
                sftp.put(str(local_path), remote_path)
    finally:
        sftp.close()
    return build_dir


def build_image(ssh, tag):
    build_dir = remote_build_dir(tag)
    deploy.run(ssh, f"cd '{build_dir}' && docker build --pull=false -t 'gewu-cloud-business-api:{tag}' -f cloud-business-api/Dockerfile .", timeout=600)


def run_cloud_migrations():
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "apply_cloud_postgres_migrations.py")], cwd=ROOT, check=True, text=True)
    return result.returncode


def health_url():
    return "https://physicsedu.xyz/scheduling/api/health"


def verify_public_health():
    ssh = deploy.connect()
    try:
        output, _ = deploy.run(ssh, f"curl --fail --silent --show-error --max-time 30 '{health_url()}'", timeout=45)
    finally:
        ssh.close()
    payload = json.loads(output)
    if payload.get("ok") is not True or payload.get("businessAuthority") != "cloud":
        raise RuntimeError("CLOUD_DOCKER_DEPLOY_HEALTH_INVALID")
    return payload


def deploy_release():
    tag = release_tag(source_version(), source_revision())
    ssh = deploy.connect()
    try:
        upload_source(ssh, tag)
        build_image(ssh, tag)
        deploy.run(ssh, candidate_command(tag), timeout=90)
        run_cloud_migrations()
        deploy.run(ssh, switch_command(tag), timeout=120)
    finally:
        ssh.close()
    return verify_public_health()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("deploy", "candidate"))
    args = parser.parse_args()
    tag = release_tag(source_version(), source_revision())
    if args.command == "candidate":
        ssh = deploy.connect()
        try:
            upload_source(ssh, tag)
            build_image(ssh, tag)
            deploy.run(ssh, candidate_command(tag), timeout=90)
        finally:
            ssh.close()
        return
    print(json.dumps(deploy_release(), ensure_ascii=True, sort_keys=True))


if __name__ == "__main__":
    main()
