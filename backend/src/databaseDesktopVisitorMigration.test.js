const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { DatabaseService } = require('./database');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-desktop-visitor-migration-'));
const dbPath = path.join(workspace, 'schema-3121.db');
const schemaPath = path.join(__dirname, 'schema.sql');
const currentSessionConstraint =
  "active_role TEXT NOT NULL CHECK (active_role IN ('visitor', 'super_admin', 'admin', 'teacher', 'student'))";
const legacySessionConstraint =
  "active_role TEXT NOT NULL CHECK (active_role IN ('super_admin', 'admin', 'teacher', 'student'))";
const previousEnvironment = {
  dbPath: process.env.DB_PATH,
  readDbPath: process.env.READ_DB_PATH,
  nodeEnv: process.env.NODE_ENV,
  schemaVersion: process.env.SCHEMA_VERSION,
};

let service;
try {
  const currentSchema = fs.readFileSync(schemaPath, 'utf8');
  assert.ok(currentSchema.includes(currentSessionConstraint));
  const legacySchema = currentSchema.replace(currentSessionConstraint, legacySessionConstraint);
  assert.ok(!legacySchema.includes(currentSessionConstraint));

  const legacyDb = new Database(dbPath);
  legacyDb.pragma('foreign_keys = ON');
  legacyDb.exec(legacySchema);

  const now = '2026-08-02T00:00:00.000Z';
  legacyDb.prepare(`INSERT INTO users
    (id, phone, name, role, status, login_enabled, review_status, auth_version,
     deleted, created_at, updated_at)
    VALUES ('migration-user', '13000000021', 'Migration User', 'admin', 1, 1,
      'approved', 3, 0, ?, ?)`)
    .run(now, now);
  legacyDb.prepare(`INSERT INTO desktop_device_authorizations
    (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
     status, source_challenge_id, authorization_source, last_phone_verified_at,
     phone_reverify_due_at, credential_version, row_version, created_at, updated_at)
    VALUES ('migration-authorization', 'migration-device', 'Migration Device',
      'desktop-client', 'migration-user', 'migration-public-key', ?, 'active',
      'migration-challenge', 'wechat_phone', ?, '2026-09-02T00:00:00.000Z',
      5, 7, ?, ?)`)
    .run('a'.repeat(64), now, now, now);
  legacyDb.prepare(`INSERT INTO desktop_sessions
    (sid, user_id, device_id, authorization_id, active_role, eligible_roles_json,
     auth_version, credential_version, auth_time, status, issued_at, expires_at,
     last_seen_at, revoke_reason, revoked_at, row_version, created_at, updated_at)
    VALUES ('formal-session', 'migration-user', 'migration-device',
      'migration-authorization', 'admin', '["admin"]', 3, 5, ?, 'active', ?,
      '2026-08-16T00:00:00.000Z', ?, NULL, NULL, 9, ?, ?)`)
    .run(now, now, now, now, now);
  legacyDb.prepare(`INSERT OR REPLACE INTO schema_migrations
    (version, name, checksum, applied_at, app_env, rollback_notes)
    VALUES (3121, 'pre-visitor-desktop-sessions', 'legacy-3121-checksum', ?, 'prod',
      'restore schema 3121 snapshot')`)
    .run(now);
  legacyDb.pragma('user_version = 3121');
  assert.deepStrictEqual(legacyDb.pragma('foreign_key_check'), []);
  legacyDb.close();

  process.env.DB_PATH = dbPath;
  process.env.READ_DB_PATH = dbPath;
  process.env.NODE_ENV = 'production';
  process.env.SCHEMA_VERSION = '3122';
  service = new DatabaseService();

  assert.strictEqual(service.db.pragma('user_version', { simple: true }), 3122);
  assert.deepStrictEqual(
    service.db.prepare(`SELECT version, name, checksum, applied_at, app_env, rollback_notes
      FROM schema_migrations WHERE version = 3121`).get(),
    {
      version: 3121,
      name: 'pre-visitor-desktop-sessions',
      checksum: 'legacy-3121-checksum',
      applied_at: now,
      app_env: 'prod',
      rollback_notes: 'restore schema 3121 snapshot',
    },
  );
  assert.ok(service.db.prepare(
    'SELECT 1 FROM schema_migrations WHERE version = 3122'
  ).get());

  const formalSession = service.db.prepare(
    'SELECT * FROM desktop_sessions WHERE sid=?'
  ).get('formal-session');
  assert.ok(formalSession);
  assert.strictEqual(formalSession.active_role, 'admin');
  assert.strictEqual(formalSession.authorization_id, 'migration-authorization');
  assert.strictEqual(formalSession.row_version, 9);

  for (const indexName of [
    'idx_desktop_sessions_device_status',
    'idx_desktop_sessions_user_status',
  ]) {
    assert.ok(service.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?"
    ).get(indexName));
  }

  const sessionForeignKeys = service.db.prepare(
    'PRAGMA foreign_key_list(desktop_sessions)'
  ).all();
  assert.deepStrictEqual(
    new Set(sessionForeignKeys.map(row => row.table)),
    new Set(['users', 'desktop_device_authorizations']),
  );
  assert.ok(service.db.prepare(
    'PRAGMA foreign_key_list(primary_host_preflight_proofs)'
  ).all().some(row => row.table === 'desktop_sessions' && row.from === 'session_id'));
  assert.deepStrictEqual(service.db.pragma('foreign_key_check'), []);

  const insertSession = service.db.prepare(`INSERT INTO desktop_sessions
    (sid, user_id, device_id, authorization_id, active_role, eligible_roles_json,
     auth_version, credential_version, status, issued_at, expires_at, row_version,
     created_at, updated_at)
    VALUES (?, 'migration-user', 'migration-device', 'migration-authorization', ?, ?,
      3, 5, 'active', ?, '2026-08-16T00:00:00.000Z', 1, ?, ?)`);
  insertSession.run('visitor-session', 'visitor', '["visitor"]', now, now, now);
  insertSession.run('teacher-session', 'teacher', '["teacher"]', now, now, now);
  assert.throws(
    () => insertSession.run('invalid-role-session', 'owner', '["owner"]', now, now, now),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => service.db.prepare(`INSERT INTO desktop_sessions
      (sid, user_id, device_id, authorization_id, active_role, eligible_roles_json,
       auth_version, credential_version, status, issued_at, expires_at, row_version,
       created_at, updated_at)
      VALUES ('invalid-fk-session', 'missing-user', 'migration-device',
        'migration-authorization', 'visitor', '["visitor"]', 1, 1, 'active', ?, ?, 1, ?, ?)`)
      .run(now, '2026-08-16T00:00:00.000Z', now, now),
    /FOREIGN KEY constraint failed/,
  );

  console.log('database desktop visitor migration tests passed');
} finally {
  if (service) service.close();
  if (previousEnvironment.dbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousEnvironment.dbPath;
  if (previousEnvironment.readDbPath === undefined) delete process.env.READ_DB_PATH;
  else process.env.READ_DB_PATH = previousEnvironment.readDbPath;
  if (previousEnvironment.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnvironment.nodeEnv;
  if (previousEnvironment.schemaVersion === undefined) delete process.env.SCHEMA_VERSION;
  else process.env.SCHEMA_VERSION = previousEnvironment.schemaVersion;
  fs.rmSync(workspace, { recursive: true, force: true });
}
