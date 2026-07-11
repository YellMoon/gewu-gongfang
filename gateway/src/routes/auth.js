const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { generateToken, refreshToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { resolveWechatIdentity, resolveWechatPhoneNumber } = require('../services/wechatMiniappService');

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

function loginByOpenid(req, res, openid, profile = {}) {
  if (!openid) {
    return res.status(400).json({ success: false, error: 'openid is required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
  const denialReason = loginDenialReason(user);
  if (denialReason) {
    return res.status(403).json({
      success: false,
      code: denialReason,
      error: 'Miniapp account is not authorized on the data host',
    });
  }

  if (profile.name || profile.avatar) {
    db.prepare('UPDATE users SET name = COALESCE(?, name), avatar = COALESCE(?, avatar), updated_at = ? WHERE id = ?')
      .run(profile.name || null, profile.avatar || null, new Date().toISOString(), user.id);
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const token = generateToken(updated);
  return res.json({ success: true, token, user: loginUserPayload(updated) });
}

router.post('/login', (req, res) => {
  return loginByOpenid(req, res, req.body.openid, {
    name: req.body.name,
    avatar: req.body.avatar,
  });
});

router.post('/wechat-login', async (req, res) => {
  try {
    const code = String(req.body.code || '');
    if (!code) return res.status(400).json({ success: false, code: 'WECHAT_CODE_REQUIRED' });
    const { openid } = await resolveWechatIdentity(code);
    const db = getDb();
    let user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
    if (!user && !req.body.phoneCode) return res.status(403).json({ success: false, code: 'PHONE_VERIFICATION_REQUIRED' });
    if (!user) {
      const phone = await resolveWechatPhoneNumber(req.body.phoneCode);
      const phoneMatches = db.prepare('SELECT * FROM users WHERE phone = ?').all(phone);
      if (phoneMatches.length > 1) return res.status(409).json({ success: false, code: 'PHONE_IDENTITY_CONFLICT' });
      user = phoneMatches[0];
      const openidOwner = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
      if (openidOwner && (!user || openidOwner.id !== user.id)) return res.status(409).json({ success: false, code: 'WECHAT_IDENTITY_CONFLICT' });
      if (user && user.openid && user.openid !== openid) return res.status(409).json({ success: false, code: 'PHONE_ALREADY_BOUND' });
      const now = new Date().toISOString();
      if (user) db.prepare('UPDATE users SET openid = ?, updated_at = ? WHERE id = ?').run(openid, now, user.id);
      else {
        const id = uuidv4();
        db.prepare(`INSERT INTO users (id, openid, phone, name, user_type, status, login_enabled, review_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'pending', 1, 0, 'pending', ?, ?)`).run(id, openid, phone, phone, now, now);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      }
      user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
    }
    const denial = loginDenialReason(user);
    if (denial) return res.status(denial === 'USER_PENDING_REVIEW' && req.body.phoneCode ? 202 : 403)
      .json({ success: false, code: denial === 'USER_PENDING_REVIEW' && req.body.phoneCode ? 'PENDING_REVIEW' : denial });
    const token = generateToken(user);
    return res.json({ success: true, data: { token, user: loginUserPayload(user), role: user.user_type } });
  } catch (error) {
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
