#!/usr/bin/env python3
"""Switch production desktop-auth miniapp entry between develop and release."""

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("APP_ENV", "prod")

from scripts import deploy


def main():
    value = sys.argv[1] if len(sys.argv) > 1 else ""
    if value not in {"develop", "trial", "release"}:
        raise SystemExit("usage: set-wechat-miniapp-env.py develop|trial|release")
    ssh = deploy.connect()
    try:
        deploy.run(
            ssh,
            f"WECHAT_MINIAPP_ENV_VERSION={value} "
            "pm2 restart scheduling-backend-prod --update-env",
            timeout=30,
        )
        time.sleep(2)
        deploy.wait_for_remote_health(
            ssh,
            deploy.APP_PORT,
            "backend",
            deploy.read_root_version(),
        )
        deploy.run(
            ssh,
            "pm2 env 31 | grep '^WECHAT_MINIAPP_ENV_VERSION:' | head -1",
        )
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
