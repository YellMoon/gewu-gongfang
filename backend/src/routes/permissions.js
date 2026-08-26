const { Router } = require('express');

const router = Router();
const { effectiveCapabilities, scopeForUser } = require('../services/authorizationPolicy');

const moduleIds = [
  'scheduling',
  'question-bank',
  'assets',
  'students',
  'courses',
  'teachers',
  'payments',
  'stats',
  'admin',
];

const studentModuleIds = ['scheduling', 'question-bank'];
const actions = ['view', 'edit', 'delete', 'export', 'admin'];

function roleOf(user = {}) {
  return user.user_type || user.role || 'guest';
}

function permission(id, action) {
  return {
    id: `${id}:${action}`,
    module_id: id,
    action,
    description: `${id} ${action}`,
    status: 1,
  };
}

router.get('/my', (req, res) => {
  const role = req.authz?.role || roleOf(req.user);
  const capabilities = effectiveCapabilities({ ...req.authz, role });
  const subjectScope = scopeForUser({ ...req.authz, role });
  const eligibleRoles = Array.isArray(req.authz?.eligibleRoles)
    ? req.authz.eligibleRoles.slice()
    : [role];
  const identity = {
    id: req.user?.id || req.authz?.userId || null,
    role,
    active_role: role,
    eligible_roles: eligibleRoles,
    teacher_id: role === 'teacher' ? req.authz?.teacherId || null : null,
    student_id: role === 'student' ? req.authz?.studentId || null : null,
    review_status: req.user?.review_status || (req.authz?.userApproved ? 'approved' : 'pending'),
    status: req.user?.status ?? 0,
    login_enabled: req.user?.login_enabled ?? 0,
    authorization_revision: req.user?.updated_at || req.user?.reviewed_at || null,
    subject_scope: subjectScope.kind,
    subject_binding: ['teacher', 'student'].includes(role)
      ? (subjectScope.kind === 'none' ? 'unbound' : 'bound')
      : 'not-applicable',
  };
  const permissions = capabilities.map(id => {
    const separator = id.indexOf(':');
    return permission(id.slice(0, separator), id.slice(separator + 1));
  });

  res.json({
    success: true,
    data: {
      permissions, capabilities, identity,
      user_type: role,
      active_role: role,
      eligible_roles: eligibleRoles,
      is_admin: role === 'super_admin',
    },
    permissions, capabilities, identity,
    user_type: role,
    active_role: role,
    eligible_roles: eligibleRoles,
    is_admin: role === 'super_admin',
  });
});

router.get('/definitions', (_req, res) => {
  const definitions = Object.fromEntries(moduleIds.map(id => [
    id,
    {
      name: id,
      permissions: actions.map(action => permission(id, action)),
    },
  ]));
  res.json({ success: true, data: { definitions }, definitions });
});

module.exports = router;
