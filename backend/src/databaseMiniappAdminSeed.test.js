const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DatabaseService } = require('./database');

const ADMIN_PHONES = ['13732250653', '18257136756'];
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-miniapp-admin-seed-'));
const previousDbPath = process.env.DB_PATH;
const previousReadDbPath = process.env.READ_DB_PATH;
const previousNodeEnv = process.env.NODE_ENV;

process.env.DB_PATH = path.join(workspace, 'scheduling.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.NODE_ENV = 'production';

try {
  const service = new DatabaseService();
  const rows = service.db.prepare(
    `SELECT phone, role, login_enabled, status, deleted
     FROM users
     WHERE phone IN (${ADMIN_PHONES.map(() => '?').join(',')})
     ORDER BY phone`
  ).all(...ADMIN_PHONES);

  assert.deepStrictEqual(rows.map(row => row.phone), ADMIN_PHONES.slice().sort());
  rows.forEach(row => {
    assert.strictEqual(row.role, 'admin');
    assert.strictEqual(row.login_enabled, 1);
    assert.strictEqual(row.status, 1);
    assert.strictEqual(row.deleted, 0);
  });

  service.db.prepare(
    'UPDATE users SET status = 0, login_enabled = 0, deleted = 1 WHERE phone = ?'
  ).run(ADMIN_PHONES[0]);
  service.close();

  const restarted = new DatabaseService();
  const revoked = restarted.db.prepare(
    'SELECT role, login_enabled, status, deleted FROM users WHERE phone = ?'
  ).get(ADMIN_PHONES[0]);
  assert.strictEqual(revoked.status, 0, 'restart must preserve an explicit account disable');
  assert.strictEqual(revoked.login_enabled, 0, 'restart must preserve revoked miniapp login access');
  assert.strictEqual(revoked.deleted, 1, 'restart must preserve an explicit account deletion');

  const counts = restarted.db.prepare(
    `SELECT phone, COUNT(*) AS count
     FROM users
     WHERE phone IN (${ADMIN_PHONES.map(() => '?').join(',')})
     GROUP BY phone
     ORDER BY phone`
  ).all(...ADMIN_PHONES);
  assert.deepStrictEqual(counts.map(row => [row.phone, row.count]), ADMIN_PHONES.slice().sort().map(phone => [phone, 1]));
  restarted.close();
  console.log('database miniapp admin seed checks passed');
} finally {
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  if (previousReadDbPath === undefined) delete process.env.READ_DB_PATH;
  else process.env.READ_DB_PATH = previousReadDbPath;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
}
