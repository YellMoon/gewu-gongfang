const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { DatabaseService } = require('../database');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-authority-migration-'));
const dbPath = path.join(workspace, 'scheduling.db');
const previous = {
  dbPath: process.env.DB_PATH,
  readDbPath: process.env.READ_DB_PATH,
  nodeEnv: process.env.NODE_ENV,
};

const legacy = new Database(dbPath);
legacy.exec(`
  CREATE TABLE authority_command_ledger (
    command_id TEXT PRIMARY KEY,
    authority_id TEXT NOT NULL,
    host_epoch_id TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    command_type TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    result_hash TEXT,
    created_at TEXT NOT NULL,
    committed_at TEXT
  );
  CREATE TABLE authority_command_receipts (
    command_id TEXT PRIMARY KEY,
    result_hash TEXT NOT NULL,
    result_payload TEXT NOT NULL,
    completed_at TEXT NOT NULL
  );
  INSERT INTO authority_command_ledger (
    command_id, authority_id, host_epoch_id, actor_user_id, device_id,
    idempotency_key, command_type, payload_hash, status, result_hash,
    created_at, committed_at
  ) VALUES (
    'legacy-command', 'authority-1', 'epoch-1', 'user-1', 'device-1',
    'legacy-key', 'schedule.update.v1', 'payload-hash', 'committed',
    'result-hash', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z'
  );
  INSERT INTO authority_command_receipts (
    command_id, result_hash, result_payload, completed_at
  ) VALUES (
    'legacy-command', 'result-hash', '{"ok":true}', '2026-01-01T00:00:01.000Z'
  );
`);
legacy.close();

let service;
try {
  process.env.DB_PATH = dbPath;
  delete process.env.READ_DB_PATH;
  process.env.NODE_ENV = 'test';

  service = new DatabaseService();
  const columns = new Set(
    service.db.prepare('PRAGMA table_info(authority_command_receipts)').all().map(row => row.name)
  );
  assert(columns.has('projection_version'));
  assert.strictEqual(
    service.db.prepare(
      "SELECT projection_version FROM authority_command_receipts WHERE command_id = 'legacy-command'"
    ).get().projection_version,
    0
  );
  assert(
    service.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'authority_projection_versions'"
    ).get()
  );

  console.log('authority database migration test passed');
} finally {
  if (service) service.close();
  if (previous.dbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previous.dbPath;
  if (previous.readDbPath === undefined) delete process.env.READ_DB_PATH;
  else process.env.READ_DB_PATH = previous.readDbPath;
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;
  fs.rmSync(workspace, { recursive: true, force: true });
}
