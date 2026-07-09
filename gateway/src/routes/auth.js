const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { generateToken, refreshToken } = require('../middleware/auth');

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
  if (user.status === 0 || user.login_enabled !== 1) return 'MINIAPP_LOGIN_DISABLED';
  if (!['admin', 'student'].includes(user.user_type)) return 'MINIAPP_ROLE_NOT_ALLOWED';
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

router.post('/wechat-login', (req, res) => {
  const code = req.body.code || '';
  const openid = req.body.openid
    || (process.env.ALLOW_DEV_WECHAT_LOGIN === 'true' && code
      ? `dev_${String(code).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)}`
      : '');
  return loginByOpenid(req, res, openid, {
    name: req.body.name,
    avatar: req.body.avatar,
  });
});

router.post('/register', (_req, res) => {
  return res.status(403).json({
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
