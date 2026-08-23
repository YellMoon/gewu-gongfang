const express = require('express');
const { validateEnvelope } = require('../../../shared/authorityProtocol');

function routeError(code, statusCode) {
  return Object.assign(new Error(code), { code, statusCode });
}

function actorFromRequest(req) {
  const source = req.authorityActor || req.authz || {};
  return Object.freeze({
    userId: String(source.userId || source.user_id || source.id || '').trim(),
    deviceId: String(source.deviceId || source.device_id || '').trim(),
    role: String(source.role || source.activeRole || source.active_role || '').trim(),
  });
}

function requireMatchingActor(req, envelope) {
  const actor = actorFromRequest(req);
  if (!actor.userId || !actor.deviceId || !actor.role) {
    throw routeError('AUTHORITY_ACTOR_REQUIRED', 401);
  }
  if (actor.userId !== envelope.actor.userId
    || actor.deviceId !== envelope.actor.deviceId
    || actor.role !== envelope.actor.role) {
    throw routeError('AUTHORITY_ACTOR_MISMATCH', 403);
  }
  return actor;
}

function statusFor(error) {
  if (Number.isSafeInteger(error?.statusCode)) return error.statusCode;
  if (String(error?.code || '').startsWith('AUTHORITY_')) return 400;
  return 500;
}

function sendError(res, error) {
  const code = String(error?.code || 'AUTHORITY_PROTOCOL_FAILED');
  res.status(statusFor(error)).json({ success: false, error: { code } });
}

function createAuthorityProtocolRouter({
  executeCommand,
  findReceipt,
} = {}) {
  if (typeof executeCommand !== 'function') throw routeError('AUTHORITY_COMMAND_EXECUTOR_REQUIRED', 500);
  if (typeof findReceipt !== 'function') throw routeError('AUTHORITY_RECEIPT_STORE_REQUIRED', 500);

  const router = express.Router();

  router.post('/commands', async (req, res) => {
    try {
      const envelope = validateEnvelope(req.body);
      const actor = requireMatchingActor(req, envelope);
      const outcome = await executeCommand({ envelope, actor, request: req });
      if (!outcome?.command || !outcome?.receipt) {
        throw routeError('AUTHORITY_COMMAND_RECEIPT_REQUIRED', 500);
      }
      res.json({ success: true, command: outcome.command, receipt: outcome.receipt });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/commands/:id/receipt', async (req, res) => {
    try {
      const actor = actorFromRequest(req);
      if (!actor.userId || !actor.deviceId || !actor.role) {
        throw routeError('AUTHORITY_ACTOR_REQUIRED', 401);
      }
      const receipt = await findReceipt({ commandId: req.params.id, actor });
      if (!receipt) throw routeError('AUTHORITY_RECEIPT_NOT_FOUND', 404);
      res.json({ success: true, receipt });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}

module.exports = {
  actorFromRequest,
  createAuthorityProtocolRouter,
  requireMatchingActor,
  routeError,
};
