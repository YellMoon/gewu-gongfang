const { Router } = require('express');

const router = Router();
const { effectiveCapabilities } = require('../services/authorizationPolicy');

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
  const identity = {
    id: req.user?.id || req.authz?.userId || null,
    role,
    teacher_id: req.user?.teacher_id || req.authz?.teacherId || null,
    student_id: req.user?.student_id || req.authz?.studentId || null,
    review_status: req.user?.review_status || (req.authz?.userApproved ? 'approved' : 'pending'),
    status: req.user?.status ?? 0,
    login_enabled: req.user?.login_enabled ?? 0,
    authorization_revision: req.user?.updated_at || req.user?.reviewed_at || null,
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
      is_admin: ['super_admin', 'admin'].includes(role),
    },
    permissions, capabilities, identity,
    user_type: role,
    is_admin: ['super_admin', 'admin'].includes(role),
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
