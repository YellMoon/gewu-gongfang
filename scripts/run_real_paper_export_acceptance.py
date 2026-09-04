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
import run_real_question_import_acceptance as question_import_runner  # noqa: E402


CONTAINER = "gewu-cloud-business-api"
LOCAL_SCRIPT = ROOT / "scripts" / "real-paper-export-acceptance.js"
LOCAL_CLOUD_HELPER = ROOT / "scripts" / "real-cloud-business-acceptance.js"
LOCAL_RENDERER = ROOT / "cloud-business-api" / "src" / "paperExportRenderer.js"
LOCAL_EXAM = question_import_runner.LOCAL_EXAM
LOCAL_LECTURE = question_import_runner.LOCAL_LECTURE
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
    question_ids = value.get("questionIds") if isinstance(value, dict) else None
    if value.get("ok") is not True or not isinstance(artifacts, list) or len(artifacts) != 2 \
            or not isinstance(question_ids, list) or len(question_ids) != 2 \
            or any(not isinstance(item, str) or not item.startswith("question-import-") for item in question_ids) \
            or len(set(question_ids)) != 2:
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


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_command(exam_sha256, lecture_sha256, renderer_sha256):
    hashes = [str(exam_sha256 or "").strip().lower(), str(lecture_sha256 or "").strip().lower(), str(renderer_sha256 or "").strip().lower()]
    if any(len(value) != 64 or any(character not in "0123456789abcdef" for character in value) for value in hashes) \
            or hashes[0] == hashes[1]:
        raise ValueError("REAL_PAPER_EXPORT_SOURCE_INVALID")
    return (f"docker exec -e REAL_QUESTION_IMPORT_EXAM_SHA256='{hashes[0]}' "
            f"-e REAL_QUESTION_IMPORT_LECTURE_SHA256='{hashes[1]}' "
            f"-e REAL_PAPER_EXPORT_RENDERER_SHA256='{hashes[2]}' {CONTAINER} node {CONTAINER_SCRIPT}")


def prepare_command():
    paths = " ".join(repr(source) for source, _ in ARTIFACTS.values())
    return f"docker exec -u 0 {CONTAINER} rm -f -- '{CONTAINER_SCRIPT}' '{CONTAINER_HELPER}' {paths}; rm -rf -- '{REMOTE_DIR}' && mkdir -p '{REMOTE_DIR}'"


def copy_verification_command():
    return f"docker exec {CONTAINER} test -s '{CONTAINER_SCRIPT}' && docker exec {CONTAINER} test -s '{CONTAINER_HELPER}'"


def cleanup_command():
    paths = " ".join(repr(source) for source, _ in ARTIFACTS.values())
    return f"docker exec -u 0 {CONTAINER} rm -f -- '{CONTAINER_SCRIPT}' '{CONTAINER_HELPER}' {paths}; rm -rf -- '{REMOTE_DIR}'"


def run():
    if not LOCAL_SCRIPT.is_file() or not LOCAL_CLOUD_HELPER.is_file() or not LOCAL_RENDERER.is_file() or not LOCAL_EXAM.is_file() or not LOCAL_LECTURE.is_file():
        raise RuntimeError("REAL_PAPER_EXPORT_SOURCE_MISSING")
    command = export_command(sha256_file(LOCAL_EXAM), sha256_file(LOCAL_LECTURE), sha256_file(LOCAL_RENDERER))
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
        output, _ = deploy.run(ssh, command, timeout=300)
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
