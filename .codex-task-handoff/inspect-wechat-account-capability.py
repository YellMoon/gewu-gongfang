#!/usr/bin/env python3
"""Read-only inspection of the production miniapp account status."""

import base64
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("APP_ENV", "prod")

from scripts import deploy


REMOTE_SCRIPT = r"""
async function main() {
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_APPSECRET;
  if (!appid || !secret) throw new Error('wechat runtime config missing');

  const tokenUrl = new URL('https://api.weixin.qq.com/cgi-bin/token');
  tokenUrl.searchParams.set('grant_type', 'client_credential');
  tokenUrl.searchParams.set('appid', appid);
  tokenUrl.searchParams.set('secret', secret);
  const tokenResponse = await fetch(tokenUrl, { signal: AbortSignal.timeout(10000) });
  const tokenPayload = await tokenResponse.json();
  if (!tokenPayload.access_token) {
    console.log(JSON.stringify({ stage: 'token', errcode: tokenPayload.errcode, errmsg: tokenPayload.errmsg }));
    return;
  }

  const infoUrl = new URL('https://api.weixin.qq.com/cgi-bin/account/getaccountbasicinfo');
  infoUrl.searchParams.set('access_token', tokenPayload.access_token);
  const infoResponse = await fetch(infoUrl, { signal: AbortSignal.timeout(10000) });
  const info = await infoResponse.json();
  console.log(JSON.stringify({
    stage: 'account',
    errcode: info.errcode || 0,
    errmsg: info.errmsg || 'ok',
    accountType: info.account_type,
    principalType: info.principal_type,
    realnameStatus: info.realname_status,
    qualificationVerify: info.wx_verify_info?.qualification_verify,
    namingVerify: info.wx_verify_info?.naming_verify,
    annualReview: info.wx_verify_info?.annual_review,
  }));
}
main().catch(error => {
  console.log(JSON.stringify({ stage: 'exception', message: String(error?.message || error) }));
  process.exitCode = 1;
});
"""


def main():
    payload = base64.b64encode(REMOTE_SCRIPT.encode("utf-8")).decode("ascii")
    ssh = deploy.connect()
    try:
        deploy.run_with_remote_env(
            ssh,
            f"cd '{deploy.REMOTE_DIR}' && node -e \"eval(Buffer.from('{payload}','base64').toString('utf8'))\"",
            timeout=30,
        )
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
