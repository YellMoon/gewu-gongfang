/**
 * 邀请码路由
 * POST /api/invitations/create — 创建邀请码 (管理员)
 * GET  /api/invitations/list — 查询邀请码列表 (管理员)
 * DELETE /api/invitations/:id — 撤销邀请码 (管理员)
 * POST /api/invitations/use — 使用邀请码 (公开)
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { requireType } = require('../middleware/permission');

/**
 * 生成随机邀请码
 */
function generateCode(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆字符
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * POST /api/invitations/create
 * 创建邀请码
 * Body: { target_name?, target_phone?, permissions?: string[], expires_in_days?: number }
 */
router.post('/create', requireType(['admin']), (req, res) => {
  const { target_name, target_phone, permissions = [], expires_in_days = 30 } = req.body;

  const db = getDb();
  const id = uuidv4();
  const code = generateCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expires_in_days * 24 * 60 * 60 * 1000);

  db.prepare(`
    INSERT INTO invitations (id, code, invited_by, target_name, target_phone, permissions, status, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(id, code, req.user.id, target_name || null, target_phone || null,
    JSON.stringify(permissions), expiresAt.toISOString(), now.toISOString());

  console.log(`[Invitation] 创建邀请码: ${code} → ${target_name || '未指定'}`);

  res.json({
    id,
    code,
    target_name,
    permissions,
    expires_at: expiresAt.toISOString()
  });
});

/**
 * GET /api/invitations/list
 * 查询邀请码列表
 */
router.get('/list', requireType(['admin']), (req, res) => {
  const db = getDb();
  const { status } = req.query;

  let where = '1=1';
  const params = [];
  if (status !== undefined) {
    where += ' AND i.status = ?';
    params.push(Number(status));
  }

  const invitations = db.prepare(`
    SELECT i.*, u.name as invited_by_name
    FROM invitations i
    LEFT JOIN users u ON i.invited_by = u.id
    WHERE ${where}
    ORDER BY i.created_at DESC
  `).all(...params);

  res.json({ invitations });
});

/**
 * DELETE /api/invitations/:id
 * 撤销邀请码 (仅待使用状态可撤销)
 */
router.delete('/:id', requireType(['admin']), (req, res) => {
  const { id } = req.params;
  const db = getDb();

  const invitation = db.prepare('SELECT * FROM invitations WHERE id = ?').get(id);
  if (!invitation) {
    return res.status(404).json({ error: '邀请码不存在' });
  }

  if (invitation.status !== 0) {
    return res.status(400).json({ error: '只能撤销未使用的邀请码' });
  }

  db.prepare('UPDATE invitations SET status = 2 WHERE id = ?').run(id);
  console.log(`[Invitation] 撤销邀请码: ${invitation.code}`);

  res.json({ ok: true });
});

/**
 * POST /api/invitations/use
 * 使用邀请码 (公开接口，已在 app.js 中单独挂载)
 * Body: { code }
 */
router.post('/use', (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: '邀请码不能为空' });
  }

  const db = getDb();
  const invitation = db.prepare(`
    SELECT * FROM invitations WHERE code = ? AND status = 0
  `).get(code);

  if (!invitation) {
    return res.status(400).json({ error: '邀请码无效或已使用' });
  }

  // 检查是否过期
  if (new Date(invitation.expires_at) < new Date()) {
    db.prepare('UPDATE invitations SET status = 2 WHERE id = ?').run(invitation.id);
    return res.status(400).json({ error: '邀请码已过期' });
  }

  res.json({
    valid: true,
    target_name: invitation.target_name,
    permissions: JSON.parse(invitation.permissions || '[]'),
    expires_at: invitation.expires_at
  });
});

module.exports = router;
