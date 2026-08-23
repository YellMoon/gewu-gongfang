const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseService } = require('../database');
const { createAuthorityCloudEpochService } = require('./authorityCloudEpochService');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-cloud-epoch-'));
const previous = { dbPath: process.env.DB_PATH, readDbPath: process.env.READ_DB_PATH };
process.env.DB_PATH = path.join(workspace, 'authority.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
let database;
try {
  database = new DatabaseService();
  const now = '2026-08-24T00:00:00.000Z';
  database.db.prepare(`INSERT INTO users
    (id,name,role,status,login_enabled,review_status,created_at,updated_at)
    VALUES('user-1','Cloud epoch user','visitor',1,1,'approved',?,?)`).run(now, now);
  database.db.prepare(`INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
    VALUES('user-1','authority-1','active',?,?)`).run(now, now);
  const service = createAuthorityCloudEpochService({ db: database.db, now: () => now });
  const first = service.ensure('authority-1');
  const replay = service.ensure('authority-1');
  assert.strictEqual(first.id, replay.id, 'cloud epoch creation must be idempotent');
  assert.strictEqual(first.authority_id, 'authority-1');
  assert.strictEqual(first.generation, 1);
  assert.deepStrictEqual(service.find(first.id), first);
  assert.throws(() => service.ensure('unknown-authority'), error => error?.code === 'AUTHORITY_CLOUD_EPOCH_AUTHORITY_INACTIVE');
  assert.strictEqual(database.db.prepare('SELECT COUNT(*) AS count FROM primary_host_epochs').get().count, 0,
    'cloud epoch creation must not read or create a primary-host epoch');
  console.log('authority cloud epoch service tests passed');
} finally {
  try { database?.close(); } catch (_error) { /* cleanup */ }
  if (previous.dbPath === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = previous.dbPath;
  if (previous.readDbPath === undefined) delete process.env.READ_DB_PATH; else process.env.READ_DB_PATH = previous.readDbPath;
  fs.rmSync(workspace, { recursive: true, force: true });
}
