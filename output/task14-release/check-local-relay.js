const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

function derive(seed, scope) {
  return crypto.createHmac('sha256', seed).update(`gewu-desktop-runtime:${scope}`).digest('hex');
}

const configPath = path.join(process.env.APPDATA, 'gewu-gongfang', 'gewugongfang.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (!config.desktopSyncToken || Buffer.byteLength(config.desktopSyncToken, 'utf8') < 32) {
  throw new Error('strong desktop sync token is required');
}

const db = new Database(config.mainDbPath, { readonly: true, fileMustExist: true });
const actor = db.prepare("SELECT id, role FROM users WHERE deleted=0 AND status=1 AND role IN ('super_admin','admin') ORDER BY CASE role WHEN 'super_admin' THEN 0 ELSE 1 END LIMIT 1").get();
db.close();
if (!actor) throw new Error('active local administrator is required');

const token = jwt.sign(
  { id: actor.id, role: actor.role },
  derive(config.desktopSyncToken, 'jwt'),
  { algorithm: 'HS256', expiresIn: '5m' },
);
const baseUrl = config.hostBaseUrl || 'http://127.0.0.1:3001';
const result = spawnSync(
  process.execPath,
  [path.resolve(__dirname, '..', '..', 'scripts', 'check_cloud_relay_host.js'), baseUrl],
  {
    cwd: path.resolve(__dirname, '..', '..'),
    env: { ...process.env, SMOKE_JWT: token },
    encoding: 'utf8',
    timeout: 120000,
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
