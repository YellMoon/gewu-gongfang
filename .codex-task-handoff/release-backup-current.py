#!/usr/bin/env python3
"""Create the current release rollback point without exposing deploy secrets."""

from datetime import datetime, timezone
import json
from pathlib import Path
import shlex
import sys
import uuid

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import scripts.deploy as backend_deploy
import scripts.deploy_gateway as gateway_deploy


def quoted(value):
    return shlex.quote(str(value))


def main():
    version = backend_deploy.read_root_version()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_dir = f"/root/scheduling-backups/release/{stamp}-v{version}"
    backend_db = backend_deploy.DB_PATH
    gateway_db = f"{gateway_deploy.REMOTE_GATEWAY}/data/gateway.db"
    remote_helper = f"/tmp/gewu-release-backup-{uuid.uuid4().hex}.py"
    helper_source = """\
import json
import sqlite3
import sys

results = []
for source_path, target_path, label in (
    (sys.argv[1], sys.argv[2], "backend"),
    (sys.argv[3], sys.argv[4], "gateway"),
):
    source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
    target = sqlite3.connect(target_path)
    try:
        source.backup(target)
        integrity = target.execute("PRAGMA integrity_check").fetchone()[0]
        target.commit()
    finally:
        target.close()
        source.close()
    results.append({"label": label, "integrity_check": integrity})
print(json.dumps(results, separators=(",", ":")))
"""

    ssh = backend_deploy.connect()
    try:
        backend_deploy.run(
            ssh,
            " && ".join([
                f"test -d {quoted(backend_deploy.REMOTE_DIR)}",
                f"test -d {quoted(gateway_deploy.REMOTE_GATEWAY)}",
                f"test -f {quoted(backend_db)}",
                f"test -f {quoted(gateway_db)}",
                f"mkdir -p {quoted(backup_dir)}",
            ]),
        )
        backend_deploy.run(
            ssh,
            f"tar -C {quoted(backend_deploy.REMOTE_DIR)} -czf {quoted(backup_dir + '/backend-code.tar.gz')} "
            "--exclude=node_modules --exclude=data --exclude=uploads --exclude=.env --exclude=.env.local .",
            timeout=180,
        )
        backend_deploy.run(
            ssh,
            f"tar -C {quoted(gateway_deploy.REMOTE_GATEWAY)} -czf {quoted(backup_dir + '/gateway-code.tar.gz')} "
            "--exclude=node_modules --exclude=data --exclude=.env --exclude=.env.local .",
            timeout=180,
        )
        sftp = ssh.open_sftp()
        try:
            with sftp.file(remote_helper, "w") as handle:
                handle.write(helper_source)
                handle.flush()
            sftp.chmod(remote_helper, 0o700)
        finally:
            sftp.close()
        backend_deploy.run(
            ssh,
            " ".join([
                "python3",
                quoted(remote_helper),
                quoted(backend_db),
                quoted(backup_dir + "/backend.db"),
                quoted(gateway_db),
                quoted(backup_dir + "/gateway.db"),
            ]),
            timeout=180,
        )
        backend_deploy.run(
            ssh,
            f"cd {quoted(backup_dir)} && sha256sum backend-code.tar.gz gateway-code.tar.gz backend.db gateway.db "
            "&& stat -c '%n %s' backend-code.tar.gz gateway-code.tar.gz backend.db gateway.db",
            timeout=60,
        )
        print(json.dumps({"backup_dir": backup_dir, "version": version}, separators=(",", ":")))
    finally:
        try:
            backend_deploy.run(ssh, f"rm -f {quoted(remote_helper)}", timeout=30)
        finally:
            ssh.close()


if __name__ == "__main__":
    main()
