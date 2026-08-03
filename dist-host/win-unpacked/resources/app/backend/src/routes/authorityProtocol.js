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
  authorizeCommand,
  enqueueCommand,
  findReceipt,
  authorizeHostRequest,
  claimCommands,
  renewCommandClaim,
  publishHostReceipt,
  onCommandQueued,
} = {}) {
  if (typeof authorizeCommand !== 'function') throw routeError('AUTHORITY_COMMAND_AUTHORIZER_REQUIRED', 500);
  if (typeof enqueueCommand !== 'function') throw routeError('AUTHORITY_COMMAND_INBOX_REQUIRED', 500);
  if (typeof findReceipt !== 'function') throw routeError('AUTHORITY_RECEIPT_STORE_REQUIRED', 500);
  if (typeof authorizeHostRequest !== 'function' || typeof claimCommands !== 'function'
    || typeof renewCommandClaim !== 'function' || typeof publishHostReceipt !== 'function'
    || typeof onCommandQueued !== 'function') {
    throw routeError('AUTHORITY_HOST_COMMAND_API_REQUIRED', 500);
  }

  const router = express.Router();

  router.post('/host/commands/claim', async (req, res) => {
    try {
      const host = await authorizeHostRequest(req);
      const commands = await claimCommands({
        targetHostId: host.deviceId,
        claimToken: req.body?.claimToken,
        leaseMs: req.body?.leaseMs,
        limit: req.body?.limit,
      });
      res.json({ success: true, commands });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/host/commands/:id/renew', async (req, res) => {
    try {
      await authorizeHostRequest(req);
      const claim = await renewCommandClaim({
        commandId: req.params.id,
        claimToken: req.body?.claimToken,
        leaseMs: req.body?.leaseMs,
      });
      res.json({ success: true, claim });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/host/commands/:id/receipt', async (req, res) => {
    try {
      await authorizeHostRequest(req);
      if (String(req.body?.receipt?.commandId || '') !== String(req.params.id)) {
        throw routeError('AUTHORITY_RECEIPT_COMMAND_MISMATCH', 400);
      }
      const receipt = await publishHostReceipt(req.body.receipt, {
        claimToken: req.body?.claimToken,
      });
      res.json({ success: true, receipt });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/commands', async (req, res) => {
    try {
      const envelope = validateEnvelope(req.body);
      const actor = requireMatchingActor(req, envelope);
      await authorizeCommand({ envelope, actor, request: req });
      const queued = await enqueueCommand(envelope);
      try {
        await onCommandQueued({ envelope, queued, request: req });
      } catch (_error) {
        // Durable storage is authoritative; notification failure is recovered by host polling.
      }
      res.status(202).json({ success: true, command: queued });
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
