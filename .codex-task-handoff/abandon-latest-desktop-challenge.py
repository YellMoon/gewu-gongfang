#!/usr/bin/env python3
"""Auditably abandon only the latest pending desktop_host_001 challenge."""

import base64
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("APP_ENV", "prod")

from scripts import deploy


REMOTE_SCRIPT = r"""
const crypto = require('crypto');
const Database = require('./node_modules/better-sqlite3');
const { createDesktopIdentityService } = require('./src/services/desktopIdentityService');
const db = new Database(process.env.DB_PATH, { fileMustExist: true });
const row = db.prepare(`SELECT id,status FROM desktop_identity_challenges
  WHERE device_id='desktop_host_001'
    AND status IN ('pending_phone','identity_verified_pending_approval','approved_pending_exchange')
  ORDER BY created_at DESC LIMIT 1`).get();
if (!row) {
  console.log(JSON.stringify({ changed: false, reason: 'NO_PENDING_CHALLENGE' }));
} else {
  createDesktopIdentityService({ db }).abandonPendingChallenge(row.id);
  const after = db.prepare('SELECT status FROM desktop_identity_challenges WHERE id=?').get(row.id);
  console.log(JSON.stringify({
    changed: true,
    challengeDigest: crypto.createHash('sha256').update(row.id).digest('hex').slice(0, 12),
    before: row.status,
    after: after.status,
  }));
}
db.close();
"""


def main():
    payload = base64.b64encode(REMOTE_SCRIPT.encode("utf-8")).decode("ascii")
    command = (
        f"cd '{deploy.REMOTE_DIR}' && "
        f"node -e \"eval(Buffer.from('{payload}','base64').toString('utf8'))\""
    )
    ssh = deploy.connect()
    try:
        deploy.run_with_remote_env(ssh, command, timeout=30)
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
