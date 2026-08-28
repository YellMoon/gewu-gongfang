#!/usr/bin/env python3
"""Provision named, non-personal cloud identities for multi-surface acceptance."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import deploy  # noqa: E402

LOCAL_SCRIPT = ROOT / "scripts" / "provision_real_test_identities.js"
REMOTE_SCRIPT = "/tmp/gewu-real-test-identities.js"
CONTAINER_SCRIPT = "/app/real-test-identities.js"
CONTAINER = "gewu-cloud-business-api"
EXPECTED_KEYS = {"visitor", "teacher", "student", "family"}


def parse_receipt(output):
    try:
        payload = json.loads([line.strip() for line in str(output).splitlines() if line.strip()][-1])
        identities = payload["identities"]
    except (IndexError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("REAL_TEST_IDENTITY_RECEIPT_INVALID") from error
    if (
        not isinstance(payload, dict)
        or payload.get("ok") is not True
        or not isinstance(payload.get("marker"), str)
        or not payload["marker"].startswith("e2e-role-test-")
        or not isinstance(identities, dict)
        or set(identities) != EXPECTED_KEYS
    ):
        raise ValueError("REAL_TEST_IDENTITY_RECEIPT_INVALID")
    for key, identity in identities.items():
        if not isinstance(identity, dict) or not isinstance(identity.get("accountId"), str) or not identity["accountId"].startswith(f"e2e-account-{key}-"):
            raise ValueError("REAL_TEST_IDENTITY_RECEIPT_INVALID")
    if identities["visitor"].get("roles") != [] or identities["teacher"].get("roles") != ["teacher"]:
        raise ValueError("REAL_TEST_IDENTITY_RECEIPT_INVALID")
    if identities["student"].get("roles") != ["student"] or identities["family"].get("roles") != ["student"]:
        raise ValueError("REAL_TEST_IDENTITY_RECEIPT_INVALID")
    if identities["student"].get("relationship") != "student" or identities["family"].get("relationship") != "guardian":
        raise ValueError("REAL_TEST_IDENTITY_RECEIPT_INVALID")
    if identities["student"].get("profileId") != identities["family"].get("profileId"):
        raise ValueError("REAL_TEST_IDENTITY_RECEIPT_INVALID")
    return payload


def main():
    if not LOCAL_SCRIPT.is_file():
        raise RuntimeError("REAL_TEST_IDENTITY_SCRIPT_MISSING")
    ssh = deploy.connect()
    copied = False
    try:
        deploy.run(ssh, f"test ! -e {REMOTE_SCRIPT}")
        deploy.run(ssh, f"docker exec {CONTAINER} test ! -e {CONTAINER_SCRIPT}")
        sftp = ssh.open_sftp()
        try:
            sftp.put(str(LOCAL_SCRIPT), REMOTE_SCRIPT)
        finally:
            sftp.close()
        copied = True
        deploy.run(ssh, f"docker cp {REMOTE_SCRIPT} {CONTAINER}:{CONTAINER_SCRIPT}")
        output, _ = deploy.run(ssh, f"docker exec {CONTAINER} node {CONTAINER_SCRIPT}", timeout=120)
        receipt = parse_receipt(output)
        print(json.dumps(receipt, ensure_ascii=True, sort_keys=True))
    finally:
        if copied:
            deploy.run(ssh, f"docker exec -u 0 {CONTAINER} rm -f -- {CONTAINER_SCRIPT}; rm -f -- {REMOTE_SCRIPT}")
        ssh.close()


if __name__ == "__main__":
    main()
