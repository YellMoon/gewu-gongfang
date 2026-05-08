/**
 * 认证路由
 * POST /api/auth/login — 微信登录
 * POST /api/auth/register — 注册 (含邀请码)
 * POST /api/auth/refresh — Token 刷新
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { generateToken, refreshToken } = require('../middleware/auth');

/**
 * POST /api/auth/login
 * 微信小程序登录
 * Body: { openid, name?, avatar? }
 */
router.post('/login', (req, res) => {
  const { openid, name, avatar } = req.body;

  if (!openid) {
    return res.status(400).json({ error: 'openid 不能为空' });
  }

  const db = getDb();
  let user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);

  if (!user) {
    // 自动注册
    const id = uuidv4();
    const now = new Date().toISOString();
    const userName = name || '微信用户';

    db.prepare(`
      INSERT INTO users (id, openid, name, avatar, user_type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'student', 1, ?, ?)
    `).run(id, openid, userName, avatar || null, now, now);

    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    console.log(`[Auth] 新用户注册: ${userName} (${id})`);

    // 学生自动授予默认权限
    const defaultPerms = db.prepare(
      "SELECT id FROM permissions WHERE is_default = 1"
    ).all();
    for (const perm of defaultPerms) {
      db.prepare(`
        INSERT OR IGNORE INTO user_permissions (id, user_id, permission_id, granted_by, granted_at, status)
        VALUES (?, ?, ?, 'system', ?, 1)
      `).run(uuidv4(), id, perm.id, now);
    }
    if (defaultPerms.length > 0) {
      console.log(`[Auth] 已为新学生授予 ${defaultPerms.length} 个默认权限`);
    }
  }

  if (user.status === 0) {
    return res.status(403).json({ error: '账号已被禁用' });
  }

  const token = generateToken(user);

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      user_type: user.user_type
    }
  });
});

/**
 * POST /api/auth/register
 * 邀请码注册
 * Body: { openid, invite_code, name?, avatar? }
 */
router.post('/register', (req, res) => {
  const { openid, invite_code, name, avatar } = req.body;

  if (!openid || !invite_code) {
    return res.status(400).json({ error: 'openid 和邀请码不能为空' });
  }

  const db = getDb();

  // 查找邀请码
  const invitation = db.prepare(`
    SELECT * FROM invitations WHERE code = ? AND status = 0
  `).get(invite_code);

  if (!invitation) {
    return res.status(400).json({ error: '邀请码无效或已使用' });
  }

  // 检查是否过期
  if (new Date(invitation.expires_at) < new Date()) {
    db.prepare('UPDATE invitations SET status = 2 WHERE id = ?').run(invitation.id);
    return res.status(400).json({ error: '邀请码已过期' });
  }

  // 检查 openid 是否已注册
  const existingUser = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
  if (existingUser) {
    return res.status(400).json({ error: '该微信账号已注册' });
  }

  // 创建用户
  const userId = uuidv4();
  const now = new Date().toISOString();
  const userName = name || invitation.target_name || '被邀请用户';

  db.prepare(`
    INSERT INTO users (id, openid, name, avatar, user_type, status, invited_by, invite_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'invited', 1, ?, ?, ?, ?)
  `).run(userId, openid, userName, avatar || null, invitation.invited_by, invitation.code, now, now);

  // 分配预设权限
  const perms = JSON.parse(invitation.permissions || '[]');
  for (const permId of perms) {
    db.prepare(`
      INSERT OR IGNORE INTO user_permissions (id, user_id, permission_id, granted_by, granted_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(uuidv4(), userId, permId, invitation.invited_by, now);
  }

  // 标记邀请码已使用
  db.prepare(`
    UPDATE invitations SET status = 1, used_by = ?, used_at = ? WHERE id = ?
  `).run(userId, now, invitation.id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const token = generateToken(user);

  console.log(`[Auth] 被邀请者注册: ${userName} (${userId}) via ${invitation.code}`);

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      user_type: user.user_type
    }
  });
});

/**
 * POST /api/auth/refresh
 * Token 刷新
 * Body: { token }
 */
router.post('/refresh', (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'token 不能为空' });
  }

  const newToken = refreshToken(token);
  if (!newToken) {
    return res.status(401).json({ error: '无法刷新 token' });
  }

  res.json({ token: newToken });
});

module.exports = router;
