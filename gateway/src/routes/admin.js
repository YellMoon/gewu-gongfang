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

router.all('/users/:id/type', (_req, res) => res.status(410).json({ success: false, code: 'LEGACY_ROLE_ENDPOINT_DISABLED' }));
router.all('/users/:id/permissions', (_req, res) => res.status(410).json({ success: false, code: 'LEGACY_PERMISSION_ENDPOINT_DISABLED' }));
router.all('/users/:id/permissions/:permissionId', (_req, res) => res.status(410).json({ success: false, code: 'LEGACY_PERMISSION_ENDPOINT_DISABLED' }));

module.exports = router;
