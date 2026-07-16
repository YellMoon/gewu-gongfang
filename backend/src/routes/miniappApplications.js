const { Router } = require('express');
const { getInstance } = require('../database');
const { sendError } = require('../middleware/errorHandler');
const { canReviewApplications } = require('../services/authorizationPolicy');
const {
  FORMAL_TOKEN_USE,
  UNRECOGNIZED_TOKEN_USE,
} = require('../services/miniappIdentityService');
const { createMiniappApplicationService } = require('../services/miniappApplicationService');
const { createMiniappApplicationReviewService } = require('../services/miniappApplicationReviewService');
const { createMiniappProvisioningReconciler } = require('../services/miniappProvisioningReconciler');

const router = Router();
let cachedApplicationDb = null;
let cachedReviewDb = null;
let cachedReconcilerDb = null;
let cachedService = null;
let cachedReviewService = null;
let cachedReconciler = null;

function applicationService() {
  const db = getInstance().db;
  if (!cachedService || cachedApplicationDb !== db) {
    cachedApplicationDb = db;
    cachedService = createMiniappApplicationService({ db });
  }
  return cachedService;
}

function applicationReviewService() {
  const db = getInstance().db;
  if (!cachedReviewService || cachedReviewDb !== db) {
    cachedReviewDb = db;
    cachedReviewService = createMiniappApplicationReviewService({ db });
  }
  return cachedReviewService;
}

function provisioningReconciler() {
  const db = getInstance().db;
  if (!cachedReconciler || cachedReconcilerDb !== db) {
    cachedReconcilerDb = db;
    cachedReconciler = createMiniappProvisioningReconciler({ db });
  }
  return cachedReconciler;
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
  return sendError(res, Number(error?.statusCode) || statusForError(code), code, {
    code,
    details: error?.details,
  });
}

function requireReviewSession(req, res, next) {
  if (canReviewApplications(req.user)) return next();
  return sendError(res, 403, 'APPLICATION_REVIEW_FORBIDDEN', {
    code: 'APPLICATION_REVIEW_FORBIDDEN',
  });
}

router.get('/admin', requireReviewSession, (req, res) => {
  try {
    provisioningReconciler().reconcilePendingCompletedTasks();
    const result = applicationReviewService().list({
      actor: req.user,
      status: req.query.status,
      limit: req.query.limit,
    });
    return res.json({ success: true, data: result, ...result });
  } catch (error) {
    return sendApplicationError(res, error);
  }
});

router.post('/:id/approve', requireReviewSession, (req, res) => {
  try {
    const result = applicationReviewService().approve({
      actor: req.user,
      applicationId: req.params.id,
      expectedRevision: req.body?.expectedRevision ?? req.body?.revision,
      tenantId: req.tenantId,
    });
    return res.json({ success: true, data: result, ...result });
  } catch (error) {
    return sendApplicationError(res, error);
  }
});

router.post('/:id/reject', requireReviewSession, (req, res) => {
  try {
    const result = applicationReviewService().reject({
      actor: req.user,
      applicationId: req.params.id,
      expectedRevision: req.body?.expectedRevision ?? req.body?.revision,
      reason: req.body?.reason ?? req.body?.rejectionReason,
    });
    return res.json({ success: true, data: result, ...result });
  } catch (error) {
    return sendApplicationError(res, error);
  }
});

router.post('/:id/retry', requireReviewSession, (req, res) => {
  try {
    const result = applicationReviewService().retry({
      actor: req.user,
      applicationId: req.params.id,
      expectedRevision: req.body?.expectedRevision ?? req.body?.revision,
    });
    return res.json({ success: true, data: result, ...result });
  } catch (error) {
    return sendApplicationError(res, error);
  }
});

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
