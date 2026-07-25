'use strict';

const { Router } = require('express');
const { getInstance } = require('../database');
const {
  canReviewApplications,
  canReviewUsers,
} = require('../services/authorizationPolicy');
const { createMiniappWechatBindingService } = require('../services/miniappWechatBindingService');

const router = Router();
let cachedDb = null;
let cachedService = null;

function bindingService() {
  const db = getInstance().db;
  if (!cachedService || cachedDb !== db) {
    cachedDb = db;
    cachedService = createMiniappWechatBindingService({ db });
  }
  return cachedService;
}

function sendBindingError(res, error) {
  const code = error?.code || 'WECHAT_BINDING_REQUEST_FAILED';
  const status = Number(error?.statusCode) || 400;
  return res.status(status).json({
    success: false,
    code,
    error: code,
    details: error?.details,
  });
}

function requireApplicationReviewer(req, res, next) {
  if (canReviewApplications(req.user)) return next();
  return res.status(403).json({
    success: false,
    code: 'WECHAT_BINDING_LIST_FORBIDDEN',
    error: 'WeChat binding review list is forbidden',
  });
}

function requireSuperAdmin(req, res, next) {
  if (canReviewUsers(req.user) && req.authz?.role === 'super_admin') return next();
  return res.status(403).json({
    success: false,
    code: 'WECHAT_BINDING_REVIEW_FORBIDDEN',
    error: 'Super administrator review is required',
  });
}

router.get('/admin', requireApplicationReviewer, (req, res) => {
  try {
    const result = bindingService().list({
      status: req.query.status,
      limit: req.query.limit,
    });
    return res.json({ success: true, data: result, ...result });
  } catch (error) {
    return sendBindingError(res, error);
  }
});

router.post('/:id/approve', requireSuperAdmin, (req, res) => {
  try {
    const request = bindingService().approve({
      actor: req.user,
      requestId: req.params.id,
      expectedRevision: req.body?.expectedRevision ?? req.body?.revision,
    });
    return res.json({ success: true, data: { request }, request });
  } catch (error) {
    return sendBindingError(res, error);
  }
});

router.post('/:id/reject', requireSuperAdmin, (req, res) => {
  try {
    const request = bindingService().reject({
      actor: req.user,
      requestId: req.params.id,
      expectedRevision: req.body?.expectedRevision ?? req.body?.revision,
      reason: req.body?.reason ?? req.body?.reviewNote,
    });
    return res.json({ success: true, data: { request }, request });
  } catch (error) {
    return sendBindingError(res, error);
  }
});

module.exports = router;
