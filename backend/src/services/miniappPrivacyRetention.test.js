'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseService } = require('../database');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-miniapp-retention-'));
const previous = { dbPath: process.env.DB_PATH, readDbPath: process.env.READ_DB_PATH };
process.env.DB_PATH = path.join(workspace, 'retention.db');
process.env.READ_DB_PATH = process.env.DB_PATH;

let database;
try {
  database = new DatabaseService();
  const db = database.db;
  const { runMiniappPrivacyRetention } = require('./miniappPrivacyRetention');
  const old = '2025-01-01T00:00:00.000Z';
  const recent = '2026-07-01T00:00:00.000Z';
  db.prepare(`INSERT INTO users
    (id, phone, phone_normalized, name, role, status, login_enabled, review_status, deleted, created_at, updated_at)
    VALUES ('retention-user', '13800138000', '13800138000', 'Retention User', 'pending', 1, 0, 'pending', 0, ?, ?)`)
    .run(old, old);
  const insertEvent = db.prepare(`INSERT INTO miniapp_login_events
    (id, user_id, phone_normalized, identity_kind, result_code, session_id, created_at)
    VALUES (?, 'retention-user', ?, 'unrecognized', 'UNRECOGNIZED_LOGIN_SUCCESS', ?, ?)`);
  insertEvent.run('old-event', '13800138000', 'old-session', old);
  insertEvent.run('recent-event', '13800138000', 'recent-session', recent);

  const insertApplication = db.prepare(`INSERT INTO miniapp_role_applications
    (id, applicant_user_id, application_type, status, revision, payload_json, payload_hash,
     idempotency_key, verified_phone_normalized, student_phone_normalized,
     parent_phone_normalized, applicant_identity_kind, submitted_at, created_at, updated_at)
    VALUES (?, 'retention-user', 'student', ?, 1, ?, ?, ?, '13800138000', '13800138000',
      '13800138001', 'student', ?, ?, ?)`);
  function application(id, status, timestamp) {
    insertApplication.run(
      id,
      status,
      JSON.stringify({ studentName: 'Private Student', studentPhone: '13800138000', parentPhone: '13800138001' }),
      `hash-${id}`,
      `key-${id}`,
      timestamp,
      timestamp,
      timestamp,
    );
  }
  application('old-rejected', 'rejected', old);
  application('old-withdrawn', 'withdrawn', old);
  application('old-approved', 'approved', old);
  application('old-submitted', 'submitted', old);
  application('recent-rejected', 'rejected', recent);

  const result = runMiniappPrivacyRetention(db, new Date('2026-07-22T00:00:00.000Z'));
  assert.deepStrictEqual(result, {
    loginEventsRedacted: 1,
    rejectedPayloadsRedacted: 2,
    approvedPayloadsRedacted: 1,
  });
  assert.strictEqual(db.prepare("SELECT phone_normalized FROM miniapp_login_events WHERE id='old-event'").get().phone_normalized, '[redacted]');
  assert.strictEqual(db.prepare("SELECT phone_normalized FROM miniapp_login_events WHERE id='recent-event'").get().phone_normalized, '13800138000');
  assert.deepStrictEqual(
    db.prepare("SELECT payload_json, verified_phone_normalized, student_phone_normalized, parent_phone_normalized FROM miniapp_role_applications WHERE id='old-rejected'").get(),
    { payload_json: '{}', verified_phone_normalized: '[redacted]', student_phone_normalized: null, parent_phone_normalized: null },
  );
  assert.notStrictEqual(db.prepare("SELECT payload_json FROM miniapp_role_applications WHERE id='old-submitted'").get().payload_json, '{}');
  assert.notStrictEqual(db.prepare("SELECT payload_json FROM miniapp_role_applications WHERE id='recent-rejected'").get().payload_json, '{}');
  assert.strictEqual(db.prepare("SELECT phone FROM users WHERE id='retention-user'").get().phone, '13800138000', 'authentication identity phone must be preserved');
  assert.deepStrictEqual(runMiniappPrivacyRetention(db, new Date('2026-07-22T00:00:00.000Z')), {
    loginEventsRedacted: 0,
    rejectedPayloadsRedacted: 0,
    approvedPayloadsRedacted: 0,
  }, 'retention must be idempotent');
  console.log('miniapp privacy retention checks passed');
} finally {
  try { database?.close(); } catch (_error) { /* best effort */ }
  if (previous.dbPath === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = previous.dbPath;
  if (previous.readDbPath === undefined) delete process.env.READ_DB_PATH; else process.env.READ_DB_PATH = previous.readDbPath;
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch (_error) { /* best effort */ }
}
