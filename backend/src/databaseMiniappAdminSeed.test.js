'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-no-local-identity-seed-'));
const previous = { db: process.env.DB_PATH, read: process.env.READ_DB_PATH, env: process.env.NODE_ENV };
process.env.DB_PATH = path.join(workspace, 'scheduling.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.NODE_ENV = 'production';

try {
  const source = fs.readFileSync(require.resolve('./database'), 'utf8');
  assert.ok(!source.includes('MINIAPP_ADMIN_SEED_USERS'), 'the embedded database must not define local administrator seed identities');
  assert.ok(!source.includes('_seedMiniappAdminUsers'), 'database initialization must not synthesize local login authorities');

  const { DatabaseService } = require('./database');
  const service = new DatabaseService();
  for (const phone of ['13732250653', '18257136756']) {
    assert.strictEqual(service.db.prepare('SELECT id FROM users WHERE phone = ?').get(phone), undefined,
      `fresh embedded caches must not seed identity ${phone}`);
  }
  service.close();
  console.log('embedded identity seed retirement checks passed');
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
  if (previous.db === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = previous.db;
  if (previous.read === undefined) delete process.env.READ_DB_PATH; else process.env.READ_DB_PATH = previous.read;
  if (previous.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.env;
}
