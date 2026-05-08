/**
 * 权限管理路由
 * GET /api/permissions/definitions — 查询所有权限定义
 * GET /api/permissions/my — 查询当前用户权限
 */
const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

/**
 * GET /api/permissions/definitions
 * 查询所有权限定义 (按模块分组)
 */
router.get('/definitions', (req, res) => {
  const db = getDb();

  const permissions = db.prepare(`
    SELECT p.id, p.module_id, p.sub_module, p.action, p.description,
           p.allowed_types, p.is_default, m.name as module_name
    FROM permissions p
    JOIN modules m ON p.module_id = m.id
    WHERE m.status = 1
    ORDER BY m.sort_order, p.module_id, p.sub_module, p.action
  `).all();

  // 按模块分组
  const grouped = {};
  for (const perm of permissions) {
    if (!grouped[perm.module_id]) {
      grouped[perm.module_id] = {
        name: perm.module_name,
        permissions: []
      };
    }
    grouped[perm.module_id].permissions.push(perm);
  }

  res.json({ definitions: grouped });
});

/**
 * GET /api/permissions/my
 * 查询当前用户权限
 */
router.get('/my', (req, res) => {
  const db = getDb();

  if (req.user.user_type === 'admin') {
    // 管理员拥有所有权限
    const allPerms = db.prepare(`
      SELECT p.id, p.module_id, p.sub_module, p.action, p.description
      FROM permissions p
      JOIN modules m ON p.module_id = m.id
      WHERE m.status = 1
    `).all();
    return res.json({ permissions: allPerms, is_admin: true });
  }

  const permissions = db.prepare(`
    SELECT p.id, p.module_id, p.sub_module, p.action, p.description,
           up.granted_at, up.expires_at
    FROM user_permissions up
    JOIN permissions p ON up.permission_id = p.id
    WHERE up.user_id = ? AND up.status = 1
      AND (up.expires_at IS NULL OR up.expires_at > datetime('now'))
  `).all(req.user.id);

  res.json({ permissions, is_admin: false });
});

module.exports = router;
