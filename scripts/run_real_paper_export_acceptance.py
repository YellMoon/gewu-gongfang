#!/usr/bin/env python3
"""Generate, fetch and preserve real Word/PDF paper exports for local parse/render verification."""

import hashlib
import json
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import deploy  # noqa: E402


CONTAINER = "gewu-cloud-business-api"
LOCAL_SCRIPT = ROOT / "scripts" / "real-paper-export-acceptance.js"
LOCAL_CLOUD_HELPER = ROOT / "scripts" / "real-cloud-business-acceptance.js"
REMOTE_DIR = "/tmp/gewu-real-paper-export"
CONTAINER_SCRIPT = "/app/real-paper-export-acceptance.js"
CONTAINER_HELPER = "/app/real-cloud-business-acceptance.js"
ARTIFACTS = {
    "pdf": ("/tmp/gewu-real-paper-export-pdf.pdf", "real-paper-export.pdf"),
    "word": ("/tmp/gewu-real-paper-export-word.docx", "real-paper-export.docx"),
}
LOCAL_OUTPUT_DIR = Path.home() / "AppData" / "Local" / "Temp" / "gewu-real-paper-export"


def receipt(output):
    try:
        value = json.loads([line for line in str(output).splitlines() if line.strip()][-1])
    except (IndexError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("REAL_PAPER_EXPORT_RECEIPT_INVALID") from error
    artifacts = value.get("artifacts") if isinstance(value, dict) else None
    if value.get("ok") is not True or not isinstance(artifacts, list) or len(artifacts) != 2:
        raise ValueError("REAL_PAPER_EXPORT_RECEIPT_INVALID")
    if {item.get("format") for item in artifacts if isinstance(item, dict)} != {"pdf", "word"}:
        raise ValueError("REAL_PAPER_EXPORT_RECEIPT_INVALID")
    for item in artifacts:
        if not isinstance(item.get("bytes"), int) or item["bytes"] < 8 or not isinstance(item.get("sha256"), str) or len(item["sha256"]) != 64 or not isinstance(item.get("path"), str):
            raise ValueError("REAL_PAPER_EXPORT_RECEIPT_INVALID")
    return value


def copy_artifact_command(format_name):
    source, destination = ARTIFACTS[format_name]
    return f"docker cp {CONTAINER}:{source} '{REMOTE_DIR}/{destination}'"


def prepare_command():
    paths = " ".join(repr(source) for source, _ in ARTIFACTS.values())
    return f"docker exec -u 0 {CONTAINER} rm -f -- '{CONTAINER_SCRIPT}' '{CONTAINER_HELPER}' {paths}; rm -rf -- '{REMOTE_DIR}' && mkdir -p '{REMOTE_DIR}'"


def copy_verification_command():
    return f"docker exec {CONTAINER} test -s '{CONTAINER_SCRIPT}' && docker exec {CONTAINER} test -s '{CONTAINER_HELPER}'"


def cleanup_command():
    paths = " ".join(repr(source) for source, _ in ARTIFACTS.values())
    return f"docker exec -u 0 {CONTAINER} rm -f -- '{CONTAINER_SCRIPT}' '{CONTAINER_HELPER}' {paths}; rm -rf -- '{REMOTE_DIR}'"


def run():
    if not LOCAL_SCRIPT.is_file() or not LOCAL_CLOUD_HELPER.is_file():
        raise RuntimeError("REAL_PAPER_EXPORT_SOURCE_MISSING")
    LOCAL_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ssh = deploy.connect()
    uploaded = False
    try:
        deploy.run(ssh, prepare_command())
        sftp = ssh.open_sftp()
        try:
            sftp.put(str(LOCAL_SCRIPT), f"{REMOTE_DIR}/real-paper-export-acceptance.js")
            sftp.put(str(LOCAL_CLOUD_HELPER), f"{REMOTE_DIR}/real-cloud-business-acceptance.js")
        finally:
            sftp.close()
        uploaded = True
        deploy.run(ssh, f"docker cp '{REMOTE_DIR}/real-paper-export-acceptance.js' {CONTAINER}:{CONTAINER_SCRIPT}")
        deploy.run(ssh, f"docker cp '{REMOTE_DIR}/real-cloud-business-acceptance.js' {CONTAINER}:{CONTAINER_HELPER}")
        deploy.run(ssh, copy_verification_command())
        output, _ = deploy.run(ssh, f"docker exec {CONTAINER} node {CONTAINER_SCRIPT}", timeout=300)
        value = receipt(output)
        for format_name, (_, remote_name) in ARTIFACTS.items():
            deploy.run(ssh, copy_artifact_command(format_name))
            local_path = LOCAL_OUTPUT_DIR / remote_name
            sftp = ssh.open_sftp()
            try:
                sftp.get(f"{REMOTE_DIR}/{remote_name}", str(local_path))
            finally:
                sftp.close()
            item = next(item for item in value["artifacts"] if item["format"] == format_name)
            data = local_path.read_bytes()
            if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
                raise RuntimeError("REAL_PAPER_EXPORT_ARTIFACT_HASH_MISMATCH")
        return value
    finally:
        if uploaded:
            deploy.run(ssh, cleanup_command())
        ssh.close()


if __name__ == "__main__":
    print(json.dumps(receipt(json.dumps(run())), ensure_ascii=True, sort_keys=True))
