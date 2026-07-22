const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const { runScopedSyncReadPreview } = require('./primaryHostSyncPreflightService');

const OPERATIONS = new Set(['bootstrap', 'transfer', 'recovery']);
const DEFAULT_BACKUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_BACKUP_ARTIFACTS = 5;
const VALIDATION_BACKUP_NAME = /^primary-host-(bootstrap|transfer|recovery)-g\d+-[A-Za-z0-9_-]{1,80}\.sqlite$/;

function validationError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function positiveInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw validationError('PRIMARY_HOST_LOCAL_GENERATION_INVALID');
  return number;
}

function hashFile(filePath, fsImpl = fs) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsImpl.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function pruneValidationBackups({ root, nowMs, retentionMs, maxArtifacts, preservePath, fsImpl = fs }) {
  const preserved = preservePath ? path.resolve(preservePath) : '';
  try {
    const candidates = fsImpl.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isFile() && VALIDATION_BACKUP_NAME.test(entry.name))
      .map(entry => {
        const filePath = path.resolve(root, entry.name);
        if (path.dirname(filePath) !== root) throw validationError('PRIMARY_HOST_LOCAL_BACKUP_PATH_INVALID');
        return { filePath, stats: fsImpl.statSync(filePath) };
      });
    const retained = [];
    for (const candidate of candidates) {
      if (candidate.filePath !== preserved && nowMs - candidate.stats.mtimeMs > retentionMs) {
        fsImpl.unlinkSync(candidate.filePath);
      } else {
        retained.push(candidate);
      }
    }
    retained.sort((left, right) => {
      if (left.filePath === preserved) return -1;
      if (right.filePath === preserved) return 1;
      return right.stats.mtimeMs - left.stats.mtimeMs
        || path.basename(right.filePath).localeCompare(path.basename(left.filePath));
    });
    for (const candidate of retained.slice(maxArtifacts)) {
      fsImpl.unlinkSync(candidate.filePath);
    }
  } catch (error) {
    if (error?.code?.startsWith('PRIMARY_HOST_')) throw error;
    throw validationError('PRIMARY_HOST_LOCAL_BACKUP_RETENTION_FAILED', error);
  }
}

function inspectAuthoritativeBackup(
  filePath,
  evidence,
  DatabaseImpl = Database,
  actorContext,
  now,
  { runPreflight = true } = {}
) {
  let backupDb;
  try {
    backupDb = new DatabaseImpl(filePath, { readonly: true, fileMustExist: true });
    const quickCheck = String(backupDb.pragma('quick_check', { simple: true }) || '');
    if (quickCheck !== 'ok') throw validationError('PRIMARY_HOST_LOCAL_BACKUP_QUICK_CHECK_FAILED');
    const schemaVersion = Number(backupDb.pragma('user_version', { simple: true }) || 0);
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1
      || schemaVersion !== Number(evidence.schemaVersion)) {
      throw validationError('PRIMARY_HOST_LOCAL_BACKUP_SCHEMA_MISMATCH');
    }
    const tableNames = new Set(backupDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('authority_metadata','question_bank_store_bindings')"
    ).all().map(row => row.name));
    if (!tableNames.has('authority_metadata') || !tableNames.has('question_bank_store_bindings')) {
      throw validationError('PRIMARY_HOST_LOCAL_BACKUP_AUTHORITY_INVALID');
    }
    const authority = backupDb.prepare(
      "SELECT value FROM authority_metadata WHERE key='database_authority_id'"
    ).get();
    const binding = backupDb.prepare(`SELECT store_id,db_authority_id FROM question_bank_store_bindings
      WHERE status='active' ORDER BY rowid DESC LIMIT 1`).get();
    const dbAuthorityId = String(authority?.value || '').trim();
    const storeId = String(binding?.store_id || '').trim();
    if (!dbAuthorityId || !storeId
      || dbAuthorityId !== String(evidence.dbAuthorityId || '')
      || String(binding?.db_authority_id || '') !== dbAuthorityId
      || storeId !== String(evidence.storeId || '')) {
      throw validationError('PRIMARY_HOST_LOCAL_BACKUP_AUTHORITY_INVALID');
    }
    const localPreflight = runPreflight
      ? runScopedSyncReadPreview({ db: backupDb, actorContext, now })
      : null;
    return Object.freeze({ quickCheck, schemaVersion, storeId, dbAuthorityId, localPreflight });
  } catch (error) {
    if (error?.code?.startsWith('PRIMARY_HOST_')) throw error;
    throw validationError('PRIMARY_HOST_LOCAL_BACKUP_INVALID', error);
  } finally {
    try { backupDb?.close(); } catch (_error) { /* validation already failed closed */ }
  }
}

function createPrimaryHostLocalValidationService({
  db,
  collectEvidence,
  backupRoot,
  backupDatabase,
  now = () => new Date(),
  id = uuidv4,
  fsImpl = fs,
  backupRetentionMs = process.env.GEWU_PRIMARY_HOST_BACKUP_RETENTION_MS,
  maxBackupArtifacts = process.env.GEWU_PRIMARY_HOST_MAX_BACKUPS,
} = {}) {
  if (typeof collectEvidence !== 'function') throw validationError('PRIMARY_HOST_LOCAL_EVIDENCE_PROVIDER_REQUIRED');
  const root = path.resolve(backupRoot || path.join(
    process.env.GEWU_LOCAL_CACHE_PATH || process.env.GEWU_DATA_DIR || process.cwd(),
    'primary-host-validation'
  ));
  const writeBackup = backupDatabase || (async destination => {
    if (!db || typeof db.backup !== 'function') throw validationError('PRIMARY_HOST_LOCAL_BACKUP_UNAVAILABLE');
    await db.backup(destination);
  });
  const retentionMs = Math.max(60 * 1000, Number(backupRetentionMs) || DEFAULT_BACKUP_RETENTION_MS);
  const artifactLimit = Math.max(1, Math.min(50,
    Number.isSafeInteger(Number(maxBackupArtifacts))
      ? Number(maxBackupArtifacts)
      : DEFAULT_MAX_BACKUP_ARTIFACTS
  ));

  async function prepare(input = {}) {
    const operation = String(input.operation || '').trim();
    if (!OPERATIONS.has(operation)) throw validationError('PRIMARY_HOST_OPERATION_INVALID');
    const evidence = Object.freeze({ ...collectEvidence({
      deviceId: input.deviceId,
      purpose: operation,
    }) });
    const isBootstrap = operation === 'bootstrap';
    const sourceGeneration = isBootstrap ? 1 : positiveInteger(input.sourceGeneration);
    const targetGeneration = isBootstrap ? 1 : positiveInteger(input.targetGeneration);
    if (!isBootstrap && targetGeneration !== sourceGeneration + 1) {
      throw validationError('PRIMARY_HOST_LOCAL_GENERATION_INVALID');
    }
    const current = now();
    const currentDate = current instanceof Date ? new Date(current) : new Date(current);
    if (!Number.isFinite(currentDate.getTime())) throw validationError('PRIMARY_HOST_LOCAL_VALIDATION_CLOCK_INVALID');
    fsImpl.mkdirSync(root, { recursive: true });
    pruneValidationBackups({
      root,
      nowMs: currentDate.getTime(),
      retentionMs,
      maxArtifacts: artifactLimit,
      fsImpl,
    });
    const safeId = String(id()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    if (!safeId) throw validationError('PRIMARY_HOST_LOCAL_VALIDATION_ID_INVALID');
    const artifactName = `primary-host-${operation}-g${sourceGeneration}-${safeId}.sqlite`;
    const artifactPath = path.resolve(root, artifactName);
    if (path.dirname(artifactPath) !== root) throw validationError('PRIMARY_HOST_LOCAL_BACKUP_PATH_INVALID');
    try {
      await writeBackup(artifactPath);
      if (!fsImpl.existsSync(artifactPath)) throw validationError('PRIMARY_HOST_LOCAL_BACKUP_FAILED');
      const stats = fsImpl.statSync(artifactPath);
      if (!stats.isFile() || stats.size < 1) throw validationError('PRIMARY_HOST_LOCAL_BACKUP_FAILED');
      const inspected = inspectAuthoritativeBackup(
        artifactPath,
        evidence,
        Database,
        input.actorContext,
        currentDate,
        { runPreflight: !isBootstrap }
      );
      const { localPreflight, ...inspectedBackup } = inspected;
      const sha256 = await hashFile(artifactPath, fsImpl);
      pruneValidationBackups({
        root,
        nowMs: currentDate.getTime(),
        retentionMs,
        maxArtifacts: artifactLimit,
        preservePath: artifactPath,
        fsImpl,
      });
      return Object.freeze({
        evidence,
        localValidation: Object.freeze({
          backup: Object.freeze({
            authoritative: true,
            sha256,
            sourceGeneration,
            targetGeneration,
            createdAt: currentDate.toISOString(),
            sizeBytes: stats.size,
            artifactName,
            ...inspectedBackup,
          }),
          localPreflight,
        }),
      });
    } catch (error) {
      try {
        if (path.dirname(artifactPath) === root && fsImpl.existsSync(artifactPath)) {
          fsImpl.unlinkSync(artifactPath);
        }
      } catch (_cleanupError) { /* retain the original validation failure */ }
      if (error?.code?.startsWith('PRIMARY_HOST_')) throw error;
      throw validationError('PRIMARY_HOST_LOCAL_BACKUP_FAILED', error);
    }
  }

  return Object.freeze({ prepare });
}

module.exports = {
  createPrimaryHostLocalValidationService,
  hashFile,
  inspectAuthoritativeBackup,
  pruneValidationBackups,
};
