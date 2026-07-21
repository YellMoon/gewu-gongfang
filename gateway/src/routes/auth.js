const express = require('express');
const router = express.Router();
const { refreshToken } = require('../middleware/auth');

router.post('/login', (_req, res) => res.status(410).json({ success: false, code: 'LEGACY_OPENID_LOGIN_DISABLED' }));

router.all('/review-demo', (_req, res) => res.status(410).json({
  success: false,
  code: 'REVIEW_DEMO_REMOVED',
  error: 'Legacy review demo has been removed; use the scheduling backend experience APIs',
}));

router.all('/wechat-login', (_req, res) => res.status(410).json({
  success: false,
  code: 'MINIAPP_AUTH_MOVED_TO_BACKEND',
  error: 'Miniapp authentication is owned by the scheduling backend',
}));

router.post('/register', (_req, res) => {
  return res.status(410).json({
    success: false,
    code: 'MINIAPP_SELF_REGISTER_DISABLED',
    error: 'Miniapp self registration is disabled',
  });
});

router.post('/refresh', (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, error: 'token is required' });
  }

  const newToken = refreshToken(token);
  if (!newToken) {
    return res.status(401).json({ success: false, error: 'token cannot be refreshed' });
  }

  return res.json({ success: true, token: newToken });
});

module.exports = router;
