/**
 * 权限管理路由
 * GET /api/permissions/definitions — 查询所有权限定义
 * GET /api/permissions/my — 查询当前用户权限
 */
const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { effectiveCapabilities } = require('../services/authorizationPolicy');
const { enforceTenantScope } = require('../middleware/permission');

function normalizedFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return Boolean(value);
}

function parseIds(value) {
  if (Array.isArray(value)) return value.flatMap(parseIds);
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.flatMap(parseIds);
    } catch (_error) { /* retain a non-JSON id below */ }
  }
  if (typeof value === 'string' && value.includes(',')) {
    return value.split(',').flatMap(item => parseIds(item.trim()));
  }
  if (value === undefined || value === null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
}

function tenantScope(req) {
  return String(
    req.user?.tenant_id
    || req.user?.tenantId
    || req.authz?.tenantId
    || req.authz?.tenant_id
    || req.tenantId
    || 'default',
  );
}

function linkedStudentIds(req, role) {
  const explicitIds = [
    req.user?.student_id,
    req.user?.studentId,
    req.user?.linked_student_id,
    req.user?.linkedStudentId,
    req.user?.linked_student_ids,
    req.user?.linkedStudentIds,
    req.authz?.studentId,
    req.authz?.student_id,
    req.authz?.linkedStudentIds,
    req.authz?.linked_student_ids,
  ].flatMap(parseIds);
  return Array.from(new Set(explicitIds)).sort();
}

function subjectScope(role, teacherId, studentIds) {
  if (role === 'super_admin') return 'all';
  if (role === 'teacher' && teacherId) return 'teacher';
  if (role === 'student' && studentIds.length > 0) return 'student';
  return 'none';
}

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
router.get('/my', enforceTenantScope, (req, res) => {
  const role = req.authz?.role || 'pending';
  const capabilities = effectiveCapabilities({ ...req.authz, role });
  const permissions = capabilities.map(id => ({ id, capability: id }));
  const reviewStatus = req.user?.review_status || req.user?.reviewStatus || req.authz?.reviewStatus || req.authz?.review_status || 'pending';
  const status = req.user?.status ?? req.authz?.status ?? 0;
  const loginEnabled = req.user?.login_enabled ?? req.user?.loginEnabled ?? req.authz?.loginEnabled ?? req.authz?.login_enabled ?? 0;
  const deleted = normalizedFlag(req.user?.deleted ?? req.authz?.deleted, false);
  const explicitlyDisabled = normalizedFlag(req.user?.disabled ?? req.authz?.disabled, false);
  const disabled = explicitlyDisabled || deleted || !normalizedFlag(status) || !normalizedFlag(loginEnabled);
  const active = normalizedFlag(req.user?.active ?? req.authz?.active, reviewStatus === 'approved' && !disabled) && !disabled;
  const studentIds = linkedStudentIds(req, role);
  const teacherId = req.user?.teacher_id || req.user?.teacherId || req.authz?.teacherId || req.authz?.teacher_id || null;
  const resolvedSubjectScope = subjectScope(role, teacherId, studentIds);
  const identity = {
    id: req.user?.id || req.authz?.userId || null,
    role,
    tenant_id: tenantScope(req),
    teacher_id: teacherId,
    student_id: req.user?.student_id || req.user?.studentId || req.authz?.studentId || req.authz?.student_id || null,
    linked_student_ids: studentIds,
    subject_scope: resolvedSubjectScope,
    subject_binding: resolvedSubjectScope === 'none' ? 'unbound' : 'bound',
    review_status: reviewStatus,
    status,
    active,
    login_enabled: loginEnabled,
    deleted,
    disabled,
    authorization_revision: req.user?.updated_at || req.user?.reviewed_at || null,
  };
  return res.json({ permissions, capabilities, identity, user_type: role, is_admin: role === 'super_admin' });
  /* legacy grant query retained below for rollback only
  const db = getDb();

  if (['super_admin', 'admin'].includes(req.user.user_type)) {
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

  res.json({ permissions, is_admin: false }); */
});

module.exports = router;
