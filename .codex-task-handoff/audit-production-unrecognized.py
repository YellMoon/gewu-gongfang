from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scripts.deploy as deploy


REMOTE_SCRIPT = "/tmp/gewu-audit-production-unrecognized.js"
SCRIPT = r"""
'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const Database = require('/root/scheduling-backend/node_modules/better-sqlite3');
const jwt = require('/root/scheduling-backend/node_modules/jsonwebtoken');

const BACKEND_ROOT = 'https://physicsedu.xyz/scheduling';
const GATEWAY_ROOT = 'https://physicsedu.xyz';
const DB_PATH = '/root/scheduling-data/prod/scheduling.db';

function pm2Processes() {
  return JSON.parse(childProcess.execFileSync('pm2', ['jlist'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }));
}

function processMatches(process, fragment) {
  const env = process.pm2_env || {};
  const haystack = [env.pm_cwd, env.pm_exec_path, env.name].filter(Boolean).join(' ');
  return haystack.includes(fragment);
}

function logFiles(processes) {
  return [...new Set(processes.flatMap((process) => {
    const env = process.pm2_env || {};
    return [env.pm_out_log_path, env.pm_err_log_path].filter(Boolean);
  }))];
}

function snapshotSizes(paths) {
  return new Map(paths.map((path) => {
    try { return [path, fs.statSync(path).size]; } catch (_error) { return [path, 0]; }
  }));
}

function readDeltas(paths, before) {
  const chunks = [];
  for (const path of paths) {
    try {
      const size = fs.statSync(path).size;
      const start = Math.min(before.get(path) || 0, size);
      if (size <= start) continue;
      const length = size - start;
      const buffer = Buffer.alloc(length);
      const fd = fs.openSync(path, 'r');
      try { fs.readSync(fd, buffer, 0, length, start); } finally { fs.closeSync(fd); }
      chunks.push(buffer.toString('utf8'));
    } catch (_error) {
      // A missing/rotated log is reported separately instead of exposing its content.
    }
  }
  return chunks.join('\n');
}

function request(name, url, token, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'user-agent': 'gewu-security-probe/1.0',
        accept: 'application/json',
      },
      timeout: 15000,
    }, (res) => {
      let prefix = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (prefix.length < 4096) prefix += chunk.slice(0, 4096 - prefix.length);
      });
      res.on('end', () => {
        let code = null;
        try { code = JSON.parse(prefix).code || null; } catch (_error) { /* non-JSON success body */ }
        resolve({ name, status: Number(res.statusCode || 0), code });
      });
    });
    req.on('timeout', () => req.destroy(new Error('REQUEST_TIMEOUT')));
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const processes = pm2Processes();
  const backendProcess = processes.find((process) => processMatches(process, '/root/scheduling-backend'));
  if (!backendProcess) throw new Error('BACKEND_PM2_PROCESS_NOT_FOUND');
  const jwtSecret = String(backendProcess.pm2_env?.JWT_SECRET || '');
  if (jwtSecret.length < 32) throw new Error('BACKEND_JWT_SECRET_INVALID');

  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const user = db.prepare(`SELECT id, auth_version FROM users
      WHERE deleted=0
        AND status IS NOT 0
        AND COALESCE(CAST(status AS TEXT), 'active') NOT IN ('inactive', 'disabled')
        AND disabled_at IS NULL
        AND NOT (review_status='approved' AND login_enabled=1)
      ORDER BY created_at, id LIMIT 1`).get();
    if (!user) throw new Error('ELIGIBLE_UNRECOGNIZED_USER_NOT_FOUND');

    const token = jwt.sign({
      sub: String(user.id),
      sid: crypto.randomUUID(),
      token_use: 'unrecognized-student',
      auth_version: Number(user.auth_version || 1),
      iss: 'gewu-miniapp-auth',
      aud: 'gewu-miniapp-experience',
    }, jwtSecret, { algorithm: 'HS256', expiresIn: '5m' });

    const paths = logFiles(processes.filter((process) => (
      processMatches(process, '/root/scheduling-backend')
        || processMatches(process, 'gateway')
    )));
    const before = snapshotSizes(paths);

    const results = [];
    for (const [name, url, method] of [
      ['backend-auth-me', `${BACKEND_ROOT}/api/auth/me`, 'GET'],
      ['backend-application-me', `${BACKEND_ROOT}/api/miniapp/applications/me`, 'GET'],
      ['backend-experience-questions', `${BACKEND_ROOT}/api/experience/questions`, 'GET'],
      ['backend-formal-students', `${BACKEND_ROOT}/api/students`, 'GET'],
      ['backend-formal-courses', `${BACKEND_ROOT}/api/courses`, 'GET'],
      ['backend-formal-question-bank', `${BACKEND_ROOT}/api/question-bank/questions`, 'GET'],
      ['backend-formal-cloud', `${BACKEND_ROOT}/api/cloud/snapshots/read`, 'GET'],
      ['backend-formal-desktop-identity', `${BACKEND_ROOT}/api/desktop-identity/devices`, 'GET'],
      ['backend-formal-desktop-pairing', `${BACKEND_ROOT}/api/desktop-pairing/pending`, 'GET'],
      ['backend-formal-sync', `${BACKEND_ROOT}/api/sync/changes`, 'GET'],
      ['backend-formal-admin', `${BACKEND_ROOT}/api/admin/users`, 'GET'],
      ['backend-formal-permissions', `${BACKEND_ROOT}/api/permissions/my`, 'GET'],
      ['gateway-permissions', `${GATEWAY_ROOT}/api/permissions/my`, 'GET'],
      ['gateway-cloud', `${GATEWAY_ROOT}/api/cloud/tasks`, 'GET'],
      ['gateway-review-login', `${GATEWAY_ROOT}/api/auth/review-demo`, 'POST'],
      ['gateway-review-route', `${GATEWAY_ROOT}/api/review-demo/questions`, 'GET'],
    ]) {
      results.push(await request(name, url, token, method));
    }

    const logDelta = readDeltas(paths, before);
    const loginEventColumns = db.prepare('PRAGMA table_info(miniapp_login_events)').all().map((row) => row.name);
    const forbiddenColumns = ['code', 'phone_code', 'phoneCode', 'jwt', 'token', 'access_token', 'request_body'];
    const forbiddenPresent = forbiddenColumns.filter((name) => loginEventColumns.includes(name));
    const expected = new Map([
      ['backend-auth-me', [200, null]],
      ['backend-application-me', [200, null]],
      ['backend-experience-questions', [200, null]],
      ['backend-formal-students', [403, 'UNRECOGNIZED_SCOPE_FORBIDDEN']],
      ['backend-formal-courses', [403, 'UNRECOGNIZED_SCOPE_FORBIDDEN']],
      ['backend-formal-question-bank', [403, 'UNRECOGNIZED_SCOPE_FORBIDDEN']],
      ['backend-formal-cloud', [403, 'UNRECOGNIZED_SCOPE_FORBIDDEN']],
      ['backend-formal-desktop-identity', [403, 'UNRECOGNIZED_SCOPE_FORBIDDEN']],
      ['backend-formal-desktop-pairing', [403, 'UNRECOGNIZED_SCOPE_FORBIDDEN']],
      ['backend-formal-sync', [403, 'UNRECOGNIZED_SCOPE_FORBIDDEN']],
      ['backend-formal-admin', [403, 'UNRECOGNIZED_SCOPE_FORBIDDEN']],
      ['backend-formal-permissions', [403, 'UNRECOGNIZED_SCOPE_FORBIDDEN']],
      ['gateway-permissions', [401, 'EXPERIENCE_TOKEN_NOT_ACCEPTED_BY_GATEWAY']],
      ['gateway-cloud', [401, 'EXPERIENCE_TOKEN_NOT_ACCEPTED_BY_GATEWAY']],
      ['gateway-review-login', [410, 'REVIEW_DEMO_REMOVED']],
      ['gateway-review-route', [410, 'REVIEW_DEMO_REMOVED']],
    ]);
    const mismatches = results.filter((item) => {
      const [status, code] = expected.get(item.name);
      return item.status !== status || item.code !== code;
    }).map((item) => item.name);

    console.log(JSON.stringify({
      quickCheck: db.pragma('quick_check', { simple: true }),
      results,
      mismatches,
      logFilesObserved: paths.length,
      probeTokenLeaked: logDelta.includes(token),
      authorizationHeaderLeaked: logDelta.includes(`Bearer ${token}`),
      loginEventForbiddenColumns: forbiddenPresent,
    }));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: String(error?.message || error) }));
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
        command = f"node {REMOTE_SCRIPT}; status=$?; rm -f {REMOTE_SCRIPT}; exit $status"
        _, stdout, stderr = ssh.exec_command(command)
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
