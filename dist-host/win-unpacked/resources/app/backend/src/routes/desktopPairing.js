const { Router } = require('express');

const router = Router();

// V1 pairing is permanently removed on both the local Backend and Gateway.
// Desktop registration and review are handled only by /api/desktop-identity.
router.use((_req, res) => res.status(410).json({
  success: false,
  code: 'DESKTOP_PAIRING_V1_REMOVED',
  error: 'Desktop pairing V1 has been removed; use desktop identity V2.',
}));

module.exports = router;
