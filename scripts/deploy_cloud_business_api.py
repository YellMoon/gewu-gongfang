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


def discard_candidate_command(tag):
    return f"docker rm -f -- '{candidate_name(tag)}'"


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


def rollback_command(tag):
    candidate_name(tag)
    rollback = f"gewu-cloud-business-api-rollback-{tag}"
    return (
        "set -eu; "
        f"current='{CURRENT_CONTAINER}'; rollback='{rollback}'; "
        "docker container inspect \"$rollback\" >/dev/null 2>&1; "
        "docker rm -f \"$current\"; "
        "docker rename \"$rollback\" \"$current\"; docker start \"$current\"; "
        "for attempt in 1 2 3 4 5 6 7 8 9 10; do "
        "curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3002/api/health && exit 0; sleep 1; done; exit 1"
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


def validated_release_tag(requested_tag=None):
    expected = release_tag(source_version(), source_revision())
    if requested_tag is not None and requested_tag != expected:
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    return expected


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
    control_m20 = subprocess.run([sys.executable, str(ROOT / "scripts" / "apply_cloud_control_plane_m20.py")], cwd=ROOT, check=True, text=True)
    control_m21 = subprocess.run([sys.executable, str(ROOT / "scripts" / "apply_cloud_control_plane_m21.py")], cwd=ROOT, check=True, text=True)
    control_m22 = subprocess.run([sys.executable, str(ROOT / "scripts" / "apply_cloud_control_plane_m22.py")], cwd=ROOT, check=True, text=True)
    business = subprocess.run([sys.executable, str(ROOT / "scripts" / "apply_cloud_postgres_migrations.py")], cwd=ROOT, check=True, text=True)
    return max(control_m20.returncode, control_m21.returncode, control_m22.returncode, business.returncode)


def health_url():
    return "https://physicsedu.xyz/scheduling/api/health"


def verify_public_health(expected_version):
    if not isinstance(expected_version, str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]+){2}", expected_version):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    ssh = deploy.connect()
    try:
        output, _ = deploy.run(ssh, f"curl --fail --silent --show-error --max-time 30 '{health_url()}'", timeout=45)
    finally:
        ssh.close()
    payload = json.loads(output)
    if (payload.get("ok") is not True or payload.get("businessAuthority") != "cloud"
            or payload.get("version") != expected_version):
        raise RuntimeError("CLOUD_DOCKER_DEPLOY_HEALTH_INVALID")
    return payload


def rollback_promoted_release(tag):
    ssh = deploy.connect()
    try:
        deploy.run(ssh, rollback_command(tag), timeout=120)
    finally:
        ssh.close()


def promote_validated_candidate(tag, version, evidence):
    ssh = deploy.connect()
    try:
        deploy.run(ssh, switch_command(tag), timeout=120)
    finally:
        ssh.close()
    try:
        health = verify_public_health(version)
        deploy.record_release_receipt("cloud_business", evidence)
        return health
    except BaseException as primary_error:
        try:
            rollback_promoted_release(tag)
        except BaseException as rollback_error:
            raise RuntimeError("CLOUD_DOCKER_DEPLOY_ROLLBACK_FAILED") from rollback_error
        raise primary_error


def deploy_release():
    version = source_version()
    deploy.require_release_manifest("cloud_business")
    tag = validated_release_tag()
    ssh = deploy.connect()
    try:
        upload_source(ssh, tag)
        build_image(ssh, tag)
        deploy.run(ssh, candidate_command(tag), timeout=90)
        try:
            run_cloud_migrations()
        except Exception:
            deploy.run(ssh, discard_candidate_command(tag))
            raise
    finally:
        ssh.close()
    return promote_validated_candidate(
        tag,
        version,
        f"public cloud business health verified at version {version}",
    )


def promote_release(tag):
    version = source_version()
    tag = validated_release_tag(tag)
    deploy.require_release_manifest("cloud_business")
    return promote_validated_candidate(
        tag,
        version,
        f"promoted cloud business candidate verified at version {version}",
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("deploy", "candidate", "promote", "discard"))
    parser.add_argument("--tag")
    args = parser.parse_args()
    if args.command == "discard":
        tag = args.tag or validated_release_tag()
        if not TAG_PATTERN.fullmatch(tag):
            raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    else:
        tag = validated_release_tag(args.tag)
    if args.command == "candidate":
        deploy.require_release_manifest("cloud_business")
        ssh = deploy.connect()
        try:
            upload_source(ssh, tag)
            build_image(ssh, tag)
            deploy.run(ssh, candidate_command(tag), timeout=90)
        finally:
            ssh.close()
        return
    if args.command == "promote":
        print(json.dumps(promote_release(tag), ensure_ascii=True, sort_keys=True))
        return
    if args.command == "discard":
        ssh = deploy.connect()
        try:
            deploy.run(ssh, discard_candidate_command(tag))
        finally:
            ssh.close()
        return
    print(json.dumps(deploy_release(), ensure_ascii=True, sort_keys=True))


if __name__ == "__main__":
    main()
