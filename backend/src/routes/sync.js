/**
 * 数据同步路由（核心）
 *
 * Sync v2 change queue:
 * { id, table, action, data, version, updatedAt, tenantId, deviceId }
 *
 * 保留 /pull 和 /push 兼容旧客户端；新客户端优先使用：
 * - GET  /api/sync?since=ISO8601
 * - POST /api/sync/push { changes: SyncChange[] }
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

function readSince(req) {
  return req.query.since
    || req.query.lastSyncTime
    || req.query.lastSyncTs
    || req.body?.since
    || req.body?.last_sync_time
    || req.body?.lastSyncTimestamp
    || 0;
}

function requireValidSince(req, res) {
  const raw = readSince(req);
  const normalized = getInstance()._normalizeSyncTime(raw);
  const isNumericString = typeof raw === 'string' && /^\d+$/.test(raw.trim());
  if (raw && Date.parse(String(raw)) !== Date.parse(normalized) && typeof raw !== 'number' && !isNumericString) {
    res.status(400).json({ success: false, error: 'since must be a valid ISO8601 timestamp' });
    return null;
  }
  return normalized;
}

function readDeviceId(req) {
  return req.query.deviceId
    || req.query.device_id
    || req.query.client_id
    || req.body?.deviceId
    || req.body?.device_id
    || req.body?.client_id
    || req.body?.clientId
    || 'unknown';
}

function readTenantId(req) {
  return req.tenantId
    || req.query.tenantId
    || req.query.tenant_id
    || req.body?.tenantId
    || req.body?.tenant_id
    || 'default';
}

function groupedChangesFromQueue(changes) {
  return changes.reduce((grouped, change) => {
    const rows = grouped[change.table] || [];
    rows.push({
      ...change.data,
      _sync_operation_id: change.id,
      _sync_action: change.action,
      _sync_client_id: change.deviceId,
      _sync_version: change.version,
    });
    grouped[change.table] = rows;
    return grouped;
  }, {});
}

function sendQueueResponse(res, payload, extra = {}) {
  res.json({
    success: true,
    changes: payload.changes,
    serverTime: payload.serverTime,
    serverTimestamp: Date.parse(payload.serverTime),
    server_time: payload.serverTime,
    since: payload.since,
    ...extra,
  });
}

router.get('/', (req, res) => {
  try {
    const db = getInstance();
    const since = requireValidSince(req, res);
    if (!since) return;
    const deviceId = readDeviceId(req);
    const payload = db.getChangeQueueSince(since, {
      tenantId: readTenantId(req),
      deviceId: 'server',
      clientId: deviceId,
    });
    console.log(`[Sync:Queue] device=${deviceId} since=${since.slice(0, 19)} changes=${payload.changes.length}`);
    sendQueueResponse(res, payload);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/pull', (req, res) => {
  try {
    const db = getInstance();
    const since = requireValidSince(req, res);
    if (!since) return;
    const deviceId = readDeviceId(req);
    const payload = db.getChangeQueueSince(since, {
      tenantId: readTenantId(req),
      deviceId: 'server',
      clientId: deviceId,
    });
    console.log(`[Sync:Pull] device=${deviceId} since=${since.slice(0, 19)} changes=${payload.changes.length}`);
    sendQueueResponse(res, payload, {
      legacyChanges: groupedChangesFromQueue(payload.changes),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/pull', (req, res) => {
  try {
    const db = getInstance();
    const since = requireValidSince(req, res);
    if (!since) return;
    const deviceId = readDeviceId(req);
    const payload = db.getChangeQueueSince(since, {
      tenantId: readTenantId(req),
      deviceId: 'server',
      clientId: deviceId,
    });
    console.log(`[Sync:Pull] device=${deviceId} since=${since.slice(0, 19)} changes=${payload.changes.length}`);
    sendQueueResponse(res, payload, {
      legacyChanges: groupedChangesFromQueue(payload.changes),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/push', (req, res) => {
  try {
    const db = getInstance();
    const deviceId = readDeviceId(req);
    const changes = req.body?.changes || req.body?.operations;

    if (!changes) {
      return res.status(400).json({ success: false, error: '缺少 changes' });
    }

    const result = db.applySyncChanges(changes, { deviceId, tenantId: readTenantId(req) });
    const serverTime = db._now();
    console.log(`[Sync:Push] device=${deviceId} applied=${result.applied} conflicts=${result.conflicts} errors=${result.errors.length}`);

    res.json({
      success: true,
      ...result,
      serverTime,
      serverTimestamp: Date.parse(serverTime),
      server_time: serverTime,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/status', (_req, res) => {
  try {
    const db = getInstance();
    const status = db.getSyncStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
