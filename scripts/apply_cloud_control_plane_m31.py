#!/usr/bin/env python3
"""Apply and verify the desktop managed-session resume window."""
import json
from pathlib import Path
import subprocess

from apply_cloud_postgres_migrations import DockerPsqlExecutor
from deploy import connect


def main():
    root = Path(__file__).resolve().parents[1]
    sql = subprocess.check_output(
        ["node", "-e", "process.stdout.write(require('./scripts/vnext-migration/cloudControlPlaneM31Upgrade').buildCloudControlPlaneM31UpgradeSql())"],
        cwd=root, encoding="utf-8", timeout=30,
    )
    ssh = connect()
    try:
        output = DockerPsqlExecutor(ssh, "gewu-postgres17", "gewu_cloud", "gewu_app").run(sql)
        verified = json.loads(output.strip().splitlines()[-1])
        if verified.get("verified") is not True:
            raise RuntimeError("CLOUD_CONTROL_PLANE_M31_VERIFICATION_FAILED")
        print(json.dumps(verified, sort_keys=True))
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
