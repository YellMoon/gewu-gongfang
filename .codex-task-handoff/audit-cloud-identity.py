from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scripts.deploy as deploy


REMOTE_SCRIPT = "/tmp/gewu-audit-cloud-identity.js"
SCRIPT = r"""
'use strict';
const Database = require('/root/scheduling-backend/node_modules/better-sqlite3');
const db = new Database('/root/scheduling-data/prod/scheduling.db', { readonly: true });
const all = (sql) => db.prepare(sql).all();
const get = (sql) => db.prepare(sql).get();
const result = {
  quickCheck: db.pragma('quick_check', { simple: true }),
  schemaVersion: db.pragma('user_version', { simple: true }),
  epochCounts: all('SELECT status, COUNT(*) AS count FROM primary_host_epochs GROUP BY status ORDER BY status'),
  activeEpoch: get("SELECT generation, activation_reason AS activationReason, schema_version AS schemaVersion, CASE WHEN device_id IS NOT NULL THEN 1 ELSE 0 END AS hasDevice, CASE WHEN authorization_id IS NOT NULL THEN 1 ELSE 0 END AS hasAuthorization FROM primary_host_epochs WHERE status='active' ORDER BY generation DESC LIMIT 1") || null,
  authorizationCounts: all('SELECT device_kind AS deviceKind, status, COUNT(*) AS count FROM desktop_device_authorizations GROUP BY device_kind, status ORDER BY device_kind, status'),
  eligibleUnrecognizedUsers: get("SELECT COUNT(*) AS count FROM users WHERE deleted=0 AND COALESCE(status, 'active') NOT IN ('inactive','disabled') AND disabled_at IS NULL AND NOT (review_status='approved' AND login_enabled=1)").count,
  multiDeviceUsers: get("SELECT COUNT(*) AS count FROM (SELECT user_id FROM desktop_device_authorizations WHERE status='active' GROUP BY user_id HAVING COUNT(*) >= 2)").count,
  canonicalDualRole: get("SELECT COUNT(*) AS count FROM users u WHERE u.deleted=0 AND u.is_super_admin_identity=1 AND u.teacher_id IS NOT NULL AND EXISTS (SELECT 1 FROM user_role_grants g WHERE g.user_id=u.id AND g.role='super_admin' AND g.status='active') AND EXISTS (SELECT 1 FROM user_role_grants g WHERE g.user_id=u.id AND g.role='teacher' AND g.status='active' AND g.subject_id=u.teacher_id)").count,
  pendingChallenges: get("SELECT COUNT(*) AS count FROM desktop_identity_challenges WHERE status IN ('pending_phone','identity_verified_pending_approval','approved_pending_exchange')").count,
  pendingHostChallenges: get("SELECT COUNT(*) AS count FROM primary_host_operation_challenges WHERE status IN ('pending_phone','identity_verified')").count,
  transferCounts: all('SELECT status, COUNT(*) AS count FROM host_transfers GROUP BY status ORDER BY status'),
};
console.log(JSON.stringify(result));
db.close();
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
            raise SystemExit(error or f"remote audit failed: {status}")
        parsed = json.loads(output)
        print(json.dumps(parsed, ensure_ascii=False, indent=2))
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
