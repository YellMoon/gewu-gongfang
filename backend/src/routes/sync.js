/**
 * 数据同步路由（核心）
 * 
 * 同步协议 v1.0:
 * - Pull: 客户端发送 last_sync_time，服务器返回该时间后的所有变更
 * - Push: 客户端发送本地变更列表，服务器应用（时间戳冲突检测）
 * - Status: 检查各表的同步状态
 * 
 * 每条记录带 updated_at 和 deleted（软删除）标记
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

/**
 * POST /api/sync/pull
 * 客户端发送上次同步时间，服务器返回该时间后的所有变更
 * 
 * Body: { last_sync_time: "2024-01-01T00:00:00.000Z", client_id: "electron-xxx" }
 * Response: { changes: { students: [...], courses: [...], ... }, server_time: "..." }
 */
router.post('/pull', (req, res) => {
  try {
    const db = getInstance();
    const { last_sync_time, client_id } = req.body;
    
    if (!last_sync_time) {
      return res.status(400).json({ error: '缺少 last_sync_time' });
    }

    const changes = db.getChangesSinceAll(last_sync_time);
    
    console.log(`[Sync:Pull] client=${client_id || 'unknown'} since=${last_sync_time.slice(0,19)} changes=${Object.values(changes).filter(Array.isArray).reduce((s,a)=>s+a.length,0)}`);
    
    res.json({ success: true, changes, server_time: changes.server_time });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/sync/push
 * 客户端发送本地变更列表，服务器应用
 * 
 * Body: {
 *   client_id: "electron-xxx",
 *   changes: {
 *     students: [{ id, ...fields, updated_at, deleted }],
 *     courses: [...],
 *     ...
 *   }
 * }
 * 
 * Response: { applied: N, conflicts: N, errors: [...], server_time: "..." }
 */
router.post('/push', (req, res) => {
  try {
    const db = getInstance();
    const { client_id, changes } = req.body;
    
    if (!changes) {
      return res.status(400).json({ error: '缺少 changes' });
    }

    const result = db.applyPushChanges(client_id || 'unknown', changes);
    
    console.log(`[Sync:Push] client=${client_id || 'unknown'} applied=${result.applied} conflicts=${result.conflicts} errors=${result.errors.length}`);
    
    res.json({ success: true, ...result, server_time: db._now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/sync/status
 * 获取同步状态（各表记录数和最后更新时间）
 * 
 * Body: { client_id: "electron-xxx" }
 * Response: { tables: { students: { count, last_updated }, ... }, server_time }
 */
router.post('/status', (req, res) => {
  try {
    const db = getInstance();
    const status = db.getSyncStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
