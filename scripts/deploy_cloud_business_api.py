#!/usr/bin/env python3
"""Deploy the PostgreSQL-backed cloud business API as a verified Docker release."""

import argparse
import json
import os
import posixpath
import re
import secrets
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import deploy  # noqa: E402


CURRENT_CONTAINER = "gewu-cloud-business-api"
POSTGRES_CONTAINER = "gewu-postgres17"
REMOTE_BUILD_ROOT = "/root/gewu-cloud-business-builds"
SWITCH_LOCK_PATH = "/tmp/gewu-cloud-business-api-switch.lock"
PROMOTION_LOCK_PATH = "/tmp/gewu-cloud-business-api-promotion.lock"
PROMOTION_GUARD_LOCK_PATH = "/tmp/gewu-cloud-business-api-promotion-guard.lock"
TAG_PATTERN = re.compile(r"^[0-9]+(?:\.[0-9]+){2}-[0-9a-f]{7,40}$")
OPERATION_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
PROMOTION_LOCK_STALE_SECONDS = 900


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


def promotion_lock_acquire_command(operation_id, tag):
    if not isinstance(operation_id, str) or not OPERATION_ID_PATTERN.fullmatch(operation_id):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    candidate_name(tag)
    return (
        "set -eu; "
        f"owner='{operation_id}'; tag='{tag}'; lock='{PROMOTION_LOCK_PATH}'; tmp='{PROMOTION_LOCK_PATH}.{operation_id}.tmp'; "
        f"exec 8>'{PROMOTION_GUARD_LOCK_PATH}'; flock -x 8; "
        "if [ -e \"$lock\" ] && [ ! -s \"$lock\" ]; then flock -n \"$lock\" rm -f -- \"$lock\" || true; fi; "
        "umask 077; trap 'rm -f -- \"$tmp\"' EXIT; printf '%s %s %s\\n' \"$owner\" \"$tag\" \"$(date +%s)\" > \"$tmp\"; "
        "if ! ln \"$tmp\" \"$lock\"; then exit 3; fi"
    )


def promotion_lock_release_command(operation_id):
    if not isinstance(operation_id, str) or not OPERATION_ID_PATTERN.fullmatch(operation_id):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    return (
        "set -eu; "
        f"owner='{operation_id}'; lock='{PROMOTION_LOCK_PATH}'; exec 8>'{PROMOTION_GUARD_LOCK_PATH}'; flock -x 8; "
        "if [ ! -e \"$lock\" ]; then exit 0; fi; "
        "read -r actual_owner _ < \"$lock\"; if [ \"$actual_owner\" = \"$owner\" ]; then rm -f -- \"$lock\"; fi"
    )


def promotion_lock_recovery_claim_command(recovery_id, tag):
    if not isinstance(recovery_id, str) or not OPERATION_ID_PATTERN.fullmatch(recovery_id):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    candidate_name(tag)
    return (
        "set -eu; "
        f"recovery='{recovery_id}'; expected_tag='{tag}'; lock='{PROMOTION_LOCK_PATH}'; "
        f"tmp='{PROMOTION_LOCK_PATH}.{recovery_id}.tmp'; stale='{PROMOTION_LOCK_STALE_SECONDS}'; "
        f"exec 8>'{PROMOTION_GUARD_LOCK_PATH}'; flock -x 8; "
        "read -r owner actual_tag created extra < \"$lock\"; test -z \"${extra:-}\"; "
        "test \"$actual_tag\" = \"$expected_tag\"; now=$(date +%s); age=$((now - created)); test \"$age\" -ge \"$stale\"; "
        "umask 077; trap 'rm -f -- \"$tmp\"' EXIT; printf '%s %s %s\\n' \"$recovery\" \"$expected_tag\" \"$now\" > \"$tmp\"; "
        "mv -f -- \"$tmp\" \"$lock\"; printf '%s %s\\n' \"$owner\" \"$age\""
    )


def promotion_lock_heartbeat_command(operation_id, tag):
    if not isinstance(operation_id, str) or not OPERATION_ID_PATTERN.fullmatch(operation_id):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    candidate_name(tag)
    return (
        "set -eu; "
        f"owner='{operation_id}'; expected_tag='{tag}'; lock='{PROMOTION_LOCK_PATH}'; "
        f"exec 8>'{PROMOTION_GUARD_LOCK_PATH}'; flock -x 8; "
        "read -r actual_owner actual_tag _ extra < \"$lock\"; test -z \"${extra:-}\"; "
        "test \"$actual_owner\" = \"$owner\"; test \"$actual_tag\" = \"$expected_tag\"; "
        "printf '%s %s %s\\n' \"$owner\" \"$expected_tag\" \"$(date +%s)\" > \"$lock\""
    )


def promotion_owner_guard(operation_id, tag):
    if not isinstance(operation_id, str) or not OPERATION_ID_PATTERN.fullmatch(operation_id):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    candidate_name(tag)
    return (
        f"owner='{operation_id}'; expected_tag='{tag}'; promotion_lock='{PROMOTION_LOCK_PATH}'; "
        f"exec 8>'{PROMOTION_GUARD_LOCK_PATH}'; flock -x 8; "
        "read -r actual_owner actual_tag _ extra < \"$promotion_lock\"; test -z \"${extra:-}\"; "
        "test \"$actual_owner\" = \"$owner\"; test \"$actual_tag\" = \"$expected_tag\"; "
        "printf '%s %s %s\\n' \"$owner\" \"$expected_tag\" \"$(date +%s)\" > \"$promotion_lock\"; "
    )


def switch_command(tag, operation_id):
    image = f"gewu-cloud-business-api:{tag}"
    candidate = candidate_name(tag)
    env_path = remote_env_path(tag)
    rollback = f"gewu-cloud-business-api-rollback-{tag}"
    return (
        "set -eu; "
        + promotion_owner_guard(operation_id, tag)
        + f"current='{CURRENT_CONTAINER}'; candidate='{candidate}'; rollback='{rollback}'; env_path='{env_path}'; "
        f"exec 9>'{SWITCH_LOCK_PATH}'; flock -x 9; "
        "network=$(docker inspect -f '{{range $key, $_ := .NetworkSettings.Networks}}{{$key}}{{end}}' \"$current\"); "
        "test -n \"$network\"; "
        "docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' \"$current\" > \"$env_path\"; "
        "chmod 600 \"$env_path\"; "
        "if docker container inspect \"$rollback\" >/dev/null 2>&1; then exit 2; fi; "
        "docker rm -f \"$candidate\"; "
        "docker rename \"$current\" \"$rollback\"; docker stop \"$rollback\"; "
        f"if docker run -d --name \"$current\" --network \"$network\" --restart unless-stopped --env-file \"$env_path\" -p 127.0.0.1:3002:3002 '{image}'; then "
        "for attempt in 1 2 3 4 5 6 7 8 9 10; do "
        "curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3002/api/health && rm -f -- \"$env_path\" && exit 0; sleep 1; done; fi; "
        "docker rm -f \"$current\" >/dev/null 2>&1 || true; "
        "docker rename \"$rollback\" \"$current\"; docker start \"$current\"; rm -f -- \"$env_path\"; exit 1"
    )


def rollback_command(tag, operation_id):
    candidate_name(tag)
    rollback = f"gewu-cloud-business-api-rollback-{tag}"
    return (
        "set -eu; "
        + promotion_owner_guard(operation_id, tag)
        + f"current='{CURRENT_CONTAINER}'; rollback='{rollback}'; "
        f"exec 9>'{SWITCH_LOCK_PATH}'; flock -x 9; "
        "docker container inspect \"$rollback\" >/dev/null 2>&1; "
        "docker rm -f \"$current\"; "
        "docker rename \"$rollback\" \"$current\"; docker start \"$current\"; "
        "for attempt in 1 2 3 4 5 6 7 8 9 10; do "
        "curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3002/api/health && exit 0; sleep 1; done; exit 1"
    )


def reconcile_switch_failure_command(tag, operation_id):
    candidate_name(tag)
    rollback = f"gewu-cloud-business-api-rollback-{tag}"
    return (
        "set -eu; "
        + promotion_owner_guard(operation_id, tag)
        + f"current='{CURRENT_CONTAINER}'; rollback='{rollback}'; "
        f"exec 9>'{SWITCH_LOCK_PATH}'; flock -x 9; "
        "if docker container inspect \"$rollback\" >/dev/null 2>&1; then "
        "docker rm -f \"$current\" >/dev/null 2>&1 || true; "
        "docker rename \"$rollback\" \"$current\"; fi; "
        "docker container inspect \"$current\" >/dev/null 2>&1; "
        "if [ \"$(docker inspect -f '{{.State.Running}}' \"$current\")\" != 'true' ]; then docker start \"$current\"; fi; "
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
    deploy.run(
        ssh,
        f"if test -d '{build_dir}' && test ! -L '{build_dir}'; then :; "
        f"elif test ! -e '{build_dir}'; then mkdir -p '{build_dir}'; else exit 2; fi",
    )
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


def rollback_promoted_release(tag, operation_id):
    ssh = deploy.connect()
    try:
        deploy.run(ssh, rollback_command(tag, operation_id), timeout=120)
    finally:
        ssh.close()


def release_promotion_lock(operation_id):
    ssh = deploy.connect()
    try:
        deploy.run(ssh, promotion_lock_release_command(operation_id), timeout=30)
    finally:
        ssh.close()


def acquire_promotion_lock(operation_id, tag):
    ssh = deploy.connect()
    try:
        deploy.run(ssh, promotion_lock_acquire_command(operation_id, tag), timeout=30)
    except BaseException:
        try:
            release_promotion_lock(operation_id)
        except BaseException:
            pass
        raise
    finally:
        ssh.close()


def claim_stale_promotion_lock(tag, recovery_id):
    ssh = deploy.connect()
    try:
        output, _ = deploy.run(ssh, promotion_lock_recovery_claim_command(recovery_id, tag), timeout=30)
    finally:
        ssh.close()
    match = re.fullmatch(r"([0-9a-f]{32}) ([0-9]+)\s*", output)
    if not match:
        raise RuntimeError("CLOUD_DOCKER_DEPLOY_PROMOTION_LOCK_INVALID")
    return {"operationId": match.group(1), "ageSeconds": int(match.group(2))}


def verify_current_release_tag(tag):
    candidate_name(tag)
    ssh = deploy.connect()
    try:
        deploy.run(
            ssh,
            f"test \"$(docker inspect -f '{{{{.Config.Image}}}}' '{CURRENT_CONTAINER}')\" = 'gewu-cloud-business-api:{tag}'",
            timeout=30,
        )
    finally:
        ssh.close()


def heartbeat_promotion_lock(operation_id, tag):
    ssh = deploy.connect()
    try:
        deploy.run(ssh, promotion_lock_heartbeat_command(operation_id, tag), timeout=30)
    finally:
        ssh.close()


def recover_promotion_lock(tag, mode):
    if mode not in ("rollback", "preserve"):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    manifest = None
    if mode == "preserve":
        tag = validated_release_tag(tag)
        manifest = deploy.require_release_manifest("cloud_business", allowed_statuses=("pending", "verified"))
    recovery_id = secrets.token_hex(16)
    stale = claim_stale_promotion_lock(tag, recovery_id)
    if mode == "rollback":
        reconcile_uncertain_switch(tag, recovery_id)
    else:
        verify_current_release_tag(tag)
        verify_public_health(tag.split("-", 1)[0])
        heartbeat_promotion_lock(recovery_id, tag)
        if manifest["targets"]["cloud_business"]["status"] == "pending":
            deploy.record_release_receipt(
                "cloud_business",
                f"recovered promoted cloud business release verified at version {tag.split('-', 1)[0]}",
            )
    release_promotion_lock(recovery_id)
    return {"tag": tag, "mode": mode, "ageSeconds": stale["ageSeconds"]}


def reconcile_uncertain_switch(tag, operation_id):
    ssh = deploy.connect()
    try:
        deploy.run(ssh, reconcile_switch_failure_command(tag, operation_id), timeout=180)
    finally:
        ssh.close()


def promote_validated_candidate(tag, version, evidence):
    operation_id = secrets.token_hex(16)
    acquire_promotion_lock(operation_id, tag)
    try:
        return promote_candidate_under_lock(tag, version, evidence, operation_id)
    finally:
        release_promotion_lock(operation_id)


def promote_candidate_under_lock(tag, version, evidence, operation_id):
    ssh = deploy.connect()
    switch_error = None
    try:
        deploy.run(ssh, switch_command(tag, operation_id), timeout=120)
    except BaseException as error:
        switch_error = error
    finally:
        ssh.close()
    if switch_error is not None:
        try:
            reconcile_uncertain_switch(tag, operation_id)
        except BaseException as reconcile_error:
            raise RuntimeError("CLOUD_DOCKER_DEPLOY_ROLLBACK_FAILED") from reconcile_error
        raise switch_error
    try:
        heartbeat_promotion_lock(operation_id, tag)
        health = verify_public_health(version)
        heartbeat_promotion_lock(operation_id, tag)
        deploy.record_release_receipt("cloud_business", evidence)
        return health
    except BaseException as primary_error:
        try:
            rollback_promoted_release(tag, operation_id)
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
    parser.add_argument("command", choices=("deploy", "candidate", "promote", "discard", "recover-lock"))
    parser.add_argument("--tag")
    parser.add_argument("--recovery-mode", choices=("rollback", "preserve"))
    args = parser.parse_args()
    if args.command in ("discard", "recover-lock"):
        if args.command == "recover-lock" and (not args.tag or not args.recovery_mode):
            raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
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
    if args.command == "recover-lock":
        print(json.dumps(recover_promotion_lock(tag, args.recovery_mode), ensure_ascii=True, sort_keys=True))
        return
    print(json.dumps(deploy_release(), ensure_ascii=True, sort_keys=True))


if __name__ == "__main__":
    main()
