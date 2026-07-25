#!/usr/bin/env python3
"""Refresh the existing WeChat miniapp development upload through Aliyun."""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import deploy


REMOTE_TARGET = "/root/gewu-miniapp-upload/v6.2.0"
PRIVATE_KEY = "/root/.config/gewu-miniprogram/private.wx3d570539bbe6ba1b.key"


def main():
    stamp = datetime.now().strftime("%Y%m%d%H%M")
    version = f"6.2.0-dev.{stamp}"
    description = f"格物工坊开发版刷新 {stamp}"
    command = (
        f"cd '{REMOTE_TARGET}' && "
        f"test -f miniapp/dist/app.json && "
        f"test -f '{PRIVATE_KEY}' && "
        f"WECHAT_MINIAPP_PRIVATE_KEY_PATH='{PRIVATE_KEY}' "
        f"node scripts/upload-miniapp.js --version '{version}' "
        f"--desc '{description}'"
    )

    ssh = deploy.connect()
    try:
        output = deploy.run(ssh, command, timeout=300)
    finally:
        ssh.close()

    match = re.search(r'\{\s*"success"\s*:\s*true[\s\S]*\}\s*$', output)
    if not match:
        raise SystemExit("miniapp upload did not return success=true")
    payload = json.loads(match.group(0))
    print(json.dumps({"verified": True, "version": version, "upload": payload}, ensure_ascii=False))


if __name__ == "__main__":
    main()
