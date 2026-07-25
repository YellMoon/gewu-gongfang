#!/usr/bin/env python3
"""Call the production WeChat URL Link path and print only redacted diagnostics."""

import base64
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("APP_ENV", "prod")

from scripts import deploy


REMOTE_SCRIPT = r"""
const service = require('./src/services/wechatMiniappService');
(async () => {
  const result = {};
  try {
    await service.createDesktopAuthorizationUrlLink({
      challengeId: 'diagnostic_20260722_primary_host',
    });
    result.urlLink = { ok: true };
  } catch (error) {
    result.urlLink = {
      ok: false,
      code: error && error.code || null,
      wechatErrcode: Number.isFinite(Number(error && error.wechatErrcode))
        ? Number(error.wechatErrcode)
        : null,
      message: error && error.message || null,
    };
  }
  try {
    const qr = await service.createDesktopAuthorizationQrCode({
      challengeId: 'diagnostic_20260722_primary_host',
    });
    result.qrCode = { ok: /^data:image\/(?:png|jpeg);base64,/.test(qr) };
  } catch (error) {
    result.qrCode = {
      ok: false,
      code: error && error.code || null,
      wechatErrcode: Number.isFinite(Number(error && error.wechatErrcode))
        ? Number(error.wechatErrcode)
        : null,
      message: error && error.message || null,
    };
  }
  console.log(JSON.stringify(result));
})();
"""


def main():
    payload = base64.b64encode(REMOTE_SCRIPT.encode("utf-8")).decode("ascii")
    command = (
        f"cd '{deploy.REMOTE_DIR}' && "
        f"node -e \"eval(Buffer.from('{payload}','base64').toString('utf8'))\""
    )
    ssh = deploy.connect()
    try:
        deploy.run(
            ssh,
            f"grep -n \"wechatErrcode.*85407\" '{deploy.REMOTE_DIR}/src/routes/desktopIdentity.js' | head -5",
        )
        deploy.run_with_remote_env(ssh, command, timeout=30)
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
