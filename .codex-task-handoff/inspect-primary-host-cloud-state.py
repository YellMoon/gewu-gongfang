#!/usr/bin/env python3
"""Read-only, redacted inventory of primary-host state in the production DB."""

import base64
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("APP_ENV", "prod")

from scripts import deploy


REMOTE_SCRIPT = r"""
const crypto = require('crypto');
const Database = require(process.env.REMOTE_APP_DIR + '/node_modules/better-sqlite3');
const db = new Database(process.env.REMOTE_DB_PATH, { readonly: true, fileMustExist: true });
const mask = value => value
  ? crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12)
  : null;
const hasTable = name => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
).get(name));
const columns = name => hasTable(name)
  ? db.prepare(`PRAGMA table_info(${name})`).all().map(row => row.name)
  : [];
const rows = hasTable('primary_host_epochs')
  ? db.prepare("SELECT generation,status,device_id,activation_reason FROM primary_host_epochs ORDER BY generation DESC LIMIT 5").all()
  : [];
const heartbeatColumns = columns('host_heartbeats');
const heartbeatProjection = ['node_role', 'role', 'device_id', 'host_device_id', 'status', 'last_seen_at', 'updated_at', 'capabilities']
  .filter(name => heartbeatColumns.includes(name));
const heartbeatOrder = ['last_seen_at', 'updated_at', 'timestamp', 'created_at']
  .find(name => heartbeatColumns.includes(name));
const heartbeats = heartbeatProjection.length
  ? db.prepare(`SELECT ${heartbeatProjection.join(',')} FROM host_heartbeats${heartbeatOrder ? ` ORDER BY ${heartbeatOrder} DESC` : ''} LIMIT 5`).all()
  : [];
const challenges = hasTable('desktop_identity_challenges')
  ? db.prepare("SELECT status,device_id,created_at,updated_at FROM desktop_identity_challenges ORDER BY created_at DESC LIMIT 5").all()
  : [];
console.log(JSON.stringify({
  quickCheck: db.pragma('quick_check', { simple: true }),
  schemaVersion: db.pragma('user_version', { simple: true }),
  heartbeatColumns,
  epochs: rows.map(row => ({ ...row, device_id: mask(row.device_id) })),
  challenges: challenges.map(row => ({ ...row, device_id: mask(row.device_id) })),
  heartbeats: heartbeats.map(row => ({
    ...row,
    device_id: mask(row.device_id || row.host_device_id),
    host_device_id: undefined,
    capabilities: (() => {
      try { return JSON.parse(row.capabilities || '[]'); } catch { return []; }
    })(),
  })),
}, null, 2));
db.close();
"""


def main():
    payload = base64.b64encode(REMOTE_SCRIPT.encode("utf-8")).decode("ascii")
    command = (
        f"REMOTE_APP_DIR={json.dumps(deploy.REMOTE_DIR)} "
        f"REMOTE_DB_PATH={json.dumps(deploy.DB_PATH)} "
        f"node -e \"eval(Buffer.from('{payload}','base64').toString('utf8'))\""
    )
    ssh = deploy.connect()
    try:
        deploy.run(ssh, command)
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
