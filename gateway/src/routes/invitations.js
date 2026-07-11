const express = require('express');
const router = express.Router();

router.use((_req, res) => res.status(410).json({
  success: false,
  code: 'LEGACY_INVITATION_ENDPOINTS_DISABLED',
}));

module.exports = router;
