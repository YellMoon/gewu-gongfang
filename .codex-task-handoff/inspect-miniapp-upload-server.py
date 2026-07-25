#!/usr/bin/env python3
"""Read-only inventory for remote miniapp CI upload readiness."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import deploy


def main():
    ssh = deploy.connect()
    try:
        deploy.run(ssh, "node -v && npm -v")
        deploy.run(
            ssh,
            "find /root -maxdepth 5 -type f "
            "\\( -name 'project.config.json' -o -name 'upload-miniapp.js' "
            "-o -name 'private.*.key' -o -name '*private*key*' \\) "
            "-printf '%p\\n' 2>/dev/null | head -100",
        )
        deploy.run(
            ssh,
            "find /root -maxdepth 4 -type d "
            "\\( -name 'miniapp' -o -name 'scheduling-system' \\) "
            "-printf '%p\\n' 2>/dev/null | head -100",
        )
        deploy.run(
            ssh,
            "test -d /root/gewu-miniapp-upload/v6.1.0/miniapp/node_modules/miniprogram-ci "
            "&& node -p \"require('/root/gewu-miniapp-upload/v6.1.0/miniapp/node_modules/miniprogram-ci/package.json').version\" "
            "|| echo MINIAPP_CI_RUNTIME_MISSING",
        )
    finally:
        ssh.close()


if __name__ == '__main__':
    main()
