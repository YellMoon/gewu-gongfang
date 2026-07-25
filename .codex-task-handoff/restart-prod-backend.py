#!/usr/bin/env python3
"""Restart the production PM2 backend and verify its local health endpoint."""

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("APP_ENV", "prod")

from scripts import deploy


def main():
    ssh = deploy.connect()
    try:
        deploy.run(ssh, "pm2 restart scheduling-backend-prod", timeout=30)
        time.sleep(2)
        deploy.wait_for_remote_health(
            ssh,
            deploy.APP_PORT,
            "backend",
            deploy.read_root_version(),
        )
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
