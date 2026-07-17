const express = require('express');

const router = express.Router();

// Gateway V1 pairing is permanently removed. The only supported desktop
// identity control plane is /scheduling/api/desktop-identity (V2).
router.use((_req, res) => res.status(410).json({
  success: false,
  code: 'DESKTOP_PAIRING_V1_REMOVED',
  error: 'Desktop pairing V1 has been removed; use desktop identity V2.',
}));

module.exports = router;
