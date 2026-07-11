const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { generateToken, refreshToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { resolveWechatIdentity, resolveWechatPhoneNumber } = require('../services/wechatMiniappService');
const { createAuthRateLimiter } = require('../services/authRateLimiter');
const authLimiter = createAuthRateLimiter();
function authRateLimit(req, res, next) {
  const result = authLimiter.check({ ip: req.ip, identifier: req.body?.phoneCode || req.body?.code });
  if (!result.allowed) { res.set('Retry-After', String(result.retryAfter)); return res.status(429).json({ success: false, code: 'AUTH_RATE_LIMITED' }); }
  next();
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return value.split(',').map(item => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function linkedStudentIds(user = {}) {
  const ids = [
    user.student_id,
    ...parseArray(user.linked_student_ids),
    user.user_type === 'student' ? user.id : undefined,
  ];
  return Array.from(new Set(ids.filter(Boolean).map(String)));
}

function loginDenialReason(user) {
  if (!user) return 'MINIAPP_USER_NOT_PREAUTHORIZED';
  if (user.review_status === 'pending' || user.user_type === 'pending') return 'USER_PENDING_REVIEW';
  if (user.status === 0 || user.login_enabled !== 1) return 'MINIAPP_LOGIN_DISABLED';
  if (!['super_admin', 'admin', 'student'].includes(user.user_type)) return 'MINIAPP_ROLE_NOT_ALLOWED';
  if (user.user_type === 'student' && linkedStudentIds(user).length === 0) return 'MINIAPP_STUDENT_NOT_LINKED';
  return '';
}

function loginUserPayload(user) {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    user_type: user.user_type,
    phone: user.phone || null,
    student_id: user.student_id || null,
    linked_student_ids: linkedStudentIds(user),
  };
}

router.post('/login', (_req, res) => res.status(410).json({ success: false, code: 'LEGACY_OPENID_LOGIN_DISABLED' }));

router.post('/wechat-login', authRateLimit, async (req, res) => {
  try {
    const code = String(req.body.code || '');
    const phoneCode = String(req.body.phoneCode || '');
    if (!code || code.length > 256 || phoneCode.length > 256) return res.status(400).json({ success: false, code: 'WECHAT_CODE_INVALID' });
    const { openid } = await resolveWechatIdentity(code);
    const db = getDb();
    let user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
    if (!user && !req.body.phoneCode) return res.status(403).json({ success: false, code: 'PHONE_VERIFICATION_REQUIRED' });
    if (!user) {
      const phone = await resolveWechatPhoneNumber(req.body.phoneCode);
      user = db.transaction(() => {
        const phoneOwner = db.prepare('SELECT * FROM users WHERE phone_normalized = ?').get(phone);
        const openidOwner = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
        if ((openidOwner && (!phoneOwner || openidOwner.id !== phoneOwner.id)) || (phoneOwner?.openid && phoneOwner.openid !== openid)) {
          throw Object.assign(new Error('identity conflict'), { code: 'PHONE_IDENTITY_CONFLICT' });
        }
        const now = new Date().toISOString();
        if (phoneOwner) {
          db.prepare('UPDATE users SET openid = ?, updated_at = ? WHERE id = ? AND (openid IS NULL OR openid = ?)').run(openid, now, phoneOwner.id, openid);
          return db.prepare('SELECT * FROM users WHERE id = ?').get(phoneOwner.id);
        }
        const id = uuidv4();
        db.prepare(`INSERT INTO users (id, openid, phone, phone_normalized, name, user_type, status, login_enabled, review_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'pending', 1, 0, 'pending', ?, ?)`).run(id, openid, phone, phone, phone, now, now);
        return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      }).immediate();
    }
    const denial = loginDenialReason(user);
    if (denial) return res.status(denial === 'USER_PENDING_REVIEW' && req.body.phoneCode ? 202 : 403)
      .json({ success: false, code: denial === 'USER_PENDING_REVIEW' && req.body.phoneCode ? 'PENDING_REVIEW' : denial });
    const token = generateToken(user);
    return res.json({ success: true, data: { token, user: loginUserPayload(user), role: user.user_type } });
  } catch (error) {
    if (error.code === 'PHONE_IDENTITY_CONFLICT' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ success: false, code: 'PHONE_IDENTITY_CONFLICT' });
    }
    return res.status(502).json({ success: false, code: error.code || 'WECHAT_LOGIN_FAILED' });
  }
});

router.post('/register', (_req, res) => {
  return res.status(410).json({
    success: false,
    code: 'MINIAPP_SELF_REGISTER_DISABLED',
    error: 'Miniapp self registration is disabled',
  });
});

router.post('/refresh', (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, error: 'token is required' });
  }

  const newToken = refreshToken(token);
  if (!newToken) {
    return res.status(401).json({ success: false, error: 'token cannot be refreshed' });
  }

  return res.json({ success: true, token: newToken });
});

module.exports = router;
