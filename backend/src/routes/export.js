const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getInstance } = require('../database');
const { inspectBackupTargets } = require('../services/questionBankBackupTargetService');
const { archiveBackupArtifact } = require('../services/backupArchiveService');

const router = Router();

function tenantOptions(req) {
  return { tenantId: req.tenantId || req.query.tenant_id || req.body?.tenant_id || 'default' };
}
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'data', 'backups');
const ALLOWED_RESTORE_STATUSES = new Set(['finished', 'restored']);

function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function safeJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    jobType: row.job_type,
    targetTable: row.target_table,
    archiveBefore: row.archive_before,
    status: row.status,
    affectedRows: row.affected_rows,
    artifactPath: row.artifact_path,
    artifactFormat: row.artifact_format,
    ossKey: row.oss_key,
    ossUrl: row.oss_url,
    scheduleCron: row.schedule_cron,
    retentionDays: row.retention_days,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    restoredAt: row.restored_at,
  };
}

function countExportedRows(snapshot) {
  return Object.values(snapshot).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
}

function createBackupJob({ tenantId = 'default', scheduleCron = null, retentionDays = 30 } = {}) {
  ensureBackupDir();
  const service = getInstance();
  const db = service.db;
  const now = new Date().toISOString();
  const id = uuidv4();
  const fileName = `scheduling-backup-${now.replace(/[:.]/g, '-')}-${id}.json`;
  const artifactPath = path.join(BACKUP_DIR, fileName);

  db.prepare(
    `INSERT INTO data_archive_jobs
     (id, tenant_id, job_type, target_table, archive_before, status, affected_rows,
      artifact_path, artifact_format, schedule_cron, retention_days, created_at, updated_at)
     VALUES (?, ?, 'backup', '__all__', ?, 'running', 0, ?, 'json', ?, ?, ?, ?)`
  ).run(id, tenantId, now, artifactPath, scheduleCron, retentionDays, now, now);

  try {
    const snapshot = service.exportAll({ tenantId });
    const payload = {
      meta: {
        backupId: id,
        tenantId,
        createdAt: now,
        source: 'api-backup',
        format: 'scheduling-system.exportAll.v1',
        retentionDays,
        scheduleCron,
        ossLifecycle: {
          enabled: Boolean(process.env.BACKUP_OSS_LIFECYCLE_DAYS),
          expireDays: Number(process.env.BACKUP_OSS_LIFECYCLE_DAYS || retentionDays || 30),
          storageClass: process.env.BACKUP_OSS_STORAGE_CLASS || 'IA',
        },
      },
      data: snapshot,
    };
    fs.writeFileSync(artifactPath, JSON.stringify(payload, null, 2), 'utf-8');
    let archiveTargets = null;
    try {
      archiveTargets = archiveBackupArtifact(artifactPath, {
        localCachePath: process.env.GEWU_LOCAL_CACHE_PATH,
        nasBackupPath: process.env.GEWU_NAS_BACKUP_PATH,
        fileName,
        now: new Date(now),
      });
    } catch (archiveErr) {
      archiveTargets = {
        localCache: { available: false, status: 'failed', reason: archiveErr.message },
        nasBackup: { available: false, status: 'failed', reason: archiveErr.message },
      };
    }
    const total = countExportedRows(snapshot);
    const doneAt = new Date().toISOString();
    db.prepare(
      `UPDATE data_archive_jobs
       SET status = 'finished', affected_rows = ?, updated_at = ?, finished_at = ?
       WHERE id = ?`
    ).run(total, doneAt, doneAt, id);
    service._auditOperation({
      tenant_id: tenantId,
      action: 'backup',
      table_name: 'data_archive_jobs',
      record_id: id,
      status: 'success',
      detail: { total, artifactPath, retentionDays, scheduleCron, archiveTargets },
    });
  } catch (err) {
    db.prepare(
      `UPDATE data_archive_jobs
       SET status = 'failed', error_message = ?, updated_at = ?
       WHERE id = ?`
    ).run(err.message, new Date().toISOString(), id);
    service._auditOperation({
      tenant_id: tenantId,
      action: 'backup',
      table_name: 'data_archive_jobs',
      record_id: id,
      status: 'failed',
      detail: { error: err.message },
    });
    throw err;
  }

  return safeJob(db.prepare('SELECT * FROM data_archive_jobs WHERE id = ?').get(id));
}

function readBackupPayload(job) {
  if (!job || !ALLOWED_RESTORE_STATUSES.has(job.status)) {
    throw new Error('backup job is not restorable');
  }
  if (!job.artifact_path || !fs.existsSync(job.artifact_path)) {
    throw new Error('backup artifact not found');
  }
  const payload = JSON.parse(fs.readFileSync(job.artifact_path, 'utf-8'));
  return payload.data || payload;
}

router.get('/export', (req, res) => {
  try {
    const db = getInstance();
    const data = db.exportAll(tenantOptions(req));
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=scheduling-backup-${date}.json`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/import', (req, res) => {
  try {
    const db = getInstance();
    const result = db.importAll(req.body, tenantOptions(req));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/backups', (req, res) => {
  try {
    const db = getInstance().db;
    const { tenantId } = tenantOptions(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const jobs = db.prepare(
      `SELECT * FROM data_archive_jobs
       WHERE job_type = 'backup' AND tenant_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(tenantId, limit).map(safeJob);
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/backups', (req, res) => {
  try {
    const { tenantId } = tenantOptions(req);
    const job = createBackupJob({
      tenantId,
      scheduleCron: req.body.schedule_cron || req.body.scheduleCron || null,
      retentionDays: Number(req.body.retention_days || req.body.retentionDays || 30),
    });
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/backups/targets/status', (_req, res) => {
  try {
    const targets = inspectBackupTargets({
      localCachePath: process.env.GEWU_LOCAL_CACHE_PATH,
      nasBackupPath: process.env.GEWU_NAS_BACKUP_PATH,
    });
    res.json({
      success: true,
      targets: {
        localCache: targets.localCache,
        nasBackup: targets.nasBackup,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/backups/:id/download', (req, res) => {
  try {
    const db = getInstance().db;
    const { tenantId } = tenantOptions(req);
    const job = db.prepare(
      'SELECT * FROM data_archive_jobs WHERE id = ? AND job_type = ? AND tenant_id = ?'
    ).get(req.params.id, 'backup', tenantId);
    if (!job) return res.status(404).json({ success: false, error: 'backup job not found' });
    if (!job.artifact_path || !fs.existsSync(job.artifact_path)) {
      return res.status(404).json({ success: false, error: 'backup artifact not found' });
    }
    return res.download(job.artifact_path, path.basename(job.artifact_path));
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/backups/:id/restore', (req, res) => {
  try {
    const service = getInstance();
    const db = service.db;
    const { tenantId } = tenantOptions(req);
    const job = db.prepare(
      'SELECT * FROM data_archive_jobs WHERE id = ? AND job_type = ? AND tenant_id = ?'
    ).get(req.params.id, 'backup', tenantId);
    if (!job) return res.status(404).json({ success: false, error: 'backup job not found' });
    const data = readBackupPayload(job);
    const result = service.importAll(data, { tenantId });
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE data_archive_jobs
       SET status = 'restored', restored_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(now, now, job.id);
    service._auditOperation({
      tenant_id: job.tenant_id || 'default',
      action: 'restore',
      table_name: 'data_archive_jobs',
      record_id: job.id,
      status: 'success',
      detail: result,
    });
    return res.json({
      success: true,
      job: safeJob(db.prepare('SELECT * FROM data_archive_jobs WHERE id = ?').get(job.id)),
      result,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
module.exports.createBackupJob = createBackupJob;
