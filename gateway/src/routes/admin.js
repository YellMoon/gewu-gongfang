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
const { canReviewUsers } = require('../services/authorizationPolicy');

// 所有管理员路由需要 admin 类型
router.use((req, res, next) => {
  if (req.method === 'PUT' && /^\/users\/[^/]+\/type$/.test(req.path)) {
    return res.status(410).json({ success: false, code: 'LEGACY_ROLE_ENDPOINT_DISABLED', replacement: 'PATCH /api/admin/users/:id/review' });
  }
  if (['POST', 'DELETE'].includes(req.method) && /^\/users\/[^/]+\/permissions(?:\/[^/]+)?$/.test(req.path)) {
    return res.status(410).json({ success: false, code: 'LEGACY_PERMISSION_GRANTS_DISABLED' });
  }
  return next();
});
router.use(requireType(['admin']));

/**
 * GET /api/admin/users
 * 用户列表 (支持分页和搜索)
 */
router.get('/users', (req, res) => {
  const db = getDb();
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize || req.query.limit, 10) || 20));
  const { user_type } = req.query;
  const search = String(req.query.search || '').trim().slice(0, 100);
  const offset = (page - 1) * pageSize;

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
    SELECT id, phone, name, avatar, user_type, status, login_enabled, review_status,
           teacher_id, student_id, reviewed_by, reviewed_at, created_at, updated_at
    FROM users WHERE ${where}
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  res.json({ items: users, users, total, page, pageSize });
});

router.patch('/users/:id/review', (req, res) => {
  if (!canReviewUsers(req.user) || req.authz?.role !== 'super_admin') {
    return res.status(403).json({ success: false, code: 'SUPER_ADMIN_REQUIRED' });
  }
  const role = req.body?.role;
  if (!['admin', 'teacher', 'student'].includes(role)) {
    return res.status(400).json({ success: false, code: 'INVALID_AUTHORIZATION_ROLE' });
  }
  const db = getDb();
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ success: false, code: 'AUTHORIZATION_USER_NOT_FOUND' });
  if (target.is_super_admin_identity === 1 || String(target.phone || '').replace(/\D/g, '') === '13732250653') {
    return res.status(400).json({ success: false, code: 'SUPER_ADMIN_IMMUTABLE' });
  }
  let teacherId = null;
  if (role === 'teacher') {
    const teacherTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'teachers'").get();
    if (!teacherTable) return res.status(400).json({ success: false, code: 'TEACHER_NOT_FOUND' });
    const normalized = String(target.phone || '').replace(/\D/g, '');
    const matches = db.prepare('SELECT id, phone FROM teachers').all()
      .filter(item => String(item.phone || '').replace(/\D/g, '') === normalized);
    if (matches.length !== 1) return res.status(400).json({ success: false, code: matches.length ? 'TEACHER_PHONE_NOT_UNIQUE' : 'TEACHER_NOT_FOUND' });
    teacherId = matches[0].id;
  }
  const now = new Date().toISOString();
  const user = db.transaction(() => {
    db.prepare(`UPDATE users SET user_type = ?, teacher_id = ?, review_status = 'approved', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`)
      .run(role, teacherId, req.user.id, now, now, target.id);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
    db.prepare(`INSERT INTO authorization_audit_log
      (id, actor_user_id, target_user_id, action, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), req.user.id, target.id, 'review_user', JSON.stringify(target), JSON.stringify(updated), now);
    return updated;
  })();
  return res.json({ success: true, user });
});

/**
 * PUT /api/admin/users/:id/type
 * 设置用户类型
 * Body: { user_type: 'teacher' | 'student' | 'invited' | 'admin' }
 */
router.put('/users/:id/type', (req, res) => {
  return res.status(410).json({ success: false, code: 'LEGACY_ROLE_ENDPOINT_DISABLED', replacement: 'PATCH /api/admin/users/:id/review' });
  /* legacy implementation retained for rollback only
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
  res.json({ ok: true, user_type }); */
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
  return res.status(410).json({ success: false, code: 'LEGACY_PERMISSION_GRANTS_DISABLED' });
  /* legacy implementation retained for rollback only
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
  res.json({ ok: true }); */
});

/**
 * DELETE /api/admin/users/:id/permissions/:pid
 * 撤销权限
 */
router.delete('/users/:id/permissions/:pid', (req, res) => {
  return res.status(410).json({ success: false, code: 'LEGACY_PERMISSION_GRANTS_DISABLED' });
  /* legacy implementation retained for rollback only
  const { id, pid } = req.params;
  const db = getDb();

  const result = db.prepare(
    'UPDATE user_permissions SET status = 0 WHERE user_id = ? AND permission_id = ? AND status = 1'
  ).run(id, pid);

  if (result.changes === 0) {
    return res.status(404).json({ error: '未找到该权限记录' });
  }

  console.log(`[Admin] 权限撤销: ${id} ← ${pid}`);
  res.json({ ok: true }); */
});

module.exports = router;
