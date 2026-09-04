#!/usr/bin/env python3
"""Deploy the PostgreSQL-backed cloud business API as a verified Docker release."""

import argparse
import errno
import hashlib
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
import backup_cloud_postgres  # noqa: E402
import deploy_gateway as retirement_gateway  # noqa: E402
import verify_cloud_business_release  # noqa: E402


CURRENT_CONTAINER = "gewu-cloud-business-api"
POSTGRES_CONTAINER = "gewu-postgres17"
REMOTE_BUILD_ROOT = "/root/gewu-cloud-business-builds"
SWITCH_LOCK_PATH = "/tmp/gewu-cloud-business-api-switch.lock"
PROMOTION_LOCK_PATH = "/tmp/gewu-cloud-business-api-promotion.lock"
PROMOTION_GUARD_LOCK_PATH = "/tmp/gewu-cloud-business-api-promotion-guard.lock"
TAG_PATTERN = re.compile(r"^[0-9]+(?:\.[0-9]+){2}-[0-9a-f]{7,40}$")
OPERATION_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
PROMOTION_LOCK_STALE_SECONDS = 900
CANDIDATE_OPERATION_LABEL = "gewu.candidate-operation"


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


def runtime_override_env_path(tag, operation_id):
    if not isinstance(tag, str) or not TAG_PATTERN.fullmatch(tag):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    if not isinstance(operation_id, str) or not OPERATION_ID_PATTERN.fullmatch(operation_id):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    return f"/tmp/gewu-cloud-business-{tag}-{operation_id}.override.env"


def cloud_runtime_overrides(environ=None, *, expected_appid=None):
    env = os.environ if environ is None else environ
    if expected_appid is None:
        try:
            expected_appid = json.loads((ROOT / "miniapp" / "project.config.json").read_text(encoding="utf-8"))["appid"]
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise failure("CLOUD_DOCKER_WECHAT_CONFIG_INVALID") from error
    appid = str(env.get("WECHAT_APPID") or "").strip()
    appsecret = str(env.get("WECHAT_APPSECRET") or "").strip()
    env_version = str(env.get("WECHAT_MINIAPP_LOGIN_ENV_VERSION") or env.get("WECHAT_MINIAPP_ENV_VERSION") or "release").strip()
    if (not isinstance(expected_appid, str)
            or not re.fullmatch(r"wx[0-9a-f]{16}", expected_appid)
            or appid != expected_appid
            or not re.fullmatch(r"[A-Za-z0-9]{32}", appsecret)
            or env_version not in {"develop", "trial", "release"}):
        raise failure("CLOUD_DOCKER_WECHAT_CONFIG_INVALID")
    return {
        "WECHAT_APPID": appid,
        "WECHAT_APPSECRET": appsecret,
        "WECHAT_MINIAPP_LOGIN_ENV_VERSION": env_version,
    }


def upload_runtime_override_file(ssh, tag, operation_id, values=None):
    override_path = runtime_override_env_path(tag, operation_id)
    runtime_values = cloud_runtime_overrides() if values is None else values
    if set(runtime_values) != {"WECHAT_APPID", "WECHAT_APPSECRET", "WECHAT_MINIAPP_LOGIN_ENV_VERSION"}:
        raise failure("CLOUD_DOCKER_WECHAT_CONFIG_INVALID")
    if (not re.fullmatch(r"wx[0-9a-f]{16}", str(runtime_values["WECHAT_APPID"]))
            or not re.fullmatch(r"[A-Za-z0-9]{32}", str(runtime_values["WECHAT_APPSECRET"]))
            or runtime_values["WECHAT_MINIAPP_LOGIN_ENV_VERSION"] not in {"develop", "trial", "release"}):
        raise failure("CLOUD_DOCKER_WECHAT_CONFIG_INVALID")
    payload = "".join(f"{key}={runtime_values[key]}\n" for key in (
        "WECHAT_APPID", "WECHAT_APPSECRET", "WECHAT_MINIAPP_LOGIN_ENV_VERSION",
    ))
    if "\r" in payload or "\x00" in payload:
        raise failure("CLOUD_DOCKER_WECHAT_CONFIG_INVALID")
    sftp = ssh.open_sftp()
    try:
        with sftp.open(override_path, "w") as handle:
            handle.write(payload)
        sftp.chmod(override_path, 0o600)
    finally:
        sftp.close()
    return override_path


def remove_runtime_override_file(ssh, tag, operation_id):
    override_path = runtime_override_env_path(tag, operation_id)
    sftp = ssh.open_sftp()
    try:
        try:
            sftp.remove(override_path)
        except OSError as error:
            if getattr(error, "errno", None) != errno.ENOENT:
                raise
    finally:
        sftp.close()


def candidate_command(tag, operation_id):
    if not isinstance(operation_id, str) or not OPERATION_ID_PATTERN.fullmatch(operation_id):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    image = f"gewu-cloud-business-api:{tag}"
    candidate = candidate_name(tag)
    env_path = remote_env_path(tag)
    override_path = runtime_override_env_path(tag, operation_id)
    return (
        "set -eu; "
        f"current='{CURRENT_CONTAINER}'; candidate='{candidate}'; env_path='{env_path}'; override_path='{override_path}'; owner='{operation_id}'; "
        "trap 'rm -f -- \"$env_path\" \"$override_path\"' EXIT; "
        "network=$(docker inspect -f '{{range $key, $_ := .NetworkSettings.Networks}}{{$key}}{{end}}' \"$current\"); "
        "test -n \"$network\"; "
        "test -f \"$override_path\" && test ! -L \"$override_path\"; "
        "docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' \"$current\" > \"$env_path\"; "
        "sed -i '/^CLOUD_PAPER_EXPORT_WORKER_ENABLED=/d;/^WECHAT_APPID=/d;/^WECHAT_APPSECRET=/d;/^WECHAT_MINIAPP_LOGIN_ENV_VERSION=/d' \"$env_path\"; "
        "printf '%s\\n' 'CLOUD_PAPER_EXPORT_WORKER_ENABLED=1' >> \"$env_path\"; cat \"$override_path\" >> \"$env_path\"; "
        "chmod 600 \"$env_path\"; "
        "if docker container inspect \"$candidate\" >/dev/null 2>&1; then exit 2; fi; "
        f"docker run -d --name \"$candidate\" --network \"$network\" --restart no --env-file \"$env_path\" -p 127.0.0.1:3003:3002 --label {CANDIDATE_OPERATION_LABEL}=\"{operation_id}\" '{image}'; "
        "for attempt in 1 2 3 4 5 6 7 8 9 10; do "
        "curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3003/api/health && exit 0; sleep 1; done; exit 1"
    )


def discard_candidate_command(tag, operation_id=None):
    candidate = candidate_name(tag)
    if operation_id is None:
        return f"docker rm -f -- '{candidate}'"
    if not isinstance(operation_id, str) or not OPERATION_ID_PATTERN.fullmatch(operation_id):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    return (
        "set -eu; "
        f"candidate='{candidate}'; owner='{operation_id}'; "
        f"actual=$(docker inspect -f '{{{{ index .Config.Labels \"{CANDIDATE_OPERATION_LABEL}\" }}}}' \"$candidate\" 2>/dev/null || true); "
        "if [ \"$actual\" = \"$owner\" ]; then docker rm -f -- \"$candidate\"; fi"
    )


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
        + "trap 'rm -f -- \"$env_path\"' EXIT; "
        f"exec 9>'{SWITCH_LOCK_PATH}'; flock -x 9; "
        "network=$(docker inspect -f '{{range $key, $_ := .NetworkSettings.Networks}}{{$key}}{{end}}' \"$current\"); "
        "test -n \"$network\"; "
        # Promote the exact environment that passed candidate health checks,
        # including the securely supplied WeChat runtime identity.
        "docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' \"$candidate\" > \"$env_path\"; "
        "sed -i '/^CLOUD_PAPER_EXPORT_WORKER_ENABLED=/d' \"$env_path\"; printf '%s\\n' 'CLOUD_PAPER_EXPORT_WORKER_ENABLED=1' >> \"$env_path\"; "
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
    created_directories = set()

    def ensure_directory(remote_directory):
        if remote_directory in created_directories:
            return
        current = ""
        for part in remote_directory.split("/"):
            if not part:
                continue
            current += "/" + part
            try:
                sftp.stat(current)
            except OSError:
                sftp.mkdir(current)
        created_directories.add(remote_directory)
    try:
        for top_level in ("cloud-business-api", "shared"):
            local_top = ROOT / top_level
            for local_path in local_top.rglob("*"):
                if not local_path.is_file() or "node_modules" in local_path.parts:
                    continue
                relative = local_path.relative_to(ROOT).as_posix()
                remote_path = posixpath.join(build_dir, relative)
                remote_parent = posixpath.dirname(remote_path)
                ensure_directory(remote_parent)
                sftp.put(str(local_path), remote_path)
        font = ROOT / "backend" / "assets" / "fonts" / "NotoSansCJKsc-Regular.otf"
        if not font.is_file():
            raise failure("CLOUD_DOCKER_DEPLOY_FONT_MISSING")
        font_target = posixpath.join(build_dir, "backend", "assets", "fonts", font.name)
        ensure_directory(posixpath.dirname(font_target))
        sftp.put(str(font), font_target)
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
    control_m23 = subprocess.run([sys.executable, str(ROOT / "scripts" / "apply_cloud_control_plane_m23.py")], cwd=ROOT, check=True, text=True)
    control_m24 = subprocess.run([sys.executable, str(ROOT / "scripts" / "apply_cloud_control_plane_m24.py")], cwd=ROOT, check=True, text=True)
    control_m25 = subprocess.run([sys.executable, str(ROOT / "scripts" / "apply_cloud_control_plane_m25.py")], cwd=ROOT, check=True, text=True)
    control_m26 = subprocess.run([sys.executable, str(ROOT / "scripts" / "apply_cloud_control_plane_m26.py")], cwd=ROOT, check=True, text=True)
    control_m27 = subprocess.run([sys.executable, str(ROOT / "scripts" / "apply_cloud_control_plane_m27.py")], cwd=ROOT, check=True, text=True)
    control_m28 = subprocess.run([sys.executable, str(ROOT / "scripts" / "apply_cloud_control_plane_m28.py")], cwd=ROOT, check=True, text=True)
    business = subprocess.run([sys.executable, str(ROOT / "scripts" / "apply_cloud_postgres_migrations.py")], cwd=ROOT, check=True, text=True)
    return max(control_m20.returncode, control_m21.returncode, control_m22.returncode, control_m23.returncode, control_m24.returncode, control_m25.returncode, control_m26.returncode, control_m27.returncode, control_m28.returncode, business.returncode)


def create_verified_backup():
    backup = backup_cloud_postgres.create_backup(
        container=POSTGRES_CONTAINER,
        database="gewu_cloud",
        role="gewu_app",
    )
    root = backup.get("root") if isinstance(backup, dict) else None
    sha256 = backup.get("sha256") if isinstance(backup, dict) else None
    if (not isinstance(root, str)
            or not re.fullmatch(r"/root/scheduling-backups/postgres/[0-9]{8}-[0-9]{6}", root)
            or not isinstance(sha256, str)
            or not re.fullmatch(r"[0-9a-f]{64}", sha256)
            or backup.get("dump") != f"{root}/gewu_cloud.dump"
            or backup.get("checksum") != f"{root}/gewu_cloud.dump.sha256"
            or backup.get("metadata") != f"{root}/metadata.json"
            or backup.get("restoreVerified") is not True):
        raise RuntimeError("CLOUD_POSTGRES_BACKUP_VERIFICATION_FAILED")
    return backup


def contract_sha256(payload):
    if not isinstance(payload, dict):
        raise RuntimeError("CLOUD_RELEASE_EVIDENCE_INVALID")
    try:
        canonical = json.dumps(payload, ensure_ascii=True, allow_nan=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError) as error:
        raise RuntimeError("CLOUD_RELEASE_EVIDENCE_INVALID") from error
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def verified_release_evidence(version, backup, health, permission_contract):
    if (not isinstance(version, str)
            or not re.fullmatch(r"[0-9]+(?:\.[0-9]+){2}", version)
            or not isinstance(backup, dict)
            or backup.get("restoreVerified") is not True
            or not isinstance(health, dict)
            or health.get("ok") is not True
            or health.get("businessAuthority") != "cloud"
            or health.get("version") != version):
        raise RuntimeError("CLOUD_RELEASE_EVIDENCE_INVALID")
    try:
        verified_permission_contract = verify_cloud_business_release.validate(dict(permission_contract))
    except (TypeError, ValueError) as error:
        raise RuntimeError("CLOUD_RELEASE_EVIDENCE_INVALID") from error
    return (
        f"public cloud business health verified at version {version}; "
        f"public retirement gateway health, four authority tombstones, and websocket rejection verified at version {version}; "
        f"healthContractSha256={contract_sha256(health)}; "
        f"authorityContractSha256={contract_sha256(verified_permission_contract)}; "
        f"pre-migration PostgreSQL backup restore-verified=true at {backup['root']} "
        f"sha256={backup['sha256']}"
    )


def health_url():
    return "https://physicsedu.xyz/cloud-business/api/health"


def gateway_base_url():
    return "https://physicsedu.xyz/scheduling"


def deploy_retirement_gateway():
    return retirement_gateway.deploy_retired_gateway()


def verify_public_gateway_retirement(expected_version):
    if not isinstance(expected_version, str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]+){2}", expected_version):
        raise failure("CLOUD_DOCKER_DEPLOY_CONFIG_INVALID")
    ssh = deploy.connect()
    try:
        output, _ = deploy.run(
            ssh,
            f"curl --fail --silent --show-error --max-time 30 '{gateway_base_url()}/api/health'",
            timeout=45,
        )
        try:
            payload = json.loads(output)
        except json.JSONDecodeError as error:
            raise RuntimeError("GATEWAY_RETIREMENT_HEALTH_INVALID") from error
        if (payload.get("ok") is not True
                or payload.get("version") != expected_version
                or payload.get("legacyAuthority") != "retired"):
            raise RuntimeError("GATEWAY_RETIREMENT_HEALTH_INVALID")
        for route in (
                "/api/cloud/commands",
                "/api/auth/login",
                "/api/admin/users",
                "/api/permissions/my"):
            status, _ = deploy.run(
                ssh,
                f"curl --silent --output /dev/null --write-out '%{{http_code}}' --max-time 30 "
                f"'{gateway_base_url()}{route}'",
                timeout=45,
            )
            if status.strip() != "410":
                raise RuntimeError("GATEWAY_RETIREMENT_TOMBSTONE_INVALID")
        for route in ("/ws/authority", "/ws/cloud-relay"):
            status, _ = deploy.run(
                ssh,
                f"curl --http1.1 --silent --output /dev/null --write-out '%{{http_code}}' --max-time 30 "
                f"--header 'Connection: Upgrade' --header 'Upgrade: websocket' "
                f"'{gateway_base_url()}{route}'",
                timeout=45,
            )
            normalized_status = status.strip()
            if not re.fullmatch(r"[1-5][0-9]{2}", normalized_status) or normalized_status == "101":
                raise RuntimeError("GATEWAY_RETIREMENT_WEBSOCKET_INVALID")
        return payload
    finally:
        ssh.close()


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
    verify_public_gateway_retirement(expected_version)
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
        manifest = deploy.require_release_manifest("cloud_business", allowed_statuses=("verified",))
    recovery_id = secrets.token_hex(16)
    stale = claim_stale_promotion_lock(tag, recovery_id)
    if mode == "rollback":
        reconcile_uncertain_switch(tag, recovery_id)
    else:
        verify_current_release_tag(tag)
        verify_public_health(tag.split("-", 1)[0])
        verify_cloud_business_release.verify()
        heartbeat_promotion_lock(recovery_id, tag)
        if manifest["targets"]["cloud_business"]["status"] != "verified":
            raise RuntimeError("CLOUD_RECOVERY_RECEIPT_REQUIRED")
    release_promotion_lock(recovery_id)
    return {"tag": tag, "mode": mode, "ageSeconds": stale["ageSeconds"]}


def reconcile_uncertain_switch(tag, operation_id):
    ssh = deploy.connect()
    try:
        deploy.run(ssh, reconcile_switch_failure_command(tag, operation_id), timeout=180)
    finally:
        ssh.close()


def promote_validated_candidate(tag, version, backup):
    operation_id = secrets.token_hex(16)
    acquire_promotion_lock(operation_id, tag)
    try:
        return promote_candidate_under_lock(tag, version, backup, operation_id)
    finally:
        release_promotion_lock(operation_id)


def promote_candidate_under_lock(tag, version, backup, operation_id):
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
        verify_current_release_tag(tag)
        heartbeat_promotion_lock(operation_id, tag)
        health = verify_public_health(version)
        heartbeat_promotion_lock(operation_id, tag)
        permission_contract = verify_cloud_business_release.verify()
        heartbeat_promotion_lock(operation_id, tag)
        evidence = verified_release_evidence(version, backup, health, permission_contract)
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
    candidate_operation_id = secrets.token_hex(16)
    ssh = deploy.connect()
    runtime_override_uploaded = False
    try:
        upload_source(ssh, tag)
        build_image(ssh, tag)
        backup = create_verified_backup()
        deploy_retirement_gateway()
        # The candidate starts with strict schema/invariant verification. Apply
        # additive migrations only after a fresh, verified recovery point exists.
        run_cloud_migrations()
        upload_runtime_override_file(ssh, tag, candidate_operation_id)
        runtime_override_uploaded = True
        try:
            deploy.run(ssh, candidate_command(tag, candidate_operation_id), timeout=90)
        except Exception:
            # docker can leave a created candidate behind when port binding or
            # startup fails. Remove only this release's exact candidate so a
            # subsequent verified retry is not blocked by stale state.
            try:
                deploy.run(ssh, discard_candidate_command(tag, candidate_operation_id), timeout=30)
            except Exception:
                pass
            raise
    finally:
        try:
            if runtime_override_uploaded:
                remove_runtime_override_file(ssh, tag, candidate_operation_id)
        finally:
            ssh.close()
    return promote_validated_candidate(
        tag,
        version,
        backup,
    )


def promote_release(tag):
    del tag
    raise RuntimeError("CLOUD_STANDALONE_PROMOTION_RETIRED")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("deploy", "discard", "recover-lock"))
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
