'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

function batchError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function safeText(value, code, max = 160) {
  const text = String(value || '').trim();
  if (!text || text.length > max || /[\0\r\n]/.test(text)) throw batchError(code);
  return text;
}

function sqliteOf(input) {
  const sqlite = input?.db || input;
  if (!sqlite || typeof sqlite.prepare !== 'function' || typeof sqlite.transaction !== 'function') {
    throw batchError('SYNC_BATCH_DATABASE_REQUIRED');
  }
  return sqlite;
}

function ensureInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw batchError('SYNC_BATCH_PATH_INVALID');
  }
  return resolved;
}

function fsyncFile(filePath) {
  const handle = fs.openSync(filePath, 'r+');
  try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
}

function copyFileDurable(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.copyFileSync(source, temporary);
    fsyncFile(temporary);
    fs.renameSync(temporary, destination);
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true }); } catch (_cleanupError) {}
    throw error;
  }
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) copyFileDurable(from, to);
  }
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch (_error) { return fallback; }
}

function presentRecord(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    backupId: row.id,
    batchId: row.batch_id,
    requestId: row.request_id || null,
    sourceDeviceId: row.source_device_id,
    actorUserId: row.actor_user_id,
    changeDigest: row.change_digest,
    counts: parseJson(row.counts_json, {}),
    sqliteBackupPath: row.sqlite_backup_path,
    manifest: parseJson(row.question_manifest_json, { questions: [] }),
    result: parseJson(row.result_json, null),
    status: row.status,
    errorCode: row.error_code || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
  });
}

function createSyncBatchBackupService({
  db,
  backupRoot,
  now = () => new Date(),
  uuid = uuidv4,
  validateActor,
  backupDatabase,
} = {}) {
  const sqlite = sqliteOf(db);
  const wrapper = db?.applySyncChanges ? db : null;
  if (!wrapper) throw batchError('SYNC_BATCH_APPLIER_REQUIRED');
  if (typeof validateActor !== 'function') throw batchError('SYNC_BATCH_ACTOR_VALIDATOR_REQUIRED');
  const resolvedBackupRoot = backupRoot || (
    sqlite.name && sqlite.name !== ':memory:'
      ? path.join(path.dirname(sqlite.name), 'sync-batch-backups')
      : ''
  );
  if (!resolvedBackupRoot) throw batchError('SYNC_BATCH_BACKUP_ROOT_REQUIRED');
  const configuredBackupRoot = path.resolve(resolvedBackupRoot);
  const performBackup = backupDatabase || (destination => sqlite.backup(destination));

  function timestamp() {
    const value = now();
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw batchError('SYNC_BATCH_CLOCK_INVALID');
    return date.toISOString();
  }

  function activeQuestionBinding() {
    try {
      return sqlite.prepare("SELECT store_id,root_path FROM question_bank_store_bindings WHERE status='active' ORDER BY rowid DESC LIMIT 1").get() || null;
    } catch (_error) {
      return null;
    }
  }

  function buildManifest(changes) {
    const binding = activeQuestionBinding();
    const questions = [];
    const seen = new Set();
    for (const change of changes) {
      if (change?.table !== 'questions' || change?.action !== 'update') continue;
      const id = String(change?.data?.id || '').trim();
      if (!id || seen.has(id)) continue;
      const row = sqlite.prepare("SELECT id,storage_state FROM questions WHERE id=? AND deleted=0").get(id);
      if (!row || row.storage_state !== 'host_committed') continue;
      if (!binding?.root_path) throw batchError('QUESTION_BANK_BINDING_REQUIRED');
      const relativePath = path.posix.join('questions', path.basename(id), 'question.json');
      const filePath = ensureInside(binding.root_path, path.join(binding.root_path, ...relativePath.split('/')));
      if (!fs.existsSync(filePath)) throw batchError('QUESTION_FILES_MISSING');
      questions.push(Object.freeze({ id, relativePath, sha256: digest(fs.readFileSync(filePath).toString('base64')) }));
      seen.add(id);
    }
    let manifest = null;
    if (questions.length > 0) {
      const relativePath = 'manifest.json';
      const filePath = ensureInside(binding.root_path, path.join(binding.root_path, relativePath));
      if (!fs.existsSync(filePath)) throw batchError('QUESTION_BANK_MANIFEST_MISSING');
      manifest = Object.freeze({ relativePath, sha256: digest(fs.readFileSync(filePath).toString('base64')) });
    }
    return Object.freeze({ storeId: binding?.store_id || null, questions: Object.freeze(questions), manifest });
  }

  function countChanges(changes) {
    const counts = { create: 0, update: 0, delete: 0, conflict: 0, rejected: 0 };
    const tables = {};
    for (const change of changes) {
      const action = ['create', 'update', 'delete'].includes(change?.action) ? change.action : 'update';
      counts[action] += 1;
      const table = String(change?.table || 'unknown');
      tables[table] = (tables[table] || 0) + 1;
    }
    return { counts: Object.freeze(counts), tables: Object.freeze(tables) };
  }

  function preflightBatch(input = {}) {
    const batchId = safeText(input.batchId, 'SYNC_BATCH_ID_REQUIRED');
    const requestId = input.requestId ? safeText(input.requestId, 'SYNC_BATCH_REQUEST_ID_INVALID') : null;
    if (!Array.isArray(input.changes) || input.changes.length === 0) throw batchError('SYNC_BATCH_CHANGES_REQUIRED');
    const actor = validateActor({ authz: input.authz, changes: input.changes, batchId, requestId });
    if (!actor?.userId || !actor?.deviceId || !actor.activeRole) {
      throw batchError('SYNC_BATCH_ACTOR_INVALID');
    }
    const summarized = countChanges(input.changes);
    return Object.freeze({
      batchId,
      requestId,
      changes: Object.freeze(input.changes.slice()),
      authz: Object.freeze({ ...actor }),
      changeDigest: digest(input.changes),
      counts: summarized.counts,
      tables: summarized.tables,
      manifest: buildManifest(input.changes),
    });
  }

  function findBatch(batchId) {
    return sqlite.prepare('SELECT * FROM desktop_sync_batch_backups WHERE batch_id=?').get(batchId) || null;
  }

  async function createBatchBackup(preflight) {
    const prior = findBatch(preflight.batchId);
    if (prior) {
      if (prior.change_digest !== preflight.changeDigest) throw batchError('SYNC_BATCH_ID_REUSE_MISMATCH');
      return presentRecord(prior);
    }
    const backupId = safeText(uuid(), 'SYNC_BATCH_BACKUP_ID_INVALID');
    const directory = ensureInside(configuredBackupRoot, path.join(configuredBackupRoot, backupId));
    const sqliteBackupPath = ensureInside(directory, path.join(directory, 'database.sqlite'));
    fs.mkdirSync(directory, { recursive: true });
    try {
      await performBackup(sqliteBackupPath);
      if (!fs.existsSync(sqliteBackupPath)) throw batchError('SQLITE_BACKUP_FAILED');
      try { fsyncFile(sqliteBackupPath); } catch (error) {
        if (error?.code !== 'EPERM') throw error;
      }
      const binding = activeQuestionBinding();
      if (preflight.manifest.questions.length > 0 && !binding?.root_path) {
        throw batchError('QUESTION_BANK_BINDING_REQUIRED');
      }
      for (const question of preflight.manifest.questions) {
        const sourceDir = ensureInside(binding.root_path, path.dirname(path.join(binding.root_path, ...question.relativePath.split('/'))));
        const destinationDir = ensureInside(directory, path.join(directory, 'questions', path.basename(question.id)));
        copyDirectory(sourceDir, destinationDir);
      }
      if (preflight.manifest.manifest) {
        copyFileDurable(
          ensureInside(binding.root_path, path.join(binding.root_path, preflight.manifest.manifest.relativePath)),
          ensureInside(directory, path.join(directory, 'question-manifest.json'))
        );
      }
      const at = timestamp();
      sqlite.prepare(`INSERT INTO desktop_sync_batch_backups
        (id,batch_id,request_id,source_device_id,actor_user_id,change_digest,counts_json,
         sqlite_backup_path,question_manifest_json,result_json,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,NULL,'prepared',?,?)`).run(
        backupId, preflight.batchId, preflight.requestId, preflight.authz.deviceId,
        preflight.authz.userId, preflight.changeDigest, JSON.stringify(preflight.counts),
        sqliteBackupPath, JSON.stringify(preflight.manifest), at, at
      );
      return presentRecord(findBatch(preflight.batchId));
    } catch (error) {
      try {
        if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
      } catch (_cleanupError) {}
      throw error?.code ? error : batchError('SYNC_BATCH_BACKUP_FAILED', error);
    }
  }

  function restoreQuestionFiles(record) {
    if (!record?.manifest?.questions?.length) return;
    const binding = activeQuestionBinding();
    if (!binding?.root_path) throw batchError('QUESTION_BANK_BINDING_REQUIRED');
    const directory = path.dirname(record.sqliteBackupPath);
    for (const question of record.manifest.questions) {
      const source = ensureInside(directory, path.join(directory, 'questions', path.basename(question.id)));
      const target = ensureInside(binding.root_path, path.dirname(path.join(binding.root_path, ...question.relativePath.split('/'))));
      const temporary = ensureInside(binding.root_path, `${target}.restore-${crypto.randomBytes(6).toString('hex')}`);
      copyDirectory(source, temporary);
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(temporary, target);
    }
    if (record.manifest.manifest) {
      copyFileDurable(
        ensureInside(directory, path.join(directory, 'question-manifest.json')),
        ensureInside(binding.root_path, path.join(binding.root_path, record.manifest.manifest.relativePath))
      );
    }
  }

  function markBatchFailed(batchId, error, recoveryRequired = false) {
    const at = timestamp();
    sqlite.prepare(`UPDATE desktop_sync_batch_backups SET status=?,error_code=?,updated_at=?,completed_at=?
      WHERE batch_id=?`).run(
      recoveryRequired ? 'recovery_required' : 'failed',
      String(error?.code || error?.message || 'SYNC_BATCH_APPLY_FAILED').slice(0, 160),
      at, at, batchId
    );
    return presentRecord(findBatch(batchId));
  }

  function markBatchApplied(preflight, backup, result) {
    const at = timestamp();
    const epoch = sqlite.prepare("SELECT id,generation FROM primary_host_epochs WHERE status='active' ORDER BY generation DESC LIMIT 1").get() || null;
    const resultCounts = {
      ...preflight.counts,
      conflict: Number(result.conflicts || 0),
      rejected: Array.isArray(result.errors) ? result.errors.length : 0,
    };
    const storedResult = {
      ...result,
      backupId: backup.id,
      counts: resultCounts,
    };
    sqlite.prepare(`UPDATE desktop_sync_batch_backups SET status='applied',counts_json=?,result_json=?,
      error_code=NULL,updated_at=?,completed_at=? WHERE batch_id=?`).run(
      JSON.stringify(resultCounts), JSON.stringify(storedResult), at, at, preflight.batchId
    );
    const audit = {
      batchId: preflight.batchId,
      requestId: preflight.requestId,
      sourceDeviceId: preflight.authz.deviceId,
      actorUserId: preflight.authz.userId,
      counts: resultCounts,
      tables: preflight.tables,
      backupId: backup.id,
      epochId: epoch?.id || null,
      generation: epoch ? Number(epoch.generation) : null,
      resultCode: resultCounts.rejected > 0 ? 'APPLIED_WITH_REJECTIONS'
        : resultCounts.conflict > 0 ? 'APPLIED_WITH_CONFLICTS' : 'APPLIED',
    };
    sqlite.prepare(`INSERT INTO authorization_audit_log
      (id,actor_user_id,target_user_id,action,before_json,after_json,created_at)
      VALUES (?,?,?,'desktop_sync_batch_applied',NULL,?,?)`).run(
      uuid(), preflight.authz.userId, preflight.authz.userId, JSON.stringify(audit), at
    );
    return presentRecord(findBatch(preflight.batchId));
  }

  async function applyAuthorizedSyncBatch(input = {}) {
    const preflight = preflightBatch(input);
    const prior = findBatch(preflight.batchId);
    if (prior?.change_digest !== undefined && prior.change_digest !== preflight.changeDigest) {
      throw batchError('SYNC_BATCH_ID_REUSE_MISMATCH');
    }
    if (prior?.status === 'applied') {
      return Object.freeze({ ...parseJson(prior.result_json, {}), idempotent: true });
    }
    if (prior && prior.status !== 'prepared') throw batchError('SYNC_BATCH_RETRY_REQUIRES_NEW_ID');
    const backup = await createBatchBackup(preflight);
    let result;
    try {
      const applied = sqlite.transaction(() => {
        result = wrapper.applySyncChanges(preflight.changes, {
          ...(input.applyOptions || {}),
          deviceId: preflight.authz.deviceId,
          authz: preflight.authz,
          failBatchOnStorageError: true,
        });
        markBatchApplied(preflight, backup, result);
        return result;
      });
      applied();
    } catch (error) {
      let recoveryRequired = false;
      try { restoreQuestionFiles(backup); } catch (_restoreError) { recoveryRequired = true; }
      markBatchFailed(preflight.batchId, error, recoveryRequired);
      throw error?.code ? error : batchError('SYNC_BATCH_APPLY_FAILED', error);
    }
    const appliedRecord = presentRecord(findBatch(preflight.batchId));
    return Object.freeze({ ...appliedRecord.result, idempotent: false });
  }

  function readBatchRecoveryRecord(batchId) {
    return presentRecord(findBatch(safeText(batchId, 'SYNC_BATCH_ID_REQUIRED')));
  }

  return Object.freeze({
    applyAuthorizedSyncBatch,
    createBatchBackup,
    markBatchApplied,
    markBatchFailed,
    preflightBatch,
    readBatchRecoveryRecord,
  });
}

module.exports = { createSyncBatchBackupService };
