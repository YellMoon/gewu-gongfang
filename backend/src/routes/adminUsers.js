const { Router } = require('express');
const { getInstance } = require('../database');
const { canReviewUsers } = require('../services/authorizationPolicy');

const router = Router();

router.get('/', (req, res) => {
  if (!['super_admin', 'admin'].includes(req.authz?.role)) {
    return res.status(403).json({ success: false, code: 'ADMIN_USERS_READ_REQUIRED' });
  }
  try {
    const result = getInstance().listAuthorizationUsers(req.query || {});
    return res.json({ success: true, ...result, users: result.items, data: result });
  } catch (error) {
    return res.status(400).json({ success: false, code: error.code || 'INVALID_USER_LIST_QUERY' });
  }
});

router.patch('/:id/review', (req, res) => {
  if (!canReviewUsers(req.user) || req.authz?.role !== 'super_admin') {
    return res.status(403).json({ success: false, code: 'SUPER_ADMIN_REQUIRED', message: 'Super administrator approval is required' });
  }
  try {
    const user = getInstance().reviewUser({ actorPhone: req.authz.phone, userId: req.params.id, role: req.body?.role });
    return res.json({ success: true, user, data: { user } });
  } catch (error) {
    const status = error.code === 'AUTHORIZATION_USER_NOT_FOUND' ? 404
      : error.code === 'SUPER_ADMIN_REQUIRED' ? 403 : 400;
    return res.status(status).json({ success: false, code: error.code || 'REVIEW_FAILED', message: error.message });
  }
});

module.exports = router;
