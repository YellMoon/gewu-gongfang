#!/usr/bin/env python3
"""Provision named, non-personal cloud identities for multi-surface acceptance."""

import json
import shlex
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import deploy  # noqa: E402

LOCAL_SCRIPT = ROOT / "scripts" / "provision_real_test_identities.js"
REMOTE_SCRIPT = "/tmp/gewu-real-test-identities.js"
CONTAINER_SCRIPT = "/app/real-test-identities.js"
CONTAINER = "gewu-cloud-business-api"
EXPECTED_KEYS = {"visitor", "teacher", "student", "family"}


def native_ssh_command(*, host, port, user, key_path, known_hosts, remote_command):
    command = ["ssh", "-p", str(port), "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=20"]
    if known_hosts:
        command.extend(["-o", f"UserKnownHostsFile={known_hosts}"])
    if key_path:
        command.extend(["-i", str(key_path)])
    command.extend([f"{user}@{host}", remote_command])
    return command


def native_scp_command(*, host, port, user, key_path, known_hosts, source, destination):
    command = ["scp", "-P", str(port), "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=20"]
    if known_hosts:
        command.extend(["-o", f"UserKnownHostsFile={known_hosts}"])
    if key_path:
        command.extend(["-i", str(key_path)])
    command.extend([str(source), f"{user}@{host}:{destination}"])
    return command


def native_failure(code, result):
    detail = (result.stderr or result.stdout or "").strip().replace("\n", " ")[-500:]
    return RuntimeError(f"{code}:{detail}" if detail else code)


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
    if identities["student"].get("roles") != ["student"] or identities["family"].get("roles") != ["family_member"]:
        raise ValueError("REAL_TEST_IDENTITY_RECEIPT_INVALID")
    if identities["student"].get("relationship") != "student" or identities["family"].get("relationship") != "guardian":
        raise ValueError("REAL_TEST_IDENTITY_RECEIPT_INVALID")
    if identities["student"].get("profileId") != identities["family"].get("profileId"):
        raise ValueError("REAL_TEST_IDENTITY_RECEIPT_INVALID")
    return payload


def provision_with_paramiko(ssh):
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


def provision_with_native_ssh():
    token = uuid.uuid4().hex
    remote_script = f"/tmp/gewu-real-test-identities-{token}.js"
    container_script = f"/app/real-test-identities-{token}.js"
    copied = False
    try:
        copied_result = subprocess.run(
            native_scp_command(host=deploy.HOST, port=deploy.PORT, user=deploy.USER, key_path=deploy.KEY_PATH,
                               known_hosts=deploy.GEWU_SSH_KNOWN_HOSTS, source=LOCAL_SCRIPT, destination=remote_script),
            capture_output=True, text=True, timeout=60,
        )
        if copied_result.returncode:
            raise native_failure("REAL_TEST_IDENTITY_NATIVE_COPY_FAILED", copied_result)
        copied = True
        remote_command = (
            f"docker cp {shlex.quote(remote_script)} {shlex.quote(CONTAINER + ':' + container_script)}"
            f" && docker exec {shlex.quote(CONTAINER)} node {shlex.quote(container_script)}"
        )
        result = subprocess.run(
            native_ssh_command(host=deploy.HOST, port=deploy.PORT, user=deploy.USER, key_path=deploy.KEY_PATH,
                               known_hosts=deploy.GEWU_SSH_KNOWN_HOSTS, remote_command=remote_command),
            capture_output=True, text=True, timeout=150,
        )
        if result.returncode:
            raise native_failure("REAL_TEST_IDENTITY_NATIVE_PROVISION_FAILED", result)
        receipt = parse_receipt(result.stdout)
        print(json.dumps(receipt, ensure_ascii=True, sort_keys=True))
    finally:
        if copied:
            cleanup_command = f"docker exec -u 0 {shlex.quote(CONTAINER)} rm -f -- {shlex.quote(container_script)}; rm -f -- {shlex.quote(remote_script)}"
            cleanup = subprocess.run(
                native_ssh_command(host=deploy.HOST, port=deploy.PORT, user=deploy.USER, key_path=deploy.KEY_PATH,
                                   known_hosts=deploy.GEWU_SSH_KNOWN_HOSTS, remote_command=cleanup_command),
                capture_output=True, text=True, timeout=45,
            )
            if cleanup.returncode:
                print("REAL_TEST_IDENTITY_NATIVE_CLEANUP_PENDING", file=sys.stderr)


def main():
    if not LOCAL_SCRIPT.is_file():
        raise RuntimeError("REAL_TEST_IDENTITY_SCRIPT_MISSING")
    try:
        ssh = deploy.connect()
    except (OSError, deploy.paramiko.SSHException):
        return provision_with_native_ssh()
    return provision_with_paramiko(ssh)


if __name__ == "__main__":
    main()
