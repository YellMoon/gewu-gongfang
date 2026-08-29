#!/usr/bin/env python3
"""Publish one imported exam sample and one imported lecture sample through desktop commands."""

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import deploy  # noqa: E402


CONTAINER = "gewu-cloud-business-api"
POSTGRES_CONTAINER = "gewu-postgres17"
LOCAL_PUBLISH = ROOT / "scripts" / "real-question-import-publish.js"
LOCAL_CLOUD_HELPER = ROOT / "scripts" / "real-cloud-business-acceptance.js"
REMOTE_DIR = "/tmp/gewu-real-question-import-publish"
CONTAINER_PUBLISH = "/app/real-question-import-publish.js"
CONTAINER_CLOUD_HELPER = "/app/real-cloud-business-acceptance.js"
TASK_ID_PATTERN = re.compile(r"^question_import_task_[A-Za-z0-9_-]{8,128}$")


def valid_task_id(value):
    task_id = str(value or "").strip()
    if not TASK_ID_PATTERN.fullmatch(task_id):
        raise ValueError("REAL_QUESTION_IMPORT_PUBLISH_INPUT_INVALID")
    return task_id


def grant_owner_command():
    return (f"docker exec {POSTGRES_CONTAINER} psql -U gewu_app -d gewu_cloud -v ON_ERROR_STOP=1 "
            "-c 'GRANT vnext_pg17_owner, vnext_pg17_business_owner TO vnext_pg17_writer'")


def revoke_owner_command():
    return (f"docker exec {POSTGRES_CONTAINER} psql -U gewu_app -d gewu_cloud -v ON_ERROR_STOP=1 "
            "-c 'REVOKE vnext_pg17_owner, vnext_pg17_business_owner FROM vnext_pg17_writer'")


def parse_receipt(output, exam_task_id, lecture_task_id):
    try:
        lines = [line.strip() for line in str(output).splitlines() if line.strip()]
        payload = json.loads(lines[-1])
    except (IndexError, TypeError, json.JSONDecodeError) as error:
        raise ValueError("REAL_QUESTION_IMPORT_PUBLISH_RECEIPT_INVALID") from error
    if (not isinstance(payload, dict) or payload.get("ok") is not True or payload.get("publishedCount") != 2
            or not isinstance(payload.get("questionIds"), list) or len(payload["questionIds"]) != 2
            or any(not isinstance(item, str) or not item.startswith("question-import-") for item in payload["questionIds"])):
        raise ValueError("REAL_QUESTION_IMPORT_PUBLISH_RECEIPT_INVALID")
    if exam_task_id == lecture_task_id:
        raise ValueError("REAL_QUESTION_IMPORT_PUBLISH_RECEIPT_INVALID")
    return payload


def run(exam_task_id, lecture_task_id):
    exam_task_id = valid_task_id(exam_task_id)
    lecture_task_id = valid_task_id(lecture_task_id)
    if exam_task_id == lecture_task_id or not LOCAL_PUBLISH.is_file() or not LOCAL_CLOUD_HELPER.is_file():
        raise RuntimeError("REAL_QUESTION_IMPORT_PUBLISH_INPUT_INVALID")
    ssh = deploy.connect()
    owner_granted = False
    staging_created = False
    try:
        deploy.run(ssh, f"rm -rf -- '{REMOTE_DIR}' && mkdir -p '{REMOTE_DIR}'")
        staging_created = True
        deploy.run(ssh, f"docker exec -u 0 {CONTAINER} test ! -e '{CONTAINER_PUBLISH}' && docker exec -u 0 {CONTAINER} test ! -e '{CONTAINER_CLOUD_HELPER}'")
        sftp = ssh.open_sftp()
        try:
            sftp.put(str(LOCAL_PUBLISH), f"{REMOTE_DIR}/real-question-import-publish.js")
            sftp.put(str(LOCAL_CLOUD_HELPER), f"{REMOTE_DIR}/real-cloud-business-acceptance.js")
        finally:
            sftp.close()
        for name, destination in (("real-question-import-publish.js", CONTAINER_PUBLISH), ("real-cloud-business-acceptance.js", CONTAINER_CLOUD_HELPER)):
            deploy.run(ssh, f"docker cp '{REMOTE_DIR}/{name}' {CONTAINER}:{destination}")
        deploy.run(ssh, grant_owner_command())
        owner_granted = True
        try:
            output, _ = deploy.run(
                ssh,
                f"docker exec -e REAL_QUESTION_IMPORT_EXAM_TASK_ID='{exam_task_id}' "
                f"-e REAL_QUESTION_IMPORT_LECTURE_TASK_ID='{lecture_task_id}' {CONTAINER} node {CONTAINER_PUBLISH}",
                timeout=300,
            )
        finally:
            deploy.run(ssh, revoke_owner_command())
            owner_granted = False
        return parse_receipt(output, exam_task_id, lecture_task_id)
    finally:
        if owner_granted:
            deploy.run(ssh, revoke_owner_command())
        if staging_created:
            deploy.run(ssh, f"docker exec -u 0 {CONTAINER} rm -f -- '{CONTAINER_PUBLISH}' '{CONTAINER_CLOUD_HELPER}'; rm -rf -- '{REMOTE_DIR}'")
        ssh.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exam-task-id", required=True)
    parser.add_argument("--lecture-task-id", required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.exam_task_id, args.lecture_task_id), ensure_ascii=True, sort_keys=True))


if __name__ == "__main__":
    main()
