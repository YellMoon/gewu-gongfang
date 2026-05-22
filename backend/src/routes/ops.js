const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { getInstance } = require('../database');
const cache = require('../services/cacheService');
const searchService = require('../services/searchService');

const router = Router();

router.get('/audit', (req, res) => {
  try {
    const db = getInstance();
    const logs = db.getAuditLogs({
      tenantId: req.query.tenant_id || req.query.tenantId,
      action: req.query.action,
      status: req.query.status,
      tableName: req.query.table_name || req.query.tableName,
      recordId: req.query.record_id || req.query.recordId,
      startTime: req.query.start_time || req.query.startTime,
      endTime: req.query.end_time || req.query.endTime,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/health/deep', async (req, res) => {
  const checks = {};
  try {
    const db = getInstance().db;
    checks.sqlite = db.prepare('SELECT 1 AS ok').get().ok === 1;
    const pendingEvents = db.prepare("SELECT COUNT(*) AS cnt FROM outbox_events WHERE status = 'pending'").get().cnt;
    const pendingIndexJobs = db.prepare("SELECT COUNT(*) AS cnt FROM search_index_jobs WHERE status = 'pending'").get().cnt;
    const failedEvents = db.prepare("SELECT COUNT(*) AS cnt FROM outbox_events WHERE status = 'failed'").get().cnt;
    const failedIndexJobs = db.prepare("SELECT COUNT(*) AS cnt FROM search_index_jobs WHERE status = 'failed'").get().cnt;

    try {
      await cache.set('__healthcheck__', { ok: true, at: new Date().toISOString() }, 5);
      checks.cache = !!(await cache.get('__healthcheck__'));
      checks.cacheMode = cache.usingRedis ? 'redis' : 'memory';
    } catch (err) {
      checks.cache = false;
      checks.cacheError = err.message;
    }

    checks.search = {
      enabled: searchService.enabled(),
      endpointConfigured: !!process.env.OPENSEARCH_ENDPOINT,
      pendingJobs: pendingIndexJobs,
      failedJobs: failedIndexJobs,
    };
    checks.outbox = { pendingEvents, failedEvents };

    const ok = Boolean(checks.sqlite && checks.cache);
    res.status(ok ? 200 : 503).json({
      ok,
      time: new Date().toISOString(),
      traceId: req.traceId,
      checks,
      monitoring: {
        provider: process.env.MONITORING_PROVIDER || null,
        slsProject: process.env.SLS_PROJECT || null,
        armsAppName: process.env.ARMS_APP_NAME || null,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, traceId: req.traceId, checks, error: err.message });
  }
});

router.post('/archive/jobs', (req, res) => {
  try {
    const db = getInstance().db;
    const now = new Date().toISOString();
    const id = uuidv4();
    db.prepare(
      `INSERT INTO data_archive_jobs
       (id, tenant_id, target_table, archive_before, status, affected_rows, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`
    ).run(id, req.body.tenant_id || 'default', req.body.target_table, req.body.archive_before, now, now);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/archive/jobs/:id/run', (req, res) => {
  try {
    const db = getInstance().db;
    const job = db.prepare('SELECT * FROM data_archive_jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: 'archive job not found' });
    const allowedTables = ['schedules', 'payments', 'consumptions', 'sync_log', 'sync_audit_log'];
    if (!allowedTables.includes(job.target_table)) {
      return res.status(400).json({ success: false, error: 'target table not allowed' });
    }
    const now = new Date().toISOString();
    const columns = db.prepare(`PRAGMA table_info(${job.target_table})`).all().map(c => c.name);
    const timeColumn = columns.includes('updated_at') ? 'updated_at' : columns.includes('sync_time') ? 'sync_time' : 'created_at';
    let result;
    if (columns.includes('deleted')) {
      result = db.prepare(
        `UPDATE ${job.target_table} SET deleted = 1, updated_at = ? WHERE ${timeColumn} < ? AND deleted = 0`
      ).run(now, job.archive_before);
    } else {
      result = db.prepare(`DELETE FROM ${job.target_table} WHERE ${timeColumn} < ?`).run(job.archive_before);
    }
    db.prepare(
      `UPDATE data_archive_jobs SET status = 'finished', affected_rows = ?, updated_at = ?, finished_at = ? WHERE id = ?`
    ).run(result.changes, now, now, job.id);
    res.json({ success: true, affected_rows: result.changes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/slow-query-guidance', (_req, res) => {
  res.json({
    success: true,
    policies: [
      '为高频查询保留 tenant_id + deleted + updated_at 组合索引',
      '题库全文检索走 OpenSearch，SQLite 仅作离线兜底',
      '历史数据通过 archive_jobs 归档，避免热表无限增长',
      '读写分离由 API 层按 READ_DB_PATH / DB_PATH 拆分连接',
    ],
  });
});

module.exports = router;
