const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');
const { createDesktopPairing, exchangeDesktopPairing, normalizePhone } = require('../services/desktopPairingService');
const router = express.Router();

const send = (res, error) => res.status(error.code === 'PAIRING_NOT_FOUND' ? 404 : 403)
  .json({ success: false, code: error.code || 'PAIRING_FAILED' });

router.post('/start', (req, res) => {
  try { res.json({ success: true, pairing: createDesktopPairing(getDb(), req.body) }); }
  catch (error) { send(res, error); }
});

router.post('/exchange', (req, res) => {
  try {
    const result = exchangeDesktopPairing(getDb(), req.body);
    const user = getDb().prepare('SELECT * FROM users WHERE id=?').get(result.userId);
    if (!user || user.review_status !== 'approved' || user.login_enabled === 0 || user.status === 0) throw Object.assign(new Error(), { code: 'USER_NOT_APPROVED' });
    if (!process.env.JWT_SECRET) throw Object.assign(new Error(), { code: 'JWT_SECRET_REQUIRED' });
    const token = jwt.sign({ id: user.id, user_type: user.user_type, deviceId: result.deviceId, token_use: 'desktop-session' }, JWT_SECRET,
      { expiresIn: '30m', algorithm: 'HS256', issuer: 'gewu-auth', audience: 'gewu-api' });
    res.json({ success: true, token, userId: user.id, deviceId: result.deviceId, expiresIn: 1800 });
  } catch (error) { send(res, error); }
});

router.get('/pending', authMiddleware, (req, res) => {
  if (req.user?.user_type !== 'super_admin') return res.status(403).json({ success: false, code: 'SUPER_ADMIN_REQUIRED' });
  const limit = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const offset = (Math.max(1, Number(req.query.page) || 1) - 1) * limit;
  const rows = getDb().prepare(`SELECT id,device_id AS deviceId,device_name AS deviceName,phone,
    pairing_code AS pairingCode,status,expires_at AS expiresAt,created_at AS createdAt
    FROM desktop_device_pairings WHERE status='pending' AND pairing_code LIKE ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(`%${String(req.query.code || '')}%`, limit, offset);
  return res.json({ success: true, items: rows });
});

function review(status, byCode = false) {
  return [authMiddleware, (req, res) => {
    try {
      if (req.user?.user_type !== 'super_admin') return res.status(403).json({ success: false, code: 'SUPER_ADMIN_REQUIRED' });
      const db = getDb();
      const now = new Date().toISOString();
      const row = byCode
        ? db.prepare("SELECT * FROM desktop_device_pairings WHERE pairing_code=? AND status='pending' AND expires_at>=?").get(req.params.pairingCode, now)
        : db.prepare("SELECT * FROM desktop_device_pairings WHERE id=? AND status='pending' AND expires_at>=?").get(req.params.id, now);
      if (!row) return res.status(404).json({ success: false, code: 'PAIRING_NOT_FOUND' });
      const users = db.prepare("SELECT * FROM users WHERE review_status='approved' AND login_enabled=1 AND status=1").all()
        .filter(user => normalizePhone(user.phone) === row.phone);
      if (users.length !== 1) return res.status(409).json({ success: false, code: 'PAIRING_USER_UNRESOLVED' });
      const existing = db.prepare('SELECT owner_user_id FROM cloud_devices WHERE id=?').get(row.device_id);
      if (existing?.owner_user_id && existing.owner_user_id !== users[0].id) return res.status(409).json({ success: false, code: 'DEVICE_OWNER_CONFLICT' });
      db.transaction(() => {
        const changed = db.prepare("UPDATE desktop_device_pairings SET status=?,approved_by=?,user_id=?,updated_at=? WHERE id=? AND status='pending' AND expires_at>=?")
          .run(status, req.user.id, users[0].id, now, row.id, now);
        if (changed.changes !== 1) throw Object.assign(new Error(), { code: 'PAIRING_STATE_CHANGED' });
        if (status === 'approved') db.prepare(`INSERT INTO cloud_devices(id,device_name,role,status,owner_user_id,active,created_at,updated_at)
          VALUES(?,?,?,'active',?,1,?,?) ON CONFLICT(id) DO UPDATE SET
          owner_user_id=COALESCE(cloud_devices.owner_user_id,excluded.owner_user_id),active=1,updated_at=excluded.updated_at`)
          .run(row.device_id, row.device_name, 'desktop-client', users[0].id, now, now);
        db.prepare('INSERT INTO authorization_audit_log(id,actor_user_id,target_user_id,action,after_json,created_at) VALUES(?,?,?,?,?,?)')
          .run(crypto.randomUUID(), req.user.id, users[0].id, `desktop-pairing:${status}`, JSON.stringify({ pairingId: row.id, deviceId: row.device_id }), now);
      })();
      return res.json({ success: true, status });
    } catch (error) { return send(res, error); }
  }];
}

router.post('/:id/approve', ...review('approved'));
router.post('/:id/reject', ...review('rejected'));
router.post('/code/:pairingCode/approve', ...review('approved', true));
router.post('/code/:pairingCode/reject', ...review('rejected', true));
module.exports = router;
