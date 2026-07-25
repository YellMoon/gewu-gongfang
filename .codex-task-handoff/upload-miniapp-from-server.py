#!/usr/bin/env python3
"""Upload the prebuilt 6.2.0 miniapp through the fixed-IP Aliyun host."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import deploy


VERSION = '6.2.0'
PROJECT_ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = PROJECT_ROOT / 'output' / 'task14-release' / f'miniapp-upload-{VERSION}.tgz'
REMOTE_ARCHIVE = f'/tmp/gewu-miniapp-upload-{VERSION}.tgz'
REMOTE_TARGET = f'/root/gewu-miniapp-upload/v{VERSION}'
RUNTIME = '/root/gewu-miniapp-upload/v6.1.0/miniapp/node_modules'
PRIVATE_KEY = '/root/.config/gewu-miniprogram/private.wx3d570539bbe6ba1b.key'


def main():
    if not ARCHIVE.is_file():
        raise SystemExit(f'archive not found: {ARCHIVE}')

    ssh = deploy.connect()
    sftp = ssh.open_sftp()
    try:
        result = deploy.run(
            ssh,
            f"test ! -e '{REMOTE_TARGET}' && echo TARGET_AVAILABLE || echo TARGET_EXISTS",
        )
        if 'TARGET_EXISTS' in result:
            raise SystemExit(f'remote target already exists: {REMOTE_TARGET}')

        sftp.put(str(ARCHIVE), REMOTE_ARCHIVE)
        sftp.chmod(REMOTE_ARCHIVE, 0o600)
        deploy.run(
            ssh,
            f"mkdir -p '{REMOTE_TARGET}' && "
            f"tar -xzf '{REMOTE_ARCHIVE}' -C '{REMOTE_TARGET}' && "
            f"ln -s '{RUNTIME}' '{REMOTE_TARGET}/miniapp/node_modules'",
        )
        deploy.run(
            ssh,
            f"cd '{REMOTE_TARGET}' && "
            f"WECHAT_MINIAPP_PRIVATE_KEY_PATH='{PRIVATE_KEY}' "
            f"node scripts/upload-miniapp.js --version '{VERSION}' "
            "--desc '格物工坊小程序发布 2026-07-22'",
            timeout=300,
        )
        deploy.run(
            ssh,
            f"test -f '{REMOTE_TARGET}/miniapp/dist/app.json' && "
            f"node -p \"require('{REMOTE_TARGET}/package.json').version\"",
        )
    finally:
        try:
            sftp.remove(REMOTE_ARCHIVE)
        except OSError:
            pass
        sftp.close()
        ssh.close()


if __name__ == '__main__':
    main()
