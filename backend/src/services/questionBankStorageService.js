const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { canDeleteQuestion, committedDeleteError } = require('./questionDeletionPolicy');

function now() {
  return new Date().toISOString();
}

function storeId() {
  return `qb_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function manifestPath(root) {
  return path.join(root, 'manifest.json');
}

function requiredDirs(root) {
  return [
    path.join(root, 'assets'),
    path.join(root, 'assets', 'images'),
    path.join(root, 'assets', 'word-imports'),
    path.join(root, 'assets', 'exports'),
    path.join(root, 'backups'),
    path.join(root, 'questions'),
    path.join(root, '.trash'),
  ];
}

function ensureQuestionBankAuthoritySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authority_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS question_bank_store_bindings (
      store_id TEXT PRIMARY KEY, db_authority_id TEXT NOT NULL, root_path TEXT NOT NULL,
      bound_by TEXT NOT NULL, bound_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS question_bank_storage_audit (
      id TEXT PRIMARY KEY, operation_id TEXT, actor_user_id TEXT, action TEXT NOT NULL,
      store_id TEXT, question_id TEXT, details_json TEXT, created_at TEXT NOT NULL
    );
  `);
}

function authorityError(message, code) {
  const error = new Error(message); error.code = code; return error;
}

function assertTrustedHost(authz = {}, runtime = {}, options = {}) {
  if ((runtime.nodeRole || runtime.runtimeNodeRole) !== 'primary-host') throw authorityError('primary host required', 'PRIMARY_HOST_REQUIRED');
  if (runtime.clientType !== 'desktop' || runtime.tokenUse !== 'desktop-session') throw authorityError('verified desktop session required', 'DESKTOP_SESSION_REQUIRED');
  if (!runtime.deviceId || runtime.deviceId !== runtime.tokenDeviceId || authz.deviceTrusted !== true || authz.deviceActive !== true) throw authorityError('trusted active device required', 'TRUSTED_DEVICE_REQUIRED');
  if (authz.userApproved !== true || !authz.userId || authz.deviceOwnerUserId !== authz.userId) throw authorityError('approved device owner required', 'APPROVED_OWNER_REQUIRED');
  if (options.superAdminOnly && authz.role !== 'super_admin') throw authorityError('super administrator required', 'SUPER_ADMIN_REQUIRED');
}

function getOrCreateDatabaseAuthorityId(db) {
  ensureQuestionBankAuthoritySchema(db);
  const existing = db.prepare("SELECT value FROM authority_metadata WHERE key='database_authority_id'").get();
  if (existing?.value) return existing.value;
  const value = `dba_${crypto.randomUUID()}`;
  db.prepare("INSERT INTO authority_metadata (key,value,updated_at) VALUES ('database_authority_id',?,?)").run(value, now());
  return value;
}

function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(temp, file);
}

function bindQuestionBankStoreToDatabase({ db, root, authz = {}, runtime = {} }) {
  assertTrustedHost(authz, runtime, { superAdminOnly: true });
  const inspected = assertQuestionBankWritable(root, runtime);
  const dbAuthorityId = getOrCreateDatabaseAuthorityId(db);
  const file = manifestPath(root);
  const original = fs.readFileSync(file);
  const backup = path.join(root, 'backups', `manifest-before-bind-${Date.now()}.json`);
  fs.writeFileSync(backup, original);
  const manifest = { ...inspected.manifest, authorityDatabaseId: dbAuthorityId, authorityBoundAt: now() };
  const transaction = db.transaction(() => {
    db.prepare("UPDATE question_bank_store_bindings SET status='inactive' WHERE status='active' AND store_id<>?").run(manifest.storeId);
    db.prepare(`INSERT INTO question_bank_store_bindings (store_id,db_authority_id,root_path,bound_by,bound_at,status)
      VALUES (?,?,?,?,?,'active') ON CONFLICT(store_id) DO UPDATE SET db_authority_id=excluded.db_authority_id,root_path=excluded.root_path,bound_by=excluded.bound_by,bound_at=excluded.bound_at,status='active'`)
      .run(manifest.storeId, dbAuthorityId, path.resolve(root), authz.userId, manifest.authorityBoundAt);
    db.prepare(`INSERT INTO question_bank_storage_audit (id,operation_id,actor_user_id,action,store_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(crypto.randomUUID(), null, authz.userId, 'bind_store', manifest.storeId, JSON.stringify({ root: path.resolve(root) }), now());
    writeJsonAtomic(file, manifest);
  });
  try { transaction(); } catch (error) { fs.writeFileSync(file, original); throw error; }
  return { storeId: manifest.storeId, dbAuthorityId, root: path.resolve(root), backup };
}

function activeBinding(db) {
  ensureQuestionBankAuthoritySchema(db);
  return db.prepare("SELECT * FROM question_bank_store_bindings WHERE status='active' ORDER BY bound_at DESC LIMIT 1").get();
}

function verifyBinding(db, binding) {
  if (!binding) throw authorityError('no bound question bank store', 'QUESTION_BANK_STORE_NOT_BOUND');
  const inspected = inspectQuestionBankStore(binding.root_path);
  if (inspected.manifest.storeId !== binding.store_id || inspected.manifest.authorityDatabaseId !== binding.db_authority_id) {
    throw authorityError('question bank store authority mismatch', 'QUESTION_BANK_AUTHORITY_MISMATCH');
  }
  return inspected;
}

function migrateBoundLegacyQuestions({ db, root, authz = {}, runtime = {}, tenantId = 'default' }) {
  assertTrustedHost(authz, runtime, { superAdminOnly: true });
  const binding = activeBinding(db); verifyBinding(db, binding);
  if (path.resolve(root) !== path.resolve(binding.root_path)) throw authorityError('question bank binding root mismatch', 'QUESTION_BANK_AUTHORITY_MISMATCH');
  const marker = `question_bank_legacy_migration:${binding.store_id}`;
  if (db.prepare('SELECT 1 FROM authority_metadata WHERE key=?').get(marker)) return { migrated: 0, alreadyApplied: true };
  const candidates = db.prepare("SELECT id FROM questions WHERE tenant_id=? AND deleted=0 AND storage_state='local_draft' AND created_at<=?").all(tenantId, binding.bound_at);
  const eligible = candidates.filter(row => fs.existsSync(path.join(binding.root_path, 'questions', path.basename(row.id), 'question.json')));
  const ts = now();
  db.transaction(() => {
    for (const row of eligible) db.prepare("UPDATE questions SET storage_state='host_committed',committed_at=?,committed_by_device_id=?,updated_at=? WHERE id=?").run(ts, runtime.deviceId, ts, row.id);
    db.prepare('INSERT INTO authority_metadata (key,value,updated_at) VALUES (?,?,?)').run(marker, JSON.stringify({ migrated: eligible.length }), ts);
  })();
  return { migrated: eligible.length, alreadyApplied: false };
}

function questionBundle(db, questionId, tenantId) {
  const question = db.prepare('SELECT * FROM questions WHERE id=? AND tenant_id=? AND deleted=0').get(questionId, tenantId);
  if (!question) throw authorityError('question not found', 'QUESTION_NOT_FOUND');
  return { question, contents: db.prepare('SELECT * FROM question_contents WHERE question_id=? AND deleted=0').all(questionId), assets: db.prepare('SELECT * FROM question_assets WHERE question_id=? AND deleted=0').all(questionId) };
}

function commitQuestionToBoundStore(questionId, context = {}) {
  const { db, authz = {}, runtime = {}, tenantId = 'default' } = context;
  const binding = activeBinding(db); verifyBinding(db, binding);
  assertTrustedHost(authz, runtime);
  const bundle = questionBundle(db, questionId, tenantId);
  const dir = path.join(binding.root_path, 'questions', path.basename(questionId));
  const created = !fs.existsSync(dir);
  const manifestFile = manifestPath(binding.root_path);
  const originalManifest = fs.readFileSync(manifestFile);
  try {
    ensureDir(dir);
    writeJsonAtomic(path.join(dir, 'question.json'), bundle);
    for (const asset of bundle.assets) {
      if (String(asset.oss_url || '').startsWith('data:')) {
        const match = asset.oss_url.match(/^data:[^;]+;base64,(.*)$/);
        if (match) fs.writeFileSync(path.join(dir, path.basename(asset.file_name || `${asset.id}.bin`)), Buffer.from(match[1], 'base64'));
      }
    }
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
    manifest.questions = { ...(manifest.questions || {}), [questionId]: { path: `questions/${path.basename(questionId)}/question.json`, committedAt: now() } };
    writeJsonAtomic(manifestFile, manifest);
    const ts = now();
    db.transaction(() => {
      db.prepare("UPDATE questions SET storage_state='host_committed',committed_at=?,committed_by_device_id=?,updated_at=? WHERE id=? AND tenant_id=? AND deleted=0")
        .run(ts, runtime.deviceId, ts, questionId, tenantId);
      db.prepare(`INSERT INTO question_bank_storage_audit (id,operation_id,actor_user_id,action,store_id,question_id,details_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(crypto.randomUUID(), context.operationId || null, authz.userId, 'commit_question', binding.store_id, questionId, '{}', ts);
    })();
    return { questionId, storageState: 'host_committed', storeId: binding.store_id };
  } catch (error) {
    fs.writeFileSync(manifestFile, originalManifest);
    if (created) fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function safeInside(root, target) {
  const base = path.resolve(root) + path.sep; const resolved = path.resolve(target);
  if (!resolved.startsWith(base)) throw authorityError('path escapes question bank root', 'QUESTION_BANK_PATH_ESCAPE');
  return resolved;
}

function deleteCommittedQuestion(questionId, context = {}) {
  const { db, authz = {}, runtime = {}, tenantId = 'default' } = context;
  if (!canDeleteQuestion({ ...authz, ...runtime, runtimeNodeRole: runtime.runtimeNodeRole || runtime.nodeRole, storageState: 'host_committed' })) throw committedDeleteError();
  assertTrustedHost(authz, runtime);
  const binding = activeBinding(db); verifyBinding(db, binding);
  const bundle = questionBundle(db, questionId, tenantId);
  if (bundle.question.storage_state !== 'host_committed') throw authorityError('question is not committed', 'QUESTION_NOT_COMMITTED');
  const operationId = String(context.operationId || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '');
  const source = safeInside(binding.root_path, path.join(binding.root_path, 'questions', path.basename(questionId)));
  const trash = safeInside(binding.root_path, path.join(binding.root_path, '.trash', operationId, path.basename(questionId)));
  if (!fs.existsSync(source)) throw authorityError('committed question files missing', 'QUESTION_FILES_MISSING');
  ensureDir(path.dirname(trash)); fs.renameSync(source, trash);
  let dbChanged = false;
  try {
    const ts = now();
    db.transaction(() => {
      db.prepare('UPDATE questions SET deleted=1,deleted_at=?,updated_at=? WHERE id=? AND tenant_id=? AND deleted=0').run(ts, ts, questionId, tenantId);
      db.prepare('UPDATE question_contents SET deleted=1,updated_at=? WHERE question_id=? AND deleted=0').run(ts, questionId);
      db.prepare('UPDATE question_assets SET deleted=1,updated_at=? WHERE question_id=? AND deleted=0').run(ts, questionId);
      db.prepare(`INSERT INTO question_bank_storage_audit (id,operation_id,actor_user_id,action,store_id,question_id,details_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(crypto.randomUUID(), operationId, authz.userId, 'delete_committed_question', binding.store_id, questionId, JSON.stringify({ trash }), ts);
    })();
    dbChanged = true;
    const manifestFile = manifestPath(binding.root_path);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
    if (manifest.questions) delete manifest.questions[questionId];
    manifest.trash = { ...(manifest.trash || {}), [operationId]: { questionId, path: path.relative(binding.root_path, trash), deletedAt: ts } };
    writeJsonAtomic(manifestFile, manifest);
    return { deleted: true, operationId, trash };
  } catch (error) {
    if (dbChanged) {
      const ts = now();
      db.transaction(() => {
        db.prepare('UPDATE questions SET deleted=0,deleted_at=NULL,updated_at=? WHERE id=? AND tenant_id=?').run(ts, questionId, tenantId);
        db.prepare('UPDATE question_contents SET deleted=0,updated_at=? WHERE question_id=?').run(ts, questionId);
        db.prepare('UPDATE question_assets SET deleted=0,updated_at=? WHERE question_id=?').run(ts, questionId);
        db.prepare("DELETE FROM question_bank_storage_audit WHERE operation_id=? AND action='delete_committed_question'").run(operationId);
      })();
    }
    ensureDir(path.dirname(source)); if (fs.existsSync(trash)) fs.renameSync(trash, source); throw error;
  }
}

function initQuestionBankStore(root, options = {}) {
  if (!root) throw new Error('question bank root is required');
  ensureDir(root);
  requiredDirs(root).forEach(ensureDir);

  const file = manifestPath(root);
  let manifest;
  if (fs.existsSync(file)) {
    manifest = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } else {
    manifest = {
      storeId: storeId(),
      schemaVersion: 1,
      createdAt: now(),
      lastMountedByDeviceId: options.deviceId || '',
      lastVerifiedAt: now(),
    };
  }

  manifest.schemaVersion = Number(manifest.schemaVersion || 1);
  manifest.lastMountedByDeviceId = options.deviceId || manifest.lastMountedByDeviceId || '';
  manifest.lastVerifiedAt = now();
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}

function inspectQuestionBankStore(root) {
  if (!root || !fs.existsSync(root)) throw new Error('question bank store is not available');
  const file = manifestPath(root);
  if (!fs.existsSync(file)) throw new Error('question bank manifest is missing');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!manifest.storeId || typeof manifest.storeId !== 'string') throw new Error('question bank manifest storeId is invalid');
  if (!Number.isInteger(Number(manifest.schemaVersion)) || Number(manifest.schemaVersion) < 1) throw new Error('question bank manifest schemaVersion is invalid');
  const missingDirs = requiredDirs(root).filter(dir => !fs.existsSync(dir));
  return { available: missingDirs.length === 0, root, manifest, missingDirs };
}

function offlineStore(root, error) {
  return {
    available: false,
    status: 'offline',
    root,
    manifest: null,
    missingDirs: [],
    reason: error?.message || 'question bank store is offline',
  };
}

function scanQuestionBankStores(candidateRoots = []) {
  return Array.from(new Set(candidateRoots.filter(Boolean))).map(root => {
    try {
      const inspected = inspectQuestionBankStore(root);
      return {
        ...inspected,
        status: inspected.available ? 'online' : 'incomplete',
        reason: inspected.available ? '' : 'question bank store is incomplete',
      };
    } catch (error) {
      return offlineStore(root, error);
    }
  });
}

function findQuestionBankStore(candidateRoots = [], options = {}) {
  const scanned = scanQuestionBankStores(candidateRoots);
  const online = scanned.filter(item => item.available);
  const matched = options.storeId
    ? online.find(item => item.manifest?.storeId === options.storeId)
    : online[0];

  if (matched) return matched;

  return {
    available: false,
    status: 'offline',
    root: '',
    manifest: null,
    missingDirs: [],
    candidates: scanned,
    reason: options.storeId
      ? `question bank store ${options.storeId} is not connected`
      : 'no question bank store is connected',
  };
}

function assertQuestionBankWritable(root, options = {}) {
  const inspected = inspectQuestionBankStore(root);
  if (!inspected.available) throw new Error('question bank store is incomplete');
  if (options.nodeRole !== 'primary-host') {
    throw new Error('Only primary-host can write to question bank removable storage');
  }
  return inspected;
}

function resolveQuestionAssetPath(root, category, fileName) {
  const safeName = path.basename(fileName);
  const folder = category === 'word-imports' || category === 'exports' ? category : 'images';
  return path.join(root, 'assets', folder, safeName);
}

module.exports = {
  initQuestionBankStore,
  inspectQuestionBankStore,
  assertQuestionBankWritable,
  scanQuestionBankStores,
  findQuestionBankStore,
  resolveQuestionAssetPath,
  ensureQuestionBankAuthoritySchema,
  bindQuestionBankStoreToDatabase,
  commitQuestionToBoundStore,
  deleteCommittedQuestion,
  migrateBoundLegacyQuestions,
};
