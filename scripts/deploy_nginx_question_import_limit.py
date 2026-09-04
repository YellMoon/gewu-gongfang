#!/usr/bin/env python3
"""Raise only the cloud question-import proxy body limit, with backup and rollback."""

import importlib.util
import re
import shlex
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("backend_deploy", ROOT / "scripts" / "deploy.py")
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)

LIVE_PATH = "/etc/nginx/sites-enabled/education-platform"
LIMIT = "client_max_body_size 96m;"
LOCATIONS = ("/scheduling/", "/cloud-business/")


def quote(value):
    return shlex.quote(value)


def patch_nginx_config(source):
    updated = source
    for location in LOCATIONS:
        pattern = re.compile(
            rf"(?P<header>(?P<indent>^[ \t]*)location\s+{re.escape(location)}\s*\{{)"
            rf"(?P<body>[\s\S]*?\n(?P=indent)\}})",
            re.MULTILINE,
        )
        if not pattern.search(updated):
            raise ValueError("NGINX_QUESTION_IMPORT_LOCATION_MISSING")

        def add_limit(match):
            block = match.group(0)
            if LIMIT in block:
                return block
            indent = match.group("indent") + "    "
            return match.group("header") + "\n" + indent + LIMIT + match.group("body")

        updated = pattern.sub(add_limit, updated)
    return updated


def main():
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_dir = f"/root/scheduling-backups/nginx/question-import-limit-{stamp}"
    ssh = deploy.connect()
    changed = False
    try:
        deploy.run(ssh, f"mkdir -p {quote(backup_dir)} && cp --preserve=all {quote(LIVE_PATH)} {quote(backup_dir + '/education-platform.conf')}")
        sftp = ssh.open_sftp()
        try:
            with sftp.open(LIVE_PATH, "r") as current_file:
                current = current_file.read().decode("utf-8")
            updated = patch_nginx_config(current)
            changed = updated != current
            if changed:
                with sftp.open(LIVE_PATH, "w") as target:
                    target.write(updated.encode("utf-8"))
        finally:
            sftp.close()
        try:
            deploy.run(ssh, "nginx -t && systemctl reload nginx", timeout=30)
            deploy.run(ssh, "curl -fsS --max-time 15 https://physicsedu.xyz/scheduling/api/health", timeout=30)
        except Exception:
            if changed:
                deploy.run(ssh, f"cp --preserve=all {quote(backup_dir + '/education-platform.conf')} {quote(LIVE_PATH)}")
                deploy.run(ssh, "nginx -t && systemctl reload nginx", timeout=30)
            raise
        print(f"NGINX_QUESTION_IMPORT_LIMIT_READY backup={backup_dir} changed={str(changed).lower()}")
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
