'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { createSyncBatchBackupService } = require('./syncBatchBackupService');

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-sync-batch-'));
  const dbPath = path.join(tempRoot, 'main.db');
  const backupRoot = path.join(tempRoot, 'batch-backups');
  const questionRoot = path.join(tempRoot, 'question-bank');
  const questionDir = path.join(questionRoot, 'questions', 'question-1');
  fs.mkdirSync(questionDir, { recursive: true });
  fs.writeFileSync(path.join(questionDir, 'question.json'), JSON.stringify({ stem: 'before' }));
  fs.writeFileSync(path.join(questionRoot, 'manifest.json'), JSON.stringify({
    questions: { 'question-1': { path: 'questions/question-1/question.json' } },
  }));

  const sqlite = new Database(dbPath);
  sqlite.exec(`
    CREATE TABLE courses(id TEXT PRIMARY KEY, name TEXT, tenant_id TEXT, updated_at TEXT);
    INSERT INTO courses VALUES ('course-1','before','default','2026-07-23T00:00:00.000Z');
    CREATE TABLE questions(id TEXT PRIMARY KEY, storage_state TEXT, tenant_id TEXT, deleted INTEGER, updated_at TEXT);
    INSERT INTO questions VALUES ('question-1','host_committed','default',0,'2026-07-23T00:00:00.000Z');
    CREATE TABLE question_bank_store_bindings(store_id TEXT, root_path TEXT, status TEXT);
    INSERT INTO question_bank_store_bindings VALUES ('store-1','${questionRoot.replace(/'/g, "''")}','active');
    CREATE TABLE primary_host_epochs(id TEXT, generation INTEGER, status TEXT);
    INSERT INTO primary_host_epochs VALUES ('epoch-1',3,'active');
    CREATE TABLE authorization_audit_log(
      id TEXT PRIMARY KEY, actor_user_id TEXT, actor_phone TEXT, target_user_id TEXT,
      action TEXT NOT NULL, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE desktop_sync_batch_backups(
      id TEXT PRIMARY KEY, batch_id TEXT NOT NULL UNIQUE, request_id TEXT,
      source_device_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, change_digest TEXT NOT NULL,
      counts_json TEXT NOT NULL, sqlite_backup_path TEXT NOT NULL,
      question_manifest_json TEXT NOT NULL, result_json TEXT,
      status TEXT NOT NULL, error_code TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, completed_at TEXT
    );
  `);

  const changes = [
    { id: 'change-course-1', table: 'courses', action: 'update', data: { id: 'course-1', name: 'after' } },
    { id: 'change-question-1', table: 'questions', action: 'update', data: { id: 'question-1', stem: 'after' } },
  ];
  const authz = {
    userId: 'owner-1',
    deviceId: 'ordinary-device-1',
    authorizationId: 'authorization-1',
    sessionId: 'session-1',
    activeRole: 'super_admin',
    eligibleRoles: ['super_admin'],
    authVersion: 1,
    credentialVersion: 1,
  };
  const memorySqlite = new Database(':memory:');
  assert.throws(() => createSyncBatchBackupService({
    db: { db: memorySqlite, applySyncChanges() {} },
    validateActor: input => input.authz,
  }), error => error.code === 'SYNC_BATCH_BACKUP_ROOT_REQUIRED');
  memorySqlite.close();
  let applyCalls = 0;
  let applyMode = 'fail-file';
  const db = {
    db: sqlite,
    applySyncChanges() {
      applyCalls += 1;
      sqlite.prepare("UPDATE courses SET name='after' WHERE id='course-1'").run();
      fs.writeFileSync(path.join(questionDir, 'question.json'), JSON.stringify({ stem: 'after' }));
      if (applyMode === 'fail-file') {
        const error = new Error('QUESTION_FILE_REPLACE_FAILED');
        error.code = 'QUESTION_FILE_REPLACE_FAILED';
        throw error;
      }
      return { applied: 2, conflicts: 0, errors: [] };
    },
  };
  const service = createSyncBatchBackupService({
    db,
    backupRoot,
    now: () => new Date('2026-07-23T00:05:00.000Z'),
    uuid: (() => { let sequence = 0; return () => `sync-backup-${++sequence}`; })(),
    validateActor: input => input.authz,
  });
  assert.throws(() => service.preflightBatch({ batchId: 'batch-empty', changes: [], authz }),
    error => error.code === 'SYNC_BATCH_CHANGES_REQUIRED');

  const writesBefore = sqlite.prepare('SELECT total_changes() value').get().value;
  const preflight = service.preflightBatch({ batchId: 'batch-preflight', changes, authz });
  assert.strictEqual(sqlite.prepare('SELECT total_changes() value').get().value, writesBefore,
    'preflight must not write');
  assert.deepStrictEqual(preflight.counts, { create: 0, update: 2, delete: 0, conflict: 0, rejected: 0 });
  assert.strictEqual(preflight.manifest.questions.length, 1);
  assert.strictEqual(preflight.manifest.questions[0].id, 'question-1');
  assert.ok(!JSON.stringify(preflight.manifest).includes(questionRoot), 'manifest must not expose absolute question paths');

  let failedBackupApplyCalls = 0;
  const backupFailureService = createSyncBatchBackupService({
    db: { db: sqlite, applySyncChanges() { failedBackupApplyCalls += 1; } },
    backupRoot,
    validateActor: input => input.authz,
    backupDatabase: async () => { throw Object.assign(new Error('SQLITE_BACKUP_FAILED'), { code: 'SQLITE_BACKUP_FAILED' }); },
  });
  await assert.rejects(
    backupFailureService.applyAuthorizedSyncBatch({ batchId: 'batch-backup-fail', changes, authz }),
    error => error.code === 'SQLITE_BACKUP_FAILED'
  );
  assert.strictEqual(failedBackupApplyCalls, 0, 'backup failure must prevent applySyncChanges');

  await assert.rejects(
    service.applyAuthorizedSyncBatch({ batchId: 'batch-file-fail', requestId: 'request-fail', changes, authz }),
    error => error.code === 'QUESTION_FILE_REPLACE_FAILED'
  );
  assert.strictEqual(sqlite.prepare("SELECT name FROM courses WHERE id='course-1'").get().name, 'before');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(questionDir, 'question.json'), 'utf8')), { stem: 'before' });
  assert.strictEqual(
    sqlite.prepare("SELECT status FROM desktop_sync_batch_backups WHERE batch_id='batch-file-fail'").get().status,
    'failed'
  );

  applyMode = 'success';
  const applied = await service.applyAuthorizedSyncBatch({
    batchId: 'batch-success',
    requestId: 'request-success',
    changes,
    authz,
  });
  assert.strictEqual(applied.applied, 2);
  assert.ok(applied.backupId.startsWith('sync-backup-'));
  assert.strictEqual(applied.sqliteBackupPath, undefined, 'host backup paths must not cross the desktop sync response boundary');
  const recovery = service.readBatchRecoveryRecord('batch-success');
  assert.ok(fs.existsSync(recovery.sqliteBackupPath));
  const audit = sqlite.prepare(
    "SELECT after_json FROM authorization_audit_log WHERE action='desktop_sync_batch_applied'"
  ).get();
  const auditJson = JSON.parse(audit.after_json);
  assert.strictEqual(auditJson.batchId, 'batch-success');
  assert.strictEqual(auditJson.sourceDeviceId, authz.deviceId);
  assert.strictEqual(auditJson.counts.update, 2);
  assert.strictEqual(auditJson.backupId, applied.backupId);
  assert.strictEqual(auditJson.epochId, 'epoch-1');
  assert.strictEqual(auditJson.generation, 3);

  const callsBeforeReplay = applyCalls;
  const replay = await service.applyAuthorizedSyncBatch({
    batchId: 'batch-success',
    requestId: 'request-success',
    changes,
    authz,
  });
  assert.strictEqual(replay.idempotent, true);
  assert.strictEqual(replay.backupId, applied.backupId);
  assert.strictEqual(applyCalls, callsBeforeReplay, 'applied batch replay must not call applySyncChanges again');

  sqlite.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log('sync batch backup service checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
