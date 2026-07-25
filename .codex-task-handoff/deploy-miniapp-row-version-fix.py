#!/usr/bin/env python3
"""Deploy the desktop miniapp rowVersion projection fix with backups."""

import base64
import hashlib
import os
import secrets
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("APP_ENV", "prod")

from scripts import deploy


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOCAL_FILE = PROJECT_ROOT / "backend" / "src" / "services" / "desktopIdentityService.js"
REMOTE_FILE = f"{deploy.REMOTE_DIR}/src/services/desktopIdentityService.js"


def main():
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = f"/root/scheduling-backend-backups/{stamp}-miniapp-row-version"
    remote_temp = f"/tmp/gewu-desktop-identity-{secrets.token_hex(12)}.js"
    local_hash = hashlib.sha256(LOCAL_FILE.read_bytes()).hexdigest()
    backup_script = r"""
const path = require('path');
const Database = require('./node_modules/better-sqlite3');
const db = new Database(process.env.DB_PATH, { readonly: true, fileMustExist: true });
db.backup(process.env.BACKUP_DB).then(result => {
  console.log(JSON.stringify({ backupComplete: true, pages: result.totalPages }));
  db.close();
}).catch(error => { db.close(); throw error; });
"""
    backup_payload = base64.b64encode(backup_script.encode("utf-8")).decode("ascii")
    verify_script = r"""
const Database = require('./node_modules/better-sqlite3');
const db = new Database(process.env.DB_PATH, { readonly: true, fileMustExist: true });
const row = db.prepare("SELECT id FROM desktop_identity_challenges WHERE device_id='desktop_host_001' ORDER BY created_at DESC LIMIT 1").get();
if (!row) throw new Error('challenge not found');
fetch(`http://127.0.0.1:3002/api/desktop-identity/challenges/${encodeURIComponent(row.id)}/public`)
  .then(async response => {
    const body = await response.json();
    const challenge = body?.data?.challenge || {};
    console.log(JSON.stringify({ statusCode: response.status, success: body?.success,
      keys: Object.keys(challenge).sort(), rowVersion: challenge.rowVersion }));
    if (!response.ok || body?.success !== true || !Number.isSafeInteger(challenge.rowVersion) || challenge.rowVersion < 1) process.exitCode = 2;
  }).finally(() => db.close());
"""
    verify_payload = base64.b64encode(verify_script.encode("utf-8")).decode("ascii")

    ssh = deploy.connect()
    sftp = ssh.open_sftp()
    try:
        deploy.run(ssh, f"test ! -e '{backup_dir}' && mkdir -p '{backup_dir}'")
        deploy.run(ssh, f"cp --preserve=all '{REMOTE_FILE}' '{backup_dir}/desktopIdentityService.js'")
        deploy.run_with_remote_env(
            ssh,
            f"cd '{deploy.REMOTE_DIR}' && BACKUP_DB='{backup_dir}/scheduling.db' "
            f"node -e \"eval(Buffer.from('{backup_payload}','base64').toString('utf8'))\"",
            timeout=180,
        )
        sftp.put(str(LOCAL_FILE), remote_temp)
        sftp.chmod(remote_temp, 0o644)
        deploy.run(
            ssh,
            f"test \"$(sha256sum '{remote_temp}' | awk '{{print $1}}')\" = '{local_hash}' && "
            f"node --check '{remote_temp}' && mv '{remote_temp}' '{REMOTE_FILE}'",
        )
        deploy.run(ssh, "pm2 restart scheduling-backend-prod", timeout=30)
        deploy.wait_for_remote_health(ssh, deploy.APP_PORT, "backend", deploy.read_root_version())
        deploy.run_with_remote_env(
            ssh,
            f"cd '{deploy.REMOTE_DIR}' && node -e \"eval(Buffer.from('{verify_payload}','base64').toString('utf8'))\"",
            timeout=30,
        )
        print(f"ROLLBACK_CODE={backup_dir}/desktopIdentityService.js")
        print(f"ROLLBACK_DB={backup_dir}/scheduling.db")
    finally:
        try:
            sftp.remove(remote_temp)
        except OSError:
            pass
        sftp.close()
        ssh.close()


if __name__ == "__main__":
    main()
