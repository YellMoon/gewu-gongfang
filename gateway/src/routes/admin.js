/**
 * 管理员路由
 * GET  /api/admin/users — 用户列表
 * PUT  /api/admin/users/:id/type — 设置用户类型
 * GET  /api/admin/users/:id/permissions — 查询用户权限
 * POST /api/admin/users/:id/permissions — 授予权限
 * DELETE /api/admin/users/:id/permissions/:pid — 撤销权限
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { requireType } = require('../middleware/permission');

// 所有管理员路由需要 admin 类型
router.use(requireType(['admin']));

/**
 * GET /api/admin/users
 * 用户列表 (支持分页和搜索)
 */
router.get('/users', (req, res) => {
  const db = getDb();
  const { page = 1, limit = 20, search, user_type } = req.query;
  const offset = (page - 1) * limit;

  let where = '1=1';
  const params = [];

  if (search) {
    where += ' AND (name LIKE ? OR phone LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (user_type) {
    where += ' AND user_type = ?';
    params.push(user_type);
  }

  const total = db.prepare(`SELECT COUNT(*) as count FROM users WHERE ${where}`).get(...params).count;
  const users = db.prepare(`
    SELECT id, openid, phone, name, avatar, user_type, status, invited_by, created_at
    FROM users WHERE ${where}
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, Number(limit), offset);

  res.json({ users, total, page: Number(page), limit: Number(limit) });
});

/**
 * PUT /api/admin/users/:id/type
 * 设置用户类型
 * Body: { user_type: 'teacher' | 'student' | 'invited' | 'admin' }
 */
router.put('/users/:id/type', (req, res) => {
  const { id } = req.params;
  const { user_type } = req.body;

  const validTypes = ['admin', 'teacher', 'student', 'invited'];
  if (!validTypes.includes(user_type)) {
    return res.status(400).json({ error: `无效的用户类型，允许: ${validTypes.join(', ')}` });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }

  db.prepare('UPDATE users SET user_type = ?, updated_at = ? WHERE id = ?')
    .run(user_type, new Date().toISOString(), id);

  console.log(`[Admin] 用户类型变更: ${user.name} → ${user_type}`);
  res.json({ ok: true, user_type });
});

/**
 * GET /api/admin/users/:id/permissions
 * 查询用户权限
 */
router.get('/users/:id/permissions', (req, res) => {
  const { id } = req.params;
  const db = getDb();

  const permissions = db.prepare(`
    SELECT p.id, p.module_id, p.sub_module, p.action, p.description,
           up.granted_at, up.expires_at, up.status
    FROM user_permissions up
    JOIN permissions p ON up.permission_id = p.id
    WHERE up.user_id = ?
    ORDER BY p.module_id, p.sub_module, p.action
  `).all(id);

  res.json({ permissions });
});

/**
 * POST /api/admin/users/:id/permissions
 * 授予权限
 * Body: { permission_id, expires_at? }
 */
router.post('/users/:id/permissions', (req, res) => {
  const { id } = req.params;
  const { permission_id, expires_at } = req.body;

  const db = getDb();

  // 检查用户存在
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }

  // 检查权限存在
  const perm = db.prepare('SELECT * FROM permissions WHERE id = ?').get(permission_id);
  if (!perm) {
    return res.status(404).json({ error: '权限不存在' });
  }

  // 检查用户类型是否在允许列表中
  const allowedTypes = JSON.parse(perm.allowed_types || '["admin"]');
  if (!allowedTypes.includes(user.user_type)) {
    return res.status(400).json({
      error: `用户类型 '${user.user_type}' 不在该权限的允许列表中`,
      allowed_types: allowedTypes
    });
  }

  // 检查是否已有该权限
  const existing = db.prepare(
    'SELECT * FROM user_permissions WHERE user_id = ? AND permission_id = ? AND status = 1'
  ).get(id, permission_id);

  if (existing) {
    return res.status(400).json({ error: '用户已有该权限' });
  }

  // 授予权限
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_permissions (id, user_id, permission_id, granted_by, granted_at, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(uuidv4(), id, permission_id, req.user.id, now, expires_at || null);

  console.log(`[Admin] 权限授予: ${user.name} ← ${permission_id}`);
  res.json({ ok: true });
});

/**
 * DELETE /api/admin/users/:id/permissions/:pid
 * 撤销权限
 */
router.delete('/users/:id/permissions/:pid', (req, res) => {
  const { id, pid } = req.params;
  const db = getDb();

  const result = db.prepare(
    'UPDATE user_permissions SET status = 0 WHERE user_id = ? AND permission_id = ? AND status = 1'
  ).run(id, pid);

  if (result.changes === 0) {
    return res.status(404).json({ error: '未找到该权限记录' });
  }

  console.log(`[Admin] 权限撤销: ${id} ← ${pid}`);
  res.json({ ok: true });
});

module.exports = router;
