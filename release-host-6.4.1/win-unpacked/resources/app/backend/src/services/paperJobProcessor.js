const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveBoundQuestionBankRoot } = require('./questionBankStorageService');
const { collectQuestionAssetReferences, freezePaperSnapshot, pinSnapshotAssets, resolveSnapshotAssets } = require('./paperSnapshotService');
const { writePaperArtifactInWorker } = require('./paperArtifactWorker');
const { resolveFormulaMode } = require('./formulaExportService');
const { canonicalResultJson, resultHash } = require('./cloudRelayTaskService');
const {
  claimPaperJobWithSnapshot, createOrGetPaperJob, ensurePaperJobSchema, findVerifiedArtifact,
  markPaperJobRetry, paperJobKey, recordVerifiedArtifact, sha256, stagePaperArtifact,
} = require('./paperJobRepository');

function ensureCompletionOutbox(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS paper_completion_outbox (
    outbox_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, job_key TEXT NOT NULL, artifact_id TEXT NOT NULL,
    payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempt INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, delivered_at TEXT,
    claim_token TEXT, expected_row_version INTEGER, operation_id TEXT, result_hash TEXT,
    max_attempts INTEGER NOT NULL DEFAULT 10, last_error TEXT, terminal_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_completion_once ON paper_completion_outbox(task_id,job_key,artifact_id);`);
  const columns = new Set(db.prepare('PRAGMA table_info(paper_completion_outbox)').all().map(row => row.name));
  for (const [name, ddl] of [['claim_token','TEXT'],['expected_row_version','INTEGER'],['operation_id','TEXT'],['result_hash','TEXT'],
    ['max_attempts','INTEGER NOT NULL DEFAULT 10'],['last_error','TEXT'],['terminal_at','TEXT']]) {
    if (!columns.has(name)) db.prepare(`ALTER TABLE paper_completion_outbox ADD COLUMN ${name} ${ddl}`).run();
  }
}

function deriveServerExportContract(payload = {}, options = {}) {
  const templatePath = options.templatePath || path.join(__dirname, '..', '..', 'resources', 'paper', 'default-paper-template.docx');
  const rendererPaths = options.rendererPaths || [
    path.join(__dirname, 'paperArtifactService.js'), path.join(__dirname, 'formulaExportService.js'),
    path.join(__dirname, '..', '..', '..', 'modules', 'question-bank', 'export', 'formula_renderers.py'),
    path.join(__dirname, '..', '..', '..', 'modules', 'question-bank', 'export', 'visible_gate.py'),
  ];
  const templateVersion = sha256(fs.readFileSync(templatePath));
  const rendererVersion = sha256(rendererPaths.map(file => `${path.basename(file)}:${sha256(fs.readFileSync(file))}`).join('|'));
  return { templateVersion, formulaPolicy: { requestedMode: resolveFormulaMode(payload.formulaMode || payload.formula_mode), rendererVersion } };
}

function enqueueCompletion(db, job, artifact, now) {
  const accessEndpoint = `/api/cloud-relay-host/artifacts/${encodeURIComponent(artifact.artifact_id)}/access`;
  const payload = {
    jobKey: job.job_key, snapshotHash: job.snapshot_hash, artifactId: artifact.artifact_id,
    format: artifact.format, sha256: artifact.sha256, sizeBytes: artifact.size_bytes, expiresAt: artifact.expires_at,
    accessEndpoint,
  };
  const id = `completion_${sha256(`${job.task_id}\0${job.job_key}\0${artifact.artifact_id}`)}`;
  const payloadJson = canonicalResultJson(payload);
  db.prepare(`INSERT OR IGNORE INTO paper_completion_outbox
    (outbox_id,task_id,job_key,artifact_id,payload_json,status,attempt,created_at,updated_at,operation_id,result_hash)
    VALUES(?,?,?,?,?,'pending',0,?,?,?,?)`).run(id, job.task_id, job.job_key, artifact.artifact_id, payloadJson, now, now, id, resultHash(payload));
  return db.prepare('SELECT * FROM paper_completion_outbox WHERE outbox_id=?').get(id);
}

async function deliverOutboxRow(db, row, dependencies, now) {
  if (row.status === 'delivered') return true;
  if (!row.claim_token || row.expected_row_version === null || row.expected_row_version === undefined) return false;
  try {
    await dependencies.completeTask(row.task_id, {
      claimToken: row.claim_token, expectedRowVersion: Number(row.expected_row_version), result: JSON.parse(row.payload_json),
      operationId: row.operation_id, resultHash: row.result_hash,
    });
    db.prepare("UPDATE paper_completion_outbox SET status='delivered',attempt=attempt+1,delivered_at=?,updated_at=?,next_attempt_at=NULL WHERE outbox_id=?")
      .run(now, now, row.outbox_id);
    return true;
  } catch (completionError) {
    let remote = null;
    try { remote = await dependencies.queryTaskState?.(row.task_id); } catch (_queryError) { remote = null; }
    const task = remote?.task || remote;
    if (task?.status === 'cancelled') {
      db.transaction(() => {
        db.prepare("UPDATE paper_completion_outbox SET status='terminal_cancelled',attempt=attempt+1,updated_at=?,next_attempt_at=NULL WHERE outbox_id=?").run(now, row.outbox_id);
        db.prepare("UPDATE paper_artifacts SET storage_status='revoked' WHERE artifact_id=? AND storage_status='verified'").run(row.artifact_id);
        db.prepare("UPDATE paper_jobs SET status='cancelled',phase='cancelled',updated_at=? WHERE job_key=?").run(now, row.job_key);
      })();
      return 'cancelled';
    }
    const remoteResult = task?.result_payload ?? task?.result;
    let remoteValue = remoteResult;
    if (typeof remoteResult === 'string') {
      try { remoteValue = JSON.parse(remoteResult); } catch (_parseError) { remoteValue = null; }
    }
    if (task?.status === 'completed' && resultHash(remoteValue || {}) === row.result_hash) {
      db.prepare("UPDATE paper_completion_outbox SET status='delivered',attempt=attempt+1,delivered_at=?,updated_at=?,next_attempt_at=NULL WHERE outbox_id=?")
        .run(now, now, row.outbox_id);
      return true;
    }
    const nextAttempt = Number(row.attempt || 0) + 1;
    const maxAttempts = Math.max(1, Number(dependencies.outboxMaxAttempts || row.max_attempts || 10));
    const lastError = String(completionError?.message || 'completion delivery failed').slice(0, 1000);
    if (nextAttempt >= maxAttempts) {
      db.prepare("UPDATE paper_completion_outbox SET status='terminal_failed',attempt=?,next_attempt_at=NULL,updated_at=?,terminal_at=?,last_error=? WHERE outbox_id=?")
        .run(nextAttempt, now, now, lastError, row.outbox_id);
      return false;
    }
    const baseDelay = Math.max(1, Number(dependencies.outboxBaseDelayMs || 1000));
    const maxDelay = Math.max(baseDelay, Number(dependencies.outboxMaxDelayMs || 300000));
    const cappedDelay = Math.min(maxDelay, baseDelay * (2 ** Math.min(20, Number(row.attempt || 0))));
    const jitterRatio = Math.min(1, Math.max(0, Number(dependencies.outboxJitterRatio ?? 0.2)));
    const random = dependencies.random || Math.random;
    const delay = Math.min(maxDelay, Math.max(1, Math.round(cappedDelay * (1 + ((random() * 2) - 1) * jitterRatio))));
    db.prepare("UPDATE paper_completion_outbox SET status='pending',attempt=?,next_attempt_at=?,updated_at=?,last_error=? WHERE outbox_id=?")
      .run(nextAttempt, new Date(new Date(now).getTime() + delay).toISOString(), now, lastError, row.outbox_id);
    return false;
  }
}

function bindPaperCompletionClaim(dbLike, taskId, artifactId, claim, options = {}) {
  const db = dbLike.db || dbLike; const now = options.now || new Date().toISOString();
  const info = db.prepare(`UPDATE paper_completion_outbox SET claim_token=?,expected_row_version=?,updated_at=?
    WHERE task_id=? AND artifact_id=? AND status='pending'`)
    .run(claim.claimToken, Number(claim.expectedRowVersion), now, taskId, artifactId);
  return info.changes;
}

async function replayPaperCompletionOutbox(db, dependencies = {}) {
  ensureCompletionOutbox(db);
  const now = dependencies.now?.() || new Date().toISOString();
  const rows = db.prepare("SELECT * FROM paper_completion_outbox WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at").all(now);
  let delivered = 0; let cancelled = 0;
  for (const row of rows) { const outcome = await deliverOutboxRow(db, row, dependencies, now); if (outcome === true) delivered += 1; else if (outcome === 'cancelled') cancelled += 1; }
  return { scanned: rows.length, delivered, cancelled };
}

function markPaperCompletionDelivered(dbLike, taskId, artifactId, options = {}) {
  const db = dbLike.db || dbLike; const now = options.now || new Date().toISOString();
  db.prepare("UPDATE paper_completion_outbox SET status='delivered',delivered_at=?,updated_at=?,next_attempt_at=NULL WHERE task_id=? AND artifact_id=?")
    .run(now, now, taskId, artifactId);
}

async function processDurablePaperTask(task, dbLike, dependencies = {}) {
  const db = dbLike.db || dbLike;
  ensurePaperJobSchema(db); ensureCompletionOutbox(db);
  const now = dependencies.now?.() || new Date().toISOString();
  const relayScope = dependencies.relayScope || process.env.GEWU_RELAY_INSTANCE_ID
    || `cloud_${sha256(String(process.env.GEWU_CLOUD_BASE_URL || 'unconfigured-relay')).slice(0, 24)}`;
  const key = paperJobKey(relayScope, task.id);
  const tenantId = task.selection_context?.tenantId || task.payload?.tenantId || 'default';
  const root = (dependencies.resolveRoot || resolveBoundQuestionBankRoot)(db);
  const created = createOrGetPaperJob(db, {
    jobKey: key, relayScope, cloudTaskId: task.id, taskId: task.id, tenantId,
    ownerUserId: task.created_by || '', requestHash: task.request_hash || sha256(JSON.stringify(task.payload || {})),
    selectionVersion: task.payload?.selectionVersion || null, resourceVersion: task.payload?.resourceVersion || null,
    maxAttempts: task.max_attempts || 3, deadlineAt: task.deadline_at || null,
    tempDir: path.join(root, 'assets', 'paper-job-temp', key),
  }, { now });
  let job = created.job;
  const format = task.task_type === 'paper-export-pdf' ? 'pdf' : 'word';
  let artifact = job.snapshot_hash ? findVerifiedArtifact(db, key, job.snapshot_hash, format, { now }) : null;
  let reusedArtifact = Boolean(artifact);
  if (!artifact) {
    try {
      let preparedQuestions = null; let preparedAssets = null;
      if (!job.question_snapshot_json && !dependencies.freezeSnapshot) {
        const selector = dependencies.selectQuestions || (() => { throw Object.assign(new Error('question selector required'), { code: 'PAPER_SELECTION_REQUIRED' }); });
        preparedQuestions = selector(db, task);
        const allowedImageOrigins = String(process.env.GEWU_PAPER_IMAGE_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
        preparedAssets = await pinSnapshotAssets(root, collectQuestionAssetReferences(preparedQuestions), {
          allowedImageOrigins, fetchImage: globalThis.fetch, ...(dependencies.snapshotAssetOptions || {}),
        });
      }
      const claimed = claimPaperJobWithSnapshot(db, key, () => {
        const selectQuestions = dependencies.selectQuestions || (() => { throw Object.assign(new Error('question selector required'), { code: 'PAPER_SELECTION_REQUIRED' }); });
        const freeze = dependencies.freezeSnapshot || freezePaperSnapshot;
        const contract = (dependencies.deriveExportContract || deriveServerExportContract)(task.payload || {});
        return freeze({
          authoritativeRoot: root, selectQuestions: () => {
            const selected = selectQuestions(db, task);
            if (preparedQuestions && sha256(JSON.stringify(selected)) !== sha256(JSON.stringify(preparedQuestions))) {
              throw Object.assign(new Error('question content changed while remote assets were pinned'), { code: 'PAPER_SNAPSHOT_QUESTION_CHANGED' });
            }
            return selected;
          },
          resolveAssets: dependencies.resolveAssets || (questions => preparedAssets || resolveSnapshotAssets(root, collectQuestionAssetReferences(questions))),
          formulaPolicy: contract.formulaPolicy, templateVersion: contract.templateVersion,
        }).snapshot;
      }, { now });
      job = claimed.job;
      const snapshot = claimed.questions;
      const extension = format === 'pdf' ? 'pdf' : 'docx';
      const finalName = `${String(task.id).replace(/[^a-zA-Z0-9_-]/g, '_')}_${job.snapshot_hash.slice(0, 16)}.${extension}`;
      const artifactId = dependencies.artifactIdFactory?.() || `artifact_${crypto.randomUUID()}`;
      const mimeType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      stagePaperArtifact(db, {
        artifactId, taskId: task.id, jobKey: key, ownerUserId: task.created_by || '', tenantId,
        snapshotHash: job.snapshot_hash, format, mimeType, filePath: path.join(root, 'assets', 'exports', finalName),
        expiresAt: task.result_expires_at || null,
      }, { now });
      const controller = new AbortController();
      let deadlineTimer = null;
      if (job.deadline_at) deadlineTimer = setTimeout(() => controller.abort(Object.assign(new Error('paper job deadline exceeded'), {
        code: 'PAPER_JOB_DEADLINE_EXCEEDED',
      })), Math.max(0, new Date(job.deadline_at).getTime() - Date.now()));
      const cancellationMonitor = setInterval(() => {
        const state = db.prepare('SELECT cancel_requested_at,deadline_at FROM paper_jobs WHERE job_key=?').get(key);
        if (state?.cancel_requested_at) controller.abort(Object.assign(new Error('paper job cancelled'), { code: 'ABORT_ERR' }));
        else if (state?.deadline_at && state.deadline_at <= new Date().toISOString()) {
          controller.abort(Object.assign(new Error('paper job deadline exceeded'), { code: 'PAPER_JOB_DEADLINE_EXCEEDED' }));
        }
      }, dependencies.cancelPollMs || 25);
      cancellationMonitor.unref?.();
      const beforePublish = () => {
        const checkedAt = dependencies.currentTime?.() || new Date().toISOString();
        const assertPublishable = db.transaction(() => {
          const result = db.prepare(`UPDATE paper_jobs SET updated_at=? WHERE job_key=? AND status='processing'
            AND cancel_requested_at IS NULL AND (deadline_at IS NULL OR deadline_at>?)`).run(checkedAt, key, checkedAt);
          if (result.changes === 1) return;
          const state = db.prepare('SELECT status,cancel_requested_at,deadline_at FROM paper_jobs WHERE job_key=?').get(key);
          controller.abort();
          if (state?.deadline_at && state.deadline_at <= checkedAt) {
            throw Object.assign(new Error('paper job deadline exceeded before publish'), { code: 'PAPER_JOB_DEADLINE_EXCEEDED' });
          }
          if (state?.cancel_requested_at) throw Object.assign(new Error('paper job cancelled before publish'), { code: 'ABORT_ERR' });
          throw Object.assign(new Error('paper job is no longer publishable'), { code: 'PAPER_JOB_NOT_PUBLISHABLE' });
        });
        return assertPublishable.immediate();
      };
      try {
        const rendered = await (dependencies.writePaperArtifact || writePaperArtifactInWorker)(format, task.payload || {}, snapshot.questions, {
          root, tempDir: job.temp_dir, finalFileName: finalName, signal: controller.signal,
          artifactIdentity: { artifactId, jobKey: key, snapshotHash: job.snapshot_hash },
          snapshotAssets: snapshot.assets || [],
          beforePublish,
          onProgress: event => {
            const state = db.prepare('SELECT cancel_requested_at,deadline_at FROM paper_jobs WHERE job_key=?').get(key);
            if (state?.cancel_requested_at) controller.abort(Object.assign(new Error('paper job cancelled'), { code: 'ABORT_ERR' }));
            else if (state?.deadline_at && state.deadline_at <= new Date().toISOString()) controller.abort(Object.assign(new Error('paper job deadline exceeded'), { code: 'PAPER_JOB_DEADLINE_EXCEEDED' }));
            db.prepare('UPDATE paper_jobs SET phase=?,progress=MAX(progress,?),updated_at=? WHERE job_key=?')
              .run(event.phase, event.phase === 'rendering' ? 20 : event.phase === 'validating' ? 70 : 90, new Date().toISOString(), key);
          },
        });
        const stat = fs.statSync(rendered.filePath);
        artifact = recordVerifiedArtifact(db, {
          artifactId,
          taskId: task.id, jobKey: key, ownerUserId: task.created_by || '', tenantId, snapshotHash: job.snapshot_hash,
          format, mimeType,
          sizeBytes: stat.size, sha256: rendered.sha256, pageCount: rendered.pageCount, formulaCount: rendered.formulaCount,
          fallbackCount: rendered.fallbackCount, effectiveModes: rendered.effectiveFormulaModes, filePath: rendered.filePath,
          expiresAt: task.result_expires_at || null,
        }, { now });
      } finally {
        clearInterval(cancellationMonitor);
        if (deadlineTimer) clearTimeout(deadlineTimer);
      }
    } catch (error) {
      const state = db.prepare('SELECT cancel_requested_at,deadline_at FROM paper_jobs WHERE job_key=?').get(key);
      const cancelled = Boolean(state?.cancel_requested_at) && error.code === 'ABORT_ERR';
      const timedOut = error.code === 'PAPER_JOB_DEADLINE_EXCEEDED' || (error.code === 'ABORT_ERR' && state?.deadline_at && state.deadline_at <= new Date().toISOString());
      let failedJob;
      if (cancelled || timedOut) {
        const status = cancelled ? 'cancelled' : 'failed';
        db.prepare('UPDATE paper_jobs SET status=?,phase=?,next_attempt_at=NULL,updated_at=? WHERE job_key=?').run(status, status, now, key);
        failedJob = db.prepare('SELECT * FROM paper_jobs WHERE job_key=?').get(key);
      } else {
        failedJob = markPaperJobRetry(db, key, error, { now, baseDelayMs: dependencies.baseDelayMs || 1000 });
      }
      error.paperJob = failedJob; throw error;
    }
  }
  job = db.prepare('SELECT * FROM paper_jobs WHERE job_key=?').get(key);
  const accessEndpoint = `/api/cloud-relay-host/artifacts/${encodeURIComponent(artifact.artifact_id)}/access`;
  if (dependencies.skipCompletionOutbox) {
    return { artifactReady: true, callbackPending: false, reusedArtifact, artifact, jobKey: key, accessEndpoint };
  }
  const row = enqueueCompletion(db, job, artifact, now);
  if (dependencies.completionClaim) bindPaperCompletionClaim(db, task.id, artifact.artifact_id, dependencies.completionClaim, { now });
  const boundRow = db.prepare('SELECT * FROM paper_completion_outbox WHERE outbox_id=?').get(row.outbox_id);
  const delivered = dependencies.deferCompletion ? false : await deliverOutboxRow(db, boundRow, dependencies, now);
  return { artifactReady: true, callbackPending: !delivered, reusedArtifact, artifact, jobKey: key, accessEndpoint };
}

module.exports = { bindPaperCompletionClaim, deriveServerExportContract, ensureCompletionOutbox, markPaperCompletionDelivered, processDurablePaperTask, replayPaperCompletionOutbox };
