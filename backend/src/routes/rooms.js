/**
 * 教室/地址管理路由
 */
const { Router } = require('express');
const { getInstance } = require('../database');

const router = Router();

function validateRoom(req, res, next) {
  if (req.method === 'POST' && !req.body.name) {
    return res.status(400).json({ error: '参数校验失败', details: { missing: ['name'] } });
  }
  return next();
}

router.get('/', (req, res) => {
  try { res.json({ success: true, data: getInstance().getAllRooms() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const room = getInstance().getRoomById(req.params.id);
    if (!room) return res.status(404).json({ error: '教室不存在' });
    res.json({ success: true, data: room });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', validateRoom, (req, res) => {
  try { res.status(201).json({ success: true, data: getInstance().createRoom(req.body) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', validateRoom, (req, res) => {
  try {
    const room = getInstance().updateRoom(req.params.id, req.body);
    if (!room) return res.status(404).json({ error: '教室不存在' });
    res.json({ success: true, data: room });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req, res) => {
  try { getInstance().deleteRoom(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
