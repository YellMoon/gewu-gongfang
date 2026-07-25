const crypto = require('crypto');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  return value;
}

function canonicalJson(value) { return JSON.stringify(stableValue(value)); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function paperJobKey(relayScope, cloudTaskId) {
  const scope = String(relayScope || '').trim(); const task = String(cloudTaskId || '').trim();
  if (!scope || !task) throw paperJobError('PAPER_JOB_SCOPE_REQUIRED', 'relayScope and cloudTaskId are required', 400);
  return `paper_${sha256(`${scope}\0${task}`)}`;
}
function paperJobError(code, message, statusCode = 409) { return Object.assign(new Error(message), { code, statusCode }); }

function ensurePaperJobSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS paper_jobs (
    job_key TEXT PRIMARY KEY, relay_scope TEXT NOT NULL, cloud_task_id TEXT NOT NULL, task_id TEXT NOT NULL, tenant_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    request_hash TEXT NOT NULL, question_snapshot_json TEXT, snapshot_hash TEXT, selection_version TEXT,
    resource_version TEXT, status TEXT NOT NULL DEFAULT 'queued', phase TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
    next_attempt_at TEXT, cancel_requested_at TEXT, deadline_at TEXT, temp_dir TEXT, artifact_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, claimed_at TEXT, completed_at TEXT
  );
  DROP INDEX IF EXISTS idx_paper_jobs_task;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_jobs_relay_task ON paper_jobs(relay_scope,cloud_task_id);
  CREATE INDEX IF NOT EXISTS idx_paper_jobs_runnable ON paper_jobs(status,next_attempt_at,updated_at);
  CREATE TABLE IF NOT EXISTS paper_artifacts (
    artifact_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, job_key TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL, snapshot_hash TEXT NOT NULL, format TEXT NOT NULL, mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, page_count INTEGER, formula_count INTEGER NOT NULL DEFAULT 0,
    fallback_count INTEGER NOT NULL DEFAULT 0, effective_modes_json TEXT NOT NULL, file_path TEXT NOT NULL,
    created_at TEXT NOT NULL, expires_at TEXT, storage_status TEXT NOT NULL DEFAULT 'verified'
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_artifacts_job_snapshot_format_verified
    ON paper_artifacts(job_key,snapshot_hash,format) WHERE storage_status='verified';
  CREATE INDEX IF NOT EXISTS idx_paper_artifacts_expiry ON paper_artifacts(storage_status,expires_at);`);
}

function paperJobRow(row) {
  if (!row) return null;
  return { ...row, question_snapshot: row.question_snapshot_json ? JSON.parse(row.question_snapshot_json) : null };
}

function artifactRow(row) {
  if (!row) return null;
  return { ...row, effective_modes: JSON.parse(row.effective_modes_json || '[]') };
}

function createOrGetPaperJob(db, input, options = {}) {
  ensurePaperJobSchema(db);
  const computedKey = paperJobKey(input.relayScope, input.cloudTaskId);
  if (input.jobKey && input.jobKey !== computedKey) throw paperJobError('PAPER_JOB_KEY_INVALID', 'jobKey does not match relay scope and cloud task', 400);
  const existing = db.prepare('SELECT * FROM paper_jobs WHERE job_key=? OR (relay_scope=? AND cloud_task_id=?)').get(computedKey, input.relayScope, input.cloudTaskId);
  if (existing) {
    if (existing.request_hash !== input.requestHash || existing.task_id !== input.taskId) throw paperJobError('PAPER_JOB_KEY_CONFLICT', 'jobKey already belongs to another request');
    return { job: paperJobRow(existing), created: false };
  }
  const now = options.now || new Date().toISOString();
  db.prepare(`INSERT INTO paper_jobs
    (job_key,relay_scope,cloud_task_id,task_id,tenant_id,owner_user_id,request_hash,selection_version,resource_version,status,phase,progress,
     attempt,max_attempts,deadline_at,temp_dir,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,'queued','queued',0,0,?,?,?,?,?)`)
    .run(computedKey, input.relayScope, input.cloudTaskId, input.taskId, input.tenantId || 'default', input.ownerUserId || '', input.requestHash,
      input.selectionVersion || null, input.resourceVersion || null, Math.max(1, Number(input.maxAttempts || 3)),
      input.deadlineAt || null, input.tempDir || null, now, now);
  return { job: paperJobRow(db.prepare('SELECT * FROM paper_jobs WHERE job_key=?').get(computedKey)), created: true };
}

function claimPaperJobWithSnapshot(db, jobKey, selectQuestions, options = {}) {
  const now = options.now || new Date().toISOString();
  const execute = db.transaction(() => {
    const current = db.prepare('SELECT * FROM paper_jobs WHERE job_key=?').get(jobKey);
    if (!current) throw paperJobError('PAPER_JOB_NOT_FOUND', 'paper job not found', 404);
    if (current.cancel_requested_at) throw paperJobError('PAPER_JOB_CANCELLED', 'paper job was cancelled', 409);
    if (current.deadline_at && current.deadline_at <= now) throw paperJobError('PAPER_JOB_DEADLINE_EXCEEDED', 'paper job deadline exceeded', 408);
    if (current.next_attempt_at && current.next_attempt_at > now) throw paperJobError('PAPER_JOB_BACKOFF_ACTIVE', 'paper job retry backoff is active', 409);
    if (current.status === 'processing') throw paperJobError('PAPER_JOB_ALREADY_PROCESSING', 'paper job is already processing', 409);
    if (['completed', 'failed', 'cancelled'].includes(current.status)) throw paperJobError('PAPER_JOB_TERMINAL', 'paper job is terminal', 409);
    if (current.attempt >= current.max_attempts) throw paperJobError('PAPER_JOB_RETRY_EXHAUSTED', 'paper job retry limit reached');
    let snapshotJson = current.question_snapshot_json;
    let snapshotHash = current.snapshot_hash;
    if (!snapshotJson) {
      const rows = selectQuestions();
      snapshotJson = canonicalJson(rows);
      snapshotHash = sha256(snapshotJson);
    }
    db.prepare(`UPDATE paper_jobs SET question_snapshot_json=?,snapshot_hash=?,status='processing',phase='claimed',
      progress=1,attempt=attempt+1,next_attempt_at=NULL,claimed_at=?,updated_at=? WHERE job_key=?`)
      .run(snapshotJson, snapshotHash, now, now, jobKey);
    return paperJobRow(db.prepare('SELECT * FROM paper_jobs WHERE job_key=?').get(jobKey));
  });
  const job = execute.immediate();
  return { job, questions: job.question_snapshot };
}

function findVerifiedArtifact(db, jobKey, snapshotHash, format, options = {}) {
  const now = options.now || new Date().toISOString();
  return artifactRow(db.prepare(`SELECT * FROM paper_artifacts WHERE job_key=? AND snapshot_hash=? AND format=?
    AND storage_status='verified' AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at LIMIT 1`).get(jobKey, snapshotHash, format, now));
}

function stagePaperArtifact(db, input, options = {}) {
  const now = options.now || new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO paper_artifacts
    (artifact_id,task_id,job_key,owner_user_id,tenant_id,snapshot_hash,format,mime_type,size_bytes,sha256,
     page_count,formula_count,fallback_count,effective_modes_json,file_path,created_at,expires_at,storage_status)
    VALUES(?,?,?,?,?,?,?,?,0,'',NULL,0,0,'[]',?,?,?,'staged')`)
    .run(input.artifactId, input.taskId, input.jobKey, input.ownerUserId, input.tenantId || 'default', input.snapshotHash,
      input.format, input.mimeType, input.filePath, now, input.expiresAt || null);
  return artifactRow(db.prepare('SELECT * FROM paper_artifacts WHERE artifact_id=?').get(input.artifactId));
}

function recordVerifiedArtifact(db, input, options = {}) {
  const now = options.now || new Date().toISOString();
  const persist = db.transaction(() => {
    const existing = findVerifiedArtifact(db, input.jobKey, input.snapshotHash, input.format, options);
    if (existing) return existing;
    const staged = db.prepare("SELECT * FROM paper_artifacts WHERE artifact_id=? AND storage_status='staged'").get(input.artifactId);
    if (staged) {
      db.prepare(`UPDATE paper_artifacts SET size_bytes=?,sha256=?,page_count=?,formula_count=?,fallback_count=?,
        effective_modes_json=?,file_path=?,expires_at=?,storage_status='verified' WHERE artifact_id=? AND storage_status='staged'`)
        .run(input.sizeBytes, input.sha256, input.pageCount ?? null, Number(input.formulaCount || 0), Number(input.fallbackCount || 0),
          JSON.stringify(input.effectiveModes || []), input.filePath, input.expiresAt || null, input.artifactId);
    } else {
      db.prepare(`INSERT INTO paper_artifacts
        (artifact_id,task_id,job_key,owner_user_id,tenant_id,snapshot_hash,format,mime_type,size_bytes,sha256,
         page_count,formula_count,fallback_count,effective_modes_json,file_path,created_at,expires_at,storage_status)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'verified')`)
        .run(input.artifactId, input.taskId, input.jobKey, input.ownerUserId, input.tenantId || 'default', input.snapshotHash,
          input.format, input.mimeType, input.sizeBytes, input.sha256, input.pageCount ?? null, Number(input.formulaCount || 0),
          Number(input.fallbackCount || 0), JSON.stringify(input.effectiveModes || []), input.filePath, now, input.expiresAt || null);
    }
    db.prepare("UPDATE paper_jobs SET artifact_id=?,status='completed',phase='completed',progress=100,completed_at=?,updated_at=? WHERE job_key=?")
      .run(input.artifactId, now, now, input.jobKey);
    return artifactRow(db.prepare('SELECT * FROM paper_artifacts WHERE artifact_id=?').get(input.artifactId));
  });
  try {
    return persist.immediate();
  } catch (error) {
    if (!/UNIQUE constraint failed/.test(error.message || '')) throw error;
    const raced = findVerifiedArtifact(db, input.jobKey, input.snapshotHash, input.format, options);
    if (raced) return raced;
    throw error;
  }
}

function markPaperJobRetry(db, jobKey, error, options = {}) {
  const now = options.now || new Date().toISOString();
  const row = db.prepare('SELECT * FROM paper_jobs WHERE job_key=?').get(jobKey);
  if (!row) throw paperJobError('PAPER_JOB_NOT_FOUND', 'paper job not found', 404);
  const exhausted = Number(row.attempt) >= Number(row.max_attempts);
  const baseDelay = Math.max(1, Number(options.baseDelayMs || 1000));
  const maxDelay = Math.max(baseDelay, Number(options.maxDelayMs || 300000));
  const cappedDelay = Math.min(maxDelay, baseDelay * (2 ** Math.max(0, Number(row.attempt) - 1)));
  const jitterRatio = Math.min(1, Math.max(0, Number(options.jitterRatio ?? 0.2)));
  const random = options.random || Math.random;
  const delay = Math.min(maxDelay, Math.max(1, Math.round(cappedDelay * (1 + ((random() * 2) - 1) * jitterRatio))));
  const next = exhausted ? null : new Date(new Date(now).getTime() + delay).toISOString();
  db.prepare('UPDATE paper_jobs SET status=?,phase=?,next_attempt_at=?,updated_at=? WHERE job_key=?')
    .run(exhausted ? 'failed' : 'retry_wait', exhausted ? 'failed' : 'retry_wait', next, now, jobKey);
  return paperJobRow(db.prepare('SELECT * FROM paper_jobs WHERE job_key=?').get(jobKey));
}

function requestPaperJobCancel(db, jobKey, options = {}) {
  const now = options.now || new Date().toISOString();
  const info = db.prepare('UPDATE paper_jobs SET cancel_requested_at=?,updated_at=? WHERE job_key=?').run(now, now, jobKey);
  if (!info.changes) throw paperJobError('PAPER_JOB_NOT_FOUND', 'paper job not found', 404);
  return paperJobRow(db.prepare('SELECT * FROM paper_jobs WHERE job_key=?').get(jobKey));
}

function recoverStalePaperJobs(db, options = {}) {
  const now = options.now || new Date().toISOString();
  const staleBefore = options.staleBefore || now;
  const rows = db.prepare("SELECT job_key FROM paper_jobs WHERE status='processing' AND updated_at<=?").all(staleBefore);
  db.prepare("UPDATE paper_jobs SET status='retry_wait',phase='recovered',next_attempt_at=?,updated_at=? WHERE status='processing' AND updated_at<=?")
    .run(now, now, staleBefore);
  return rows.map(row => row.job_key);
}

module.exports = {
  canonicalJson, claimPaperJobWithSnapshot, createOrGetPaperJob, ensurePaperJobSchema, findVerifiedArtifact,
  markPaperJobRetry, paperJobError, paperJobKey, recordVerifiedArtifact, recoverStalePaperJobs, requestPaperJobCancel, sha256, stagePaperArtifact,
};
