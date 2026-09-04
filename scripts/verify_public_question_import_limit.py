#!/usr/bin/env python3
"""Prove the public question-import proxy accepts a body larger than 6.5 MB."""

import importlib.util
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("backend_deploy", ROOT / "scripts" / "deploy.py")
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)

PUBLIC_IMPORT_URL = "https://physicsedu.xyz/cloud-business/api/desktop/question-imports"


def smoke_command(body_bytes=7 * 1024 * 1024):
    if not isinstance(body_bytes, int) or body_bytes <= 6_500_000 or body_bytes > 90 * 1024 * 1024:
        raise ValueError("PUBLIC_QUESTION_IMPORT_SMOKE_SIZE_INVALID")
    return (
        f"head -c {body_bytes} /dev/zero | "
        "curl --silent --show-error --output /dev/null --write-out '%{http_code}' "
        "--max-time 90 --header 'content-type: application/json' --data-binary @- "
        f"'{PUBLIC_IMPORT_URL}'"
    )


def validate_status(value):
    normalized = str(value or "").strip()
    if normalized == "413":
        raise RuntimeError("PUBLIC_QUESTION_IMPORT_BODY_LIMIT_REJECTED")
    if not re.fullmatch(r"4[0-9]{2}", normalized):
        raise RuntimeError("PUBLIC_QUESTION_IMPORT_SMOKE_INVALID")
    return int(normalized)


def verify():
    ssh = deploy.connect()
    try:
        output, _ = deploy.run(ssh, smoke_command(), timeout=120)
    finally:
        ssh.close()
    status = validate_status(output)
    return {"ok": True, "bodyBytes": 7 * 1024 * 1024, "httpStatus": status, "url": PUBLIC_IMPORT_URL}


def main():
    result = verify()
    print(
        "PUBLIC_QUESTION_IMPORT_BODY_LIMIT_VERIFIED "
        f"bodyBytes={result['bodyBytes']} httpStatus={result['httpStatus']} url={result['url']}"
    )


if __name__ == "__main__":
    main()
