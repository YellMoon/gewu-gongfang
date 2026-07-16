const { Router } = require('express');
const { getInstance } = require('../database');
const { sendError } = require('../middleware/errorHandler');
const {
  FORMAL_TOKEN_USE,
  UNRECOGNIZED_TOKEN_USE,
} = require('../services/miniappIdentityService');
const { createMiniappApplicationService } = require('../services/miniappApplicationService');

const router = Router();
let cachedDb = null;
let cachedService = null;

function applicationService() {
  const db = getInstance().db;
  if (!cachedService || cachedDb !== db) {
    cachedDb = db;
    cachedService = createMiniappApplicationService({ db });
  }
  return cachedService;
}

function statusForError(code) {
  if (code === 'APPLICATION_NOT_FOUND') return 404;
  if ([
    'ACTIVE_APPLICATION_EXISTS',
    'IDEMPOTENCY_KEY_REUSED',
    'APPLICATION_WITHDRAW_NOT_ALLOWED',
    'PHONE_ALREADY_RECOGNIZED',
  ].includes(code)) return 409;
  if ([
    'APPLICATION_SESSION_FORBIDDEN',
    'APPLICATION_APPLICANT_NOT_AVAILABLE',
    'APPLICATION_VERIFIED_PHONE_MISMATCH',
    'APPLICATION_NOT_AVAILABLE_FOR_FORMAL_ACCOUNT',
  ].includes(code)) return 403;
  return 400;
}

function sendApplicationError(res, error) {
  const code = error?.code || 'APPLICATION_REQUEST_FAILED';
  return sendError(res, statusForError(code), code, {
    code,
    details: error?.details,
  });
}

function requireApplicationSession(req, res, next) {
  if (req.authz?.tokenUse === UNRECOGNIZED_TOKEN_USE) return next();
  if (req.authz?.tokenUse === FORMAL_TOKEN_USE) {
    const mine = applicationService().getMine(req.user.id);
    if (mine.state === 'approved_relogin_required') return next();
  }
  return sendError(res, 403, 'APPLICATION_SESSION_FORBIDDEN', {
    code: 'APPLICATION_SESSION_FORBIDDEN',
  });
}

router.use(requireApplicationSession);

router.get('/me', (req, res) => {
  try {
    const result = applicationService().getMine(req.user.id);
    return res.json({ success: true, data: result, ...result });
  } catch (error) {
    return sendApplicationError(res, error);
  }
});

router.post('/', (req, res) => {
  try {
    const result = applicationService().submit({
      applicantUserId: req.user.id,
      verifiedPhone: req.user.phone_normalized || req.user.phone,
      applicationType: req.body?.applicationType,
      payload: req.body?.payload,
      idempotencyKey: req.get('x-idempotency-key'),
    });
    return res.status(result.created ? 201 : 200).json({ success: true, data: result, ...result });
  } catch (error) {
    return sendApplicationError(res, error);
  }
});

router.post('/:id/withdraw', (req, res) => {
  try {
    const result = applicationService().withdraw({
      applicantUserId: req.user.id,
      applicationId: req.params.id,
    });
    return res.json({ success: true, data: result, ...result });
  } catch (error) {
    return sendApplicationError(res, error);
  }
});

module.exports = router;
