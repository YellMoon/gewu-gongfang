/**
 * 权限校验中间件
 * 支持模块级 + 子模块级 + 操作级权限
 * 管理员 (user_type='admin') 跳过所有检查
 */
const { getDb } = require('../db/database');

/**
 * 检查用户是否有指定模块的操作权限
 * @param {string} module - 模块 ID (如 'scheduling', 'question-bank')
 * @param {string} action - 操作 (如 'view', 'edit', 'delete', 'admin')
 */
function requirePermission(module, action) {
  return (req, res, next) => {
    // 管理员跳过所有权限检查
    if (req.user && req.user.user_type === 'admin') {
      return next();
    }

    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: '未认证' });
    }

    const db = getDb();

    // 检查用户是否有该模块的指定权限
    const perm = db.prepare(`
      SELECT p.id, p.allowed_types
      FROM user_permissions up
      JOIN permissions p ON up.permission_id = p.id
      WHERE up.user_id = ?
        AND p.module_id = ?
        AND p.action = ?
        AND up.status = 1
        AND (up.expires_at IS NULL OR up.expires_at > datetime('now'))
    `).get(req.user.id, module, action);

    if (perm) {
      // 有显式权限，检查用户类型是否在允许列表中
      const allowedTypes = JSON.parse(perm.allowed_types || '["admin"]');
      if (allowedTypes.includes(req.user.user_type)) {
        return next();
      }
    }

    // 没有显式权限，检查模块的默认类型权限
    const defaultPerm = db.prepare(`
      SELECT allowed_types FROM permissions
      WHERE module_id = ? AND action = ? AND is_default = 1
    `).get(module, action);

    if (defaultPerm) {
      const allowedTypes = JSON.parse(defaultPerm.allowed_types || '[]');
      if (allowedTypes.includes(req.user.user_type)) {
        return next();
      }
    }

    return res.status(403).json({
      error: '无权限',
      module,
      action,
      user_type: req.user.user_type
    });
  };
}

/**
 * 检查用户类型是否在允许列表中
 * @param {string[]} types - 允许的用户类型
 */
function requireType(types) {
  return (req, res, next) => {
    if (req.user && req.user.user_type === 'admin') {
      return next();
    }

    if (!req.user || !types.includes(req.user.user_type)) {
      return res.status(403).json({
        error: '用户类型无权访问',
        required: types,
        current: req.user ? req.user.user_type : 'unknown'
      });
    }

    next();
  };
}

module.exports = { requirePermission, requireType };

/**
 * 加载用户权限到 req.userPerms
 * 在需要检查具体权限的路由前使用
 */
function loadUserPermissions(req, res, next) {
  if (!req.user || !req.user.id) {
    req.userPerms = [];
    return next();
  }

  // 管理员拥有全部权限
  if (req.user.user_type === 'admin') {
    req.userPerms = ['*'];
    return next();
  }

  const db = getDb();
  const perms = db.prepare(`
    SELECT p.id FROM user_permissions up
    JOIN permissions p ON up.permission_id = p.id
    WHERE up.user_id = ? AND up.status = 1
      AND (up.expires_at IS NULL OR up.expires_at > datetime('now'))
  `).all(req.user.id);

  req.userPerms = perms.map(p => p.id);
  next();
}

module.exports = { requirePermission, requireType, loadUserPermissions };
