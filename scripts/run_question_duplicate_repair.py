#!/usr/bin/env python3
"""Run a guarded dry-run or cloud-authority repair for the known malformed question duplicates."""

import argparse
import hashlib
import json
import re
import secrets
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import deploy  # noqa: E402
import backup_cloud_postgres  # noqa: E402


CONTAINER = "gewu-cloud-business-api"
LOCAL_REPAIR = ROOT / "scripts" / "repair-production-question-duplicates.js"
LOCAL_HELPER = ROOT / "scripts" / "real-cloud-business-acceptance.js"
LOCAL_AUTHORITY = ROOT / "cloud-business-api" / "src" / "questionAuthorityService.js"
EXPECTED_SNAPSHOT_SET_SHA256 = "4c70264986bb30360176e92ccf659c84a14135d274cb45e1a26aa747e313a4ad"


def failure(code):
    return ValueError(code)


def operation_id():
    return secrets.token_hex(16)


def source_version():
    try:
        version = json.loads((ROOT / "cloud-business-api" / "package.json").read_text(encoding="utf-8"))["version"]
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise failure("QUESTION_DUPLICATE_REPAIR_CONFIG_INVALID") from error
    if not isinstance(version, str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]+){2}", version):
        raise failure("QUESTION_DUPLICATE_REPAIR_CONFIG_INVALID")
    return version


def source_revision():
    result = subprocess.run(
        ["git", "rev-parse", "--short=12", "HEAD"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    revision = result.stdout.strip()
    if not re.fullmatch(r"[0-9a-f]{12}", revision):
        raise failure("QUESTION_DUPLICATE_REPAIR_CONFIG_INVALID")
    return revision


def authority_sha256():
    if not LOCAL_AUTHORITY.is_file():
        raise failure("QUESTION_DUPLICATE_REPAIR_CONFIG_INVALID")
    return hashlib.sha256(LOCAL_AUTHORITY.read_bytes()).hexdigest()


def verified_backup():
    backup = backup_cloud_postgres.create_backup()
    if (not isinstance(backup, dict) or backup.get("restoreVerified") is not True
            or re.fullmatch(r"/root/scheduling-backups/postgres/[0-9]{8}-[0-9]{6}", str(backup.get("root", ""))) is None
            or re.fullmatch(r"[0-9a-f]{64}", str(backup.get("sha256", ""))) is None):
        raise failure("QUESTION_DUPLICATE_REPAIR_BACKUP_INVALID")
    return backup


def parse_receipt(output, mode):
    if mode not in ("dry-run", "apply"):
        raise failure("QUESTION_DUPLICATE_REPAIR_CONFIG_INVALID")
    try:
        lines = [line.strip() for line in str(output).splitlines() if line.strip()]
        payload = json.loads(lines[-1])
    except (IndexError, TypeError, json.JSONDecodeError) as error:
        raise failure("QUESTION_DUPLICATE_REPAIR_RECEIPT_INVALID") from error
    common = (
        isinstance(payload, dict)
        and payload.get("ok") is True
        and payload.get("mode") == mode
        and payload.get("canonicalActiveCount") == 2
        and payload.get("snapshotReferenceCount") == 4
        and payload.get("snapshotTaskCount") == 2
        and payload.get("snapshotSetSha256") == EXPECTED_SNAPSHOT_SET_SHA256
        and re.fullmatch(r"[0-9a-f]{64}", payload.get("targetIdentitySetSha256", "")) is not None
        and payload.get("activePublishedSourceCount") == 2
        and isinstance(payload.get("activePublishedCount"), int)
        and isinstance(payload.get("activePublishedOptionCount"), int)
    )
    if not common:
        raise failure("QUESTION_DUPLICATE_REPAIR_RECEIPT_INVALID")
    if mode == "dry-run":
        valid = (payload.get("ready") in (True, False)
                 and payload.get("malformedActiveCount") in (0, 14)
                 and payload.get("commandReceiptCount") in (0, 14)
                 and (payload.get("commandReceiptSetSha256") is None
                      or re.fullmatch(r"[0-9a-f]{64}", payload.get("commandReceiptSetSha256", "")) is not None))
    else:
        valid = (payload.get("deletedCount") == 14 and payload.get("malformedActiveCount") == 0
                 and isinstance(payload.get("replayed"), bool)
                 and payload.get("activePublishedCount") == 2
                 and payload.get("activePublishedOptionCount") == 8
                 and payload.get("commandReceiptCount") == 14
                 and re.fullmatch(r"[0-9a-f]{64}", payload.get("commandReceiptSetSha256", "")) is not None)
    if not valid:
        raise failure("QUESTION_DUPLICATE_REPAIR_RECEIPT_INVALID")
    return payload


def run(mode):
    if (mode not in ("dry-run", "apply") or not LOCAL_REPAIR.is_file()
            or not LOCAL_HELPER.is_file() or not LOCAL_AUTHORITY.is_file()):
        raise failure("QUESTION_DUPLICATE_REPAIR_CONFIG_INVALID")
    current_operation = operation_id()
    if not re.fullmatch(r"[0-9a-f]{32}", current_operation):
        raise failure("QUESTION_DUPLICATE_REPAIR_CONFIG_INVALID")
    remote_dir = f"/tmp/gewu-question-duplicate-repair-{current_operation}"
    container_dir = f"/app/question-repair-{current_operation}"
    container_repair = f"{container_dir}/repair-production-question-duplicates.js"
    container_helper = f"{container_dir}/real-cloud-business-acceptance.js"
    version = source_version()
    revision = source_revision()
    authority_hash = authority_sha256()
    ssh = deploy.connect()
    staging_created = False
    container_dir_created = False
    backup = None
    try:
        deploy.run(
            ssh,
            f"test \"$(docker inspect -f '{{{{.Config.Image}}}}' {CONTAINER})\" = "
            f"'gewu-cloud-business-api:{version}-{revision}'",
        )
        if mode == "apply":
            backup = verified_backup()
        deploy.run(ssh, f"test ! -e '{remote_dir}' && mkdir -m 700 '{remote_dir}'")
        staging_created = True
        deploy.run(
            ssh,
            f"docker exec -u 0 {CONTAINER} mkdir -m 755 '{container_dir}'",
        )
        container_dir_created = True
        sftp = ssh.open_sftp()
        try:
            sftp.put(str(LOCAL_REPAIR), f"{remote_dir}/repair-production-question-duplicates.js")
            sftp.put(str(LOCAL_HELPER), f"{remote_dir}/real-cloud-business-acceptance.js")
        finally:
            sftp.close()
        deploy.run(
            ssh,
            f"docker cp '{remote_dir}/repair-production-question-duplicates.js' {CONTAINER}:{container_repair} "
            f"&& docker cp '{remote_dir}/real-cloud-business-acceptance.js' {CONTAINER}:{container_helper}",
        )
        apply_flag = " --apply" if mode == "apply" else ""
        output, _ = deploy.run(
            ssh,
            f"docker exec -e EXPECTED_CLOUD_VERSION='{version}' "
            f"-e EXPECTED_QUESTION_AUTHORITY_SHA256='{authority_hash}' "
            f"{CONTAINER} node '{container_repair}'{apply_flag}",
            timeout=300,
        )
        receipt = parse_receipt(output, mode)
        return {**receipt, **({"backup": backup} if backup is not None else {})}
    finally:
        try:
            try:
                if container_dir_created:
                    deploy.run(ssh, f"docker exec -u 0 {CONTAINER} rm -rf -- '{container_dir}'")
            finally:
                if staging_created:
                    deploy.run(ssh, f"rm -rf -- '{remote_dir}'")
        finally:
            ssh.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("dry-run", "apply"))
    args = parser.parse_args()
    print(json.dumps(run(args.mode), ensure_ascii=True, sort_keys=True))


if __name__ == "__main__":
    main()
