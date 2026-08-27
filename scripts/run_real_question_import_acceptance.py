#!/usr/bin/env python3
"""Import the approved Word samples through the live desktop-to-NAS relay without a user login."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import deploy  # noqa: E402

CONTAINER = "gewu-cloud-business-api"
POSTGRES_CONTAINER = "gewu-postgres17"
LOCAL_SCRIPT = ROOT / "scripts" / "real-question-import-acceptance.js"
LOCAL_CLOUD_HELPER = ROOT / "scripts" / "real-cloud-business-acceptance.js"
LOCAL_EXAM = Path(r"D:\题库测试文件\试卷格式\2026届浙江宁波市高三第二学期高考与选考模拟考试（二模）物理试卷.docx")
LOCAL_LECTURE = Path(r"D:\题库测试文件\讲义格式\2026届高三复习讲义-专题01-运动学.docx")
REMOTE_DIR = "/tmp/gewu-real-question-import"
CONTAINER_SCRIPT = "/app/real-question-import-acceptance.js"
CONTAINER_HELPER = "/app/real-cloud-business-acceptance.js"
CONTAINER_EXAM = "/tmp/gewu-real-exam.docx"
CONTAINER_LECTURE = "/tmp/gewu-real-lecture.docx"


def grant_owner_command():
    return (f"docker exec {POSTGRES_CONTAINER} psql -U gewu_app -d gewu_cloud -v ON_ERROR_STOP=1 "
            "-c 'GRANT vnext_pg17_owner, vnext_pg17_business_owner TO vnext_pg17_writer'")


def revoke_owner_command():
    return (f"docker exec {POSTGRES_CONTAINER} psql -U gewu_app -d gewu_cloud -v ON_ERROR_STOP=1 "
            "-c 'REVOKE vnext_pg17_owner, vnext_pg17_business_owner FROM vnext_pg17_writer'")


def receipt(output):
    try:
        value = json.loads([line for line in str(output).splitlines() if line.strip()][-1])
    except (IndexError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("REAL_QUESTION_IMPORT_RECEIPT_INVALID") from error
    imports = value.get("imports") if isinstance(value, dict) else None
    if value.get("ok") is not True or not isinstance(imports, list) or len(imports) != 2:
        raise ValueError("REAL_QUESTION_IMPORT_RECEIPT_INVALID")
    expected = {"exam", "lecture"}
    if {item.get("sourceType") for item in imports if isinstance(item, dict)} != expected:
        raise ValueError("REAL_QUESTION_IMPORT_RECEIPT_INVALID")
    for item in imports:
        ready, prepared = item.get("ready"), item.get("prepared")
        if not isinstance(ready, dict) or not isinstance(prepared, dict) or ready.get("status") != "candidates_ready" or prepared.get("status") != "drafts_prepared" or ready.get("itemCount", 0) < 1:
            raise ValueError("REAL_QUESTION_IMPORT_RECEIPT_INVALID")
    return value


def run():
    if not all(path.is_file() for path in (LOCAL_SCRIPT, LOCAL_CLOUD_HELPER, LOCAL_EXAM, LOCAL_LECTURE)):
        raise RuntimeError("REAL_QUESTION_IMPORT_SOURCE_MISSING")
    ssh = deploy.connect()
    owner_granted = False
    uploaded = False
    try:
        deploy.run(ssh, f"rm -rf -- '{REMOTE_DIR}' && mkdir -p '{REMOTE_DIR}'")
        sftp = ssh.open_sftp()
        try:
            sftp.put(str(LOCAL_SCRIPT), f"{REMOTE_DIR}/real-question-import-acceptance.js")
            sftp.put(str(LOCAL_CLOUD_HELPER), f"{REMOTE_DIR}/real-cloud-business-acceptance.js")
            sftp.put(str(LOCAL_EXAM), f"{REMOTE_DIR}/exam.docx")
            sftp.put(str(LOCAL_LECTURE), f"{REMOTE_DIR}/lecture.docx")
        finally:
            sftp.close()
        uploaded = True
        deploy.run(ssh, f"docker exec -u 0 {CONTAINER} test ! -e '{CONTAINER_SCRIPT}' && docker exec -u 0 {CONTAINER} test ! -e '{CONTAINER_HELPER}'")
        for name, destination in (("real-question-import-acceptance.js", CONTAINER_SCRIPT), ("real-cloud-business-acceptance.js", CONTAINER_HELPER), ("exam.docx", CONTAINER_EXAM), ("lecture.docx", CONTAINER_LECTURE)):
            deploy.run(ssh, f"docker cp '{REMOTE_DIR}/{name}' {CONTAINER}:{destination}")
        deploy.run(ssh, grant_owner_command())
        owner_granted = True
        try:
            output, _ = deploy.run(ssh, f"docker exec {CONTAINER} node {CONTAINER_SCRIPT}", timeout=300)
        finally:
            deploy.run(ssh, revoke_owner_command())
            owner_granted = False
        return receipt(output)
    finally:
        if owner_granted:
            deploy.run(ssh, revoke_owner_command())
        if uploaded:
            deploy.run(ssh, f"docker exec -u 0 {CONTAINER} rm -f -- '{CONTAINER_SCRIPT}' '{CONTAINER_HELPER}' '{CONTAINER_EXAM}' '{CONTAINER_LECTURE}'; rm -rf -- '{REMOTE_DIR}'")
        ssh.close()


if __name__ == "__main__":
    print(json.dumps(receipt(json.dumps(run())), ensure_ascii=True, sort_keys=True))
