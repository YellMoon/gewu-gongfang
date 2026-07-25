from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scripts.deploy as deploy


REMOTE_SCRIPT = "/tmp/gewu-diagnose-wechat-url-link.js"
SCRIPT = r"""
'use strict';
const { execFileSync } = require('node:child_process');

async function main() {
  const processes = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
  const backend = processes.find(p => String(p.name || '').includes('scheduling-backend'))
    || processes.find(p => String(p.pm2_env?.pm_cwd || '').includes('/root/scheduling-backend'));
  if (!backend) throw new Error('backend PM2 process was not found');
  const env = backend.pm2_env || {};
  const result = {
    hasAppid: Boolean(env.WECHAT_APPID),
    hasSecret: Boolean(env.WECHAT_APPSECRET),
    envVersion: env.WECHAT_MINIAPP_ENV_VERSION || 'release',
  };
  if (!result.hasAppid || !result.hasSecret) {
    console.log(JSON.stringify(result));
    return;
  }
  const tokenUrl = new URL('https://api.weixin.qq.com/cgi-bin/token');
  tokenUrl.searchParams.set('grant_type', 'client_credential');
  tokenUrl.searchParams.set('appid', env.WECHAT_APPID);
  tokenUrl.searchParams.set('secret', env.WECHAT_APPSECRET);
  const tokenResponse = await fetch(tokenUrl, { signal: AbortSignal.timeout(8000) });
  const tokenPayload = await tokenResponse.json();
  result.tokenHttpStatus = tokenResponse.status;
  result.tokenErrcode = tokenPayload.errcode ?? null;
  result.tokenErrmsg = tokenPayload.errmsg ?? null;
  result.hasAccessToken = Boolean(tokenPayload.access_token);
  if (!result.hasAccessToken) {
    console.log(JSON.stringify(result));
    return;
  }
  const linkUrl = new URL('https://api.weixin.qq.com/wxa/generate_urllink');
  linkUrl.searchParams.set('access_token', tokenPayload.access_token);
  const linkResponse = await fetch(linkUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      path: 'pages/desktop-authorization/index',
      query: 'challengeId=diagnostic-challenge-1234567890',
      env_version: result.envVersion,
      is_expire: true,
      expire_type: 1,
      expire_interval: 1,
    }),
    signal: AbortSignal.timeout(8000),
  });
  const linkPayload = await linkResponse.json();
  result.linkHttpStatus = linkResponse.status;
  result.linkErrcode = linkPayload.errcode ?? null;
  result.linkErrmsg = linkPayload.errmsg ?? null;
  result.hasUrlLink = Boolean(linkPayload.url_link);
  const qrUrl = new URL('https://api.weixin.qq.com/wxa/getwxacode');
  qrUrl.searchParams.set('access_token', tokenPayload.access_token);
  const qrResponse = await fetch(qrUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      path: 'pages/desktop-authorization/index?challengeId=diagnostic-challenge-1234567890',
      env_version: result.envVersion,
      check_path: false,
      width: 430,
    }),
    signal: AbortSignal.timeout(8000),
  });
  const qrBuffer = Buffer.from(await qrResponse.arrayBuffer());
  result.qrHttpStatus = qrResponse.status;
  result.qrContentType = qrResponse.headers.get('content-type');
  result.qrBytes = qrBuffer.length;
  result.qrPngSignature = qrBuffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!result.qrPngSignature) {
    try {
      const qrPayload = JSON.parse(qrBuffer.toString('utf8'));
      result.qrErrcode = qrPayload.errcode ?? null;
      result.qrErrmsg = qrPayload.errmsg ?? null;
    } catch {}
  }
  console.log(JSON.stringify(result));
}

main().catch(error => {
  console.error(JSON.stringify({ name: error.name, message: error.message }));
  process.exitCode = 1;
});
"""


def main() -> None:
    ssh = deploy.connect()
    try:
        sftp = ssh.open_sftp()
        try:
            with sftp.open(REMOTE_SCRIPT, "w") as stream:
                stream.write(SCRIPT)
            sftp.chmod(REMOTE_SCRIPT, 0o600)
        finally:
            sftp.close()
        _, stdout, stderr = ssh.exec_command(f"node {REMOTE_SCRIPT}; status=$?; rm -f {REMOTE_SCRIPT}; exit $status")
        output = stdout.read().decode("utf-8", "replace").strip()
        error = stderr.read().decode("utf-8", "replace").strip()
        status = stdout.channel.recv_exit_status()
        if status != 0:
            raise SystemExit(error or f"remote diagnostic failed: {status}")
        print(json.dumps(json.loads(output), ensure_ascii=False, indent=2))
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
