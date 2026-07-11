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
  const permissions = role === 'pending' ? [] : role === 'student'
    ? studentModuleIds.map(id => permission(id, 'view'))
    : moduleIds.flatMap(id => actions.map(action => permission(id, action)));

  res.json({
    success: true,
    data: {
      permissions, capabilities,
      user_type: role,
      is_admin: ['super_admin', 'admin'].includes(role),
    },
    permissions, capabilities,
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
