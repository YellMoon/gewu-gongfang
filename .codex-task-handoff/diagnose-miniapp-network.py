#!/usr/bin/env python3
"""Read-only diagnostics for the latest desktop miniapp authorization request."""

import base64
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("APP_ENV", "prod")

from scripts import deploy


REMOTE_SCRIPT = r"""
const Database = require('./node_modules/better-sqlite3');
const db = new Database(process.env.DB_PATH, { readonly: true, fileMustExist: true });
const row = db.prepare(`SELECT id,status,purpose,row_version,created_at,updated_at,expires_at
  FROM desktop_identity_challenges WHERE device_id='desktop_host_001'
  ORDER BY created_at DESC LIMIT 1`).get();
if (!row) throw new Error('latest desktop challenge not found');
const digest = require('crypto').createHash('sha256').update(row.id).digest('hex').slice(0, 12);
const base = 'http://127.0.0.1:3002';
fetch(`${base}/api/desktop-identity/challenges/${encodeURIComponent(row.id)}/public`)
  .then(async response => {
    const body = await response.json().catch(() => null);
    console.log(JSON.stringify({
      challengeDigest: digest,
      database: { status: row.status, purpose: row.purpose, rowVersion: row.row_version,
        createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at },
      directBackend: { statusCode: response.status, success: body?.success,
        responseStatus: body?.data?.challenge?.status, responseCode: body?.code || null }
    }));
  })
  .finally(() => db.close());
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
        deploy.run(
            ssh,
            "for f in /root/.pm2/logs/scheduling-backend-prod-out.log "
            "/root/.pm2/logs/scheduling-backend-prod-error.log "
            "/root/.pm2/logs/edu-gateway-out.log /root/.pm2/logs/edu-gateway-error.log; do "
            "test -f \"$f\" || continue; echo \"LOG:$f\"; "
            "tail -n 180 \"$f\" | grep -E 'desktop-identity|request:fail|ERR_|error|Error' | tail -n 35 | "
            "sed -E 's#challenges/[A-Za-z0-9_-]+#challenges/[redacted]#g'; done",
            timeout=30,
        )
        deploy.run(
            ssh,
            "if test -f /var/log/nginx/access.log; then "
            "tail -n 500 /var/log/nginx/access.log | grep 'desktop-identity' | tail -n 40 | "
            "sed -E 's#challenges/[A-Za-z0-9_-]+#challenges/[redacted]#g'; fi",
            timeout=30,
        )
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
