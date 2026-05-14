/**
 * 教室/地址管理路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

function tenantOptions(req) {
  return { tenantId: req.tenantId || req.query.tenant_id || req.body?.tenant_id || 'default' };
}

function validateRoom(req, res, next) {
  if (req.method === 'POST' && !req.body.name) {
    return res.status(400).json({ error: '参数校验失败', details: { missing: ['name'] } });
  }
  return next();
}

router.get('/', (req, res) => {
  try { res.json({ success: true, data: getInstance().getAllRooms(tenantOptions(req)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const room = getInstance().getRoomById(req.params.id, tenantOptions(req));
    if (!room) return res.status(404).json({ error: '教室不存在' });
    res.json({ success: true, data: room });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', validateRoom, (req, res) => {
  try { res.status(201).json({ success: true, data: getInstance().createRoom(req.body, tenantOptions(req)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', validateRoom, (req, res) => {
  try {
    const room = getInstance().updateRoom(req.params.id, req.body, tenantOptions(req));
    if (!room) return res.status(404).json({ error: '教室不存在' });
    res.json({ success: true, data: room });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req, res) => {
  try {
    const deleted = getInstance().deleteRoom(req.params.id, tenantOptions(req));
    if (!deleted) return res.status(404).json({ error: '鏁欏涓嶅瓨鍦?' });
    res.json({ success: true });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
