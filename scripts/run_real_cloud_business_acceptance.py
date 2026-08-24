#!/usr/bin/env python3
"""Run one reversible public cloud-business mutation acceptance from the live container."""

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import deploy  # noqa: E402


LOCAL_SCRIPT = ROOT / "scripts" / "real-cloud-business-acceptance.js"
REMOTE_SCRIPT = "/tmp/gewu-real-cloud-business-acceptance.js"
CONTAINER_SCRIPT = "/app/real-cloud-business-acceptance.js"
CONTAINER = "gewu-cloud-business-api"
POSTGRES_CONTAINER = "gewu-postgres17"
RECEIPT_KEYS = {
    "ok",
    "version",
    "createStatus",
    "readBack",
    "updateStatus",
    "staleConflictStatus",
    "deleteStatus",
    "absenceConfirmed",
    "cleanupConfirmed",
    "markerSha256",
    "onlineRegistrationStatus",
    "onlineSessionContextStatus",
    "onlineRegistrationReplayed",
    "onlineReceiptSha256",
    "miniappAssetImportStatus",
    "miniappAssetReplayStatus",
    "miniappAssetReadBack",
    "miniappAssetCleanupConfirmed",
}


def remote_preflight_command():
    return f"test ! -e {REMOTE_SCRIPT}"


def container_preflight_command():
    return f"docker exec {CONTAINER} test ! -e {CONTAINER_SCRIPT}"


def copy_command():
    return f"docker cp {REMOTE_SCRIPT} {CONTAINER}:{CONTAINER_SCRIPT}"


def execute_command():
    return f"docker exec {CONTAINER} node {CONTAINER_SCRIPT}"


def grant_owner_command():
    return (
        f"docker exec {POSTGRES_CONTAINER} psql -U gewu_app -d gewu_cloud -v ON_ERROR_STOP=1 "
        "-c 'GRANT vnext_pg17_owner TO vnext_pg17_writer'"
    )


def revoke_owner_command():
    return (
        f"docker exec {POSTGRES_CONTAINER} psql -U gewu_app -d gewu_cloud -v ON_ERROR_STOP=1 "
        "-c 'REVOKE vnext_pg17_owner FROM vnext_pg17_writer'"
    )


def cleanup_command():
    return f"docker exec -u 0 {CONTAINER} rm -f -- {CONTAINER_SCRIPT}; rm -f -- {REMOTE_SCRIPT}"


def parse_receipt(output):
    try:
        lines = [line.strip() for line in str(output).splitlines() if line.strip()]
        payload = json.loads(lines[-1])
    except (IndexError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("REAL_CLOUD_ACCEPTANCE_RECEIPT_INVALID") from error
    valid = (
        isinstance(payload, dict)
        and set(payload) == RECEIPT_KEYS
        and payload.get("ok") is True
        and isinstance(payload.get("version"), str)
        and payload.get("createStatus") == 201
        and payload.get("readBack") is True
        and payload.get("updateStatus") == 200
        and payload.get("staleConflictStatus") == 409
        and payload.get("deleteStatus") == 200
        and payload.get("absenceConfirmed") is True
        and payload.get("cleanupConfirmed") is True
        and isinstance(payload.get("markerSha256"), str)
        and len(payload["markerSha256"]) == 64
        and all(character in "0123456789abcdef" for character in payload["markerSha256"])
        and payload.get("onlineRegistrationStatus") == 200
        and payload.get("onlineSessionContextStatus") == 200
        and payload.get("onlineRegistrationReplayed") is False
        and isinstance(payload.get("onlineReceiptSha256"), str)
        and len(payload["onlineReceiptSha256"]) == 64
        and all(character in "0123456789abcdef" for character in payload["onlineReceiptSha256"])
        and payload.get("miniappAssetImportStatus") == 202
        and payload.get("miniappAssetReplayStatus") == 200
        and payload.get("miniappAssetReadBack") is True
        and payload.get("miniappAssetCleanupConfirmed") is True
    )
    if not valid:
        raise ValueError("REAL_CLOUD_ACCEPTANCE_RECEIPT_INVALID")
    return payload


def run_acceptance():
    if not LOCAL_SCRIPT.is_file():
        raise RuntimeError("REAL_CLOUD_ACCEPTANCE_SCRIPT_MISSING")
    ssh = deploy.connect()
    cleanup_required = False
    owner_granted = False
    try:
        deploy.run(ssh, remote_preflight_command())
        deploy.run(ssh, container_preflight_command())
        sftp = ssh.open_sftp()
        try:
            sftp.put(str(LOCAL_SCRIPT), REMOTE_SCRIPT)
        finally:
            sftp.close()
        cleanup_required = True
        deploy.run(ssh, copy_command())
        deploy.run(ssh, grant_owner_command())
        owner_granted = True
        try:
            output, _ = deploy.run(ssh, execute_command(), timeout=120)
        finally:
            deploy.run(ssh, revoke_owner_command())
            owner_granted = False
        return parse_receipt(output)
    finally:
        if owner_granted:
            deploy.run(ssh, revoke_owner_command())
        if cleanup_required:
            deploy.run(ssh, cleanup_command())
        ssh.close()


def cleanup_only():
    ssh = deploy.connect()
    try:
        deploy.run(ssh, revoke_owner_command())
        deploy.run(ssh, cleanup_command())
    finally:
        ssh.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cleanup-only", action="store_true")
    args = parser.parse_args()
    if args.cleanup_only:
        cleanup_only()
        print(json.dumps({"ok": True, "cleanupOnly": True}, ensure_ascii=True, sort_keys=True))
        return
    receipt = run_acceptance()
    print(json.dumps(receipt, ensure_ascii=True, sort_keys=True))


if __name__ == "__main__":
    main()
