const { Router } = require('express');
const {
  FORMAL_TOKEN_USE,
  VISITOR_TOKEN_USE,
} = require('../services/miniappIdentityService');
const {
  resolveCanonicalAuthorityRoleContext,
} = require('../services/authorityRoleGrantAdapter');
const {
  createMiniappAuthorityCommandAdapterService,
} = require('../services/miniappAuthorityCommandAdapterService');

function routeError(code, statusCode = 400) {
  return Object.assign(new Error(code), { code, statusCode });
}

function sendRouteError(res, error) {
  const code = error?.code || 'MINIAPP_AUTHORITY_APPLICATION_FAILED';
  return res.status(error?.statusCode || 400).json({
    success: false,
    code,
    error: code,
  });
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function createMiniappAuthorityApplicationsRouter({
  db,
  executeCommand,
  now,
  createId,
} = {}) {
  if (!db || typeof executeCommand !== 'function') {
    throw routeError('MINIAPP_AUTHORITY_APPLICATION_DEPENDENCY_REQUIRED', 500);
  }
  const router = Router();
  const adapter = createMiniappAuthorityCommandAdapterService({ db, now, createId });

  function requireApplicationSession(req, res, next) {
    if (req.authz?.tokenUse === VISITOR_TOKEN_USE
      && req.authz?.accountState === 'visitor'
      && req.authz?.userId
      && req.authz?.sessionId
      && req.authz?.authorityId) {
      req.authorityApplicationSession = Object.freeze({
        authorityId: req.authz.authorityId,
        activeRole: 'visitor',
      });
      return next();
    }
    if (req.authz?.tokenUse === FORMAL_TOKEN_USE
      && req.authz?.accountState === 'formal'
      && req.authz?.userId
      && req.authz?.sessionId) {
      const activeRole = String(req.authz.activeRole || '').trim();
      if (!['student', 'teacher'].includes(activeRole)) {
        return sendRouteError(res, routeError('MINIAPP_ROLE_APPLICATION_SESSION_FORBIDDEN', 403));
      }
      const account = db.prepare(`SELECT authority_id FROM authority_accounts
        WHERE user_id=? AND status='active'`).get(req.authz.userId);
      if (!account?.authority_id) {
        return sendRouteError(res, routeError('MINIAPP_AUTHORITY_SCOPE_INVALID', 403));
      }
      try {
        const context = resolveCanonicalAuthorityRoleContext(db, {
          authorityId: account.authority_id,
          userId: req.authz.userId,
        });
        if (context.accountStatus !== 'active'
          || !context.grants.some(grant => grant.role === activeRole && grant.status === 'active')) {
          throw routeError('MINIAPP_AUTHORITY_SCOPE_INVALID', 403);
        }
      } catch (error) {
        return sendRouteError(res, routeError(error?.code || 'MINIAPP_AUTHORITY_SCOPE_INVALID', 403));
      }
      req.authorityApplicationSession = Object.freeze({
        authorityId: account.authority_id,
        activeRole,
      });
      return next();
    }
    return sendRouteError(res, routeError('MINIAPP_VISITOR_SESSION_REQUIRED', 403));
  }

  function latestFor(userId, authorityId) {
    const rows = db.prepare(`SELECT c.*,r.result_payload,r.result_hash,r.projection_version,r.completed_at
      FROM authority_command_ledger c
      LEFT JOIN authority_command_receipts r ON r.command_id=c.command_id
      WHERE c.actor_user_id=? ORDER BY c.created_at DESC,c.command_id DESC LIMIT 50`)
      .all(userId);
    for (const row of rows) {
      if (row.command_type === 'role-application.submit.v1'
        && row.authority_id === authorityId) {
        const receipt = row.result_payload ? {
          protocol: 'gewu.authority-receipt.v1',
          commandId: row.command_id,
          status: row.status,
          resultHash: row.result_hash,
          authorityId: row.authority_id,
          hostEpochId: row.host_epoch_id,
          projectionVersion: row.projection_version,
          completedAt: row.completed_at,
          result: parseJson(row.result_payload, {}),
        } : null;
        return {
          row,
          envelope: {
            payload: receipt?.result?.application ? {
              requestedRole: receipt.result.application.requestedRole,
              bindingHint: receipt.result.application.bindingHint,
            } : {},
            createdAt: row.created_at,
          },
          receipt,
        };
      }
    }
    return null;
  }

  function presentApplication(found) {
    if (!found) return { state: 'not_submitted', application: null };
    const { row, envelope, receipt } = found;
    const committedApplication = receipt?.status === 'committed'
      ? receipt?.result?.application || receipt?.result || null
      : null;
    const requestedRole = committedApplication?.requestedRole
      || envelope.payload?.requestedRole
      || null;
    const applicationStatus = committedApplication?.status || null;
    const state = row.status === 'committed'
      ? applicationStatus === 'rejected' ? 'rejected'
        : applicationStatus === 'approved' ? 'approved'
          : receipt?.status === 'rejected' ? 'rejected' : 'submitted'
      : 'submitted';
    return {
      state,
      application: {
        commandId: row.command_id,
        applicationId: committedApplication?.applicationId || null,
        requestedRole,
        bindingHint: committedApplication?.bindingHint || envelope.payload?.bindingHint || null,
        status: applicationStatus || row.status,
        state,
        createdAt: envelope.createdAt,
        receipt: receipt || null,
      },
    };
  }

  router.use(requireApplicationSession);

  router.get('/me', (req, res) => {
    try {
      const result = presentApplication(latestFor(
        req.authz.userId,
        req.authorityApplicationSession.authorityId,
      ));
      return res.json({ success: true, ...result, data: result });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.post('/', async (req, res) => {
    try {
      const requestedRole = req.body?.requestedRole || req.body?.applicationType;
      const created = adapter.createRoleApplicationEnvelope({
        userId: req.authz.userId,
        sessionId: req.authz.sessionId,
        authorityId: req.authorityApplicationSession.authorityId,
        activeRole: req.authorityApplicationSession.activeRole,
        requestedRole,
        bindingHint: req.body?.bindingHint,
        idempotencyKey: req.get('x-idempotency-key'),
      });
      const executed = await executeCommand(created.envelope);
      const application = {
        commandId: executed.command.id,
        requestedRole: created.envelope.payload.requestedRole,
        bindingHint: created.envelope.payload.bindingHint || null,
        status: executed.command.status,
        state: 'submitted',
        createdAt: created.envelope.createdAt,
      };
      return res.json({
        success: true,
        state: 'submitted',
        application,
        command: { ...executed.command, replayed: executed.replayed === true },
        receipt: executed.receipt,
        data: { state: 'submitted', application, command: executed.command, receipt: executed.receipt },
      });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  router.post('/:id/withdraw', (_req, res) => sendRouteError(
    res,
    routeError('LEGACY_ROLE_APPLICATION_WITHDRAW_RETIRED', 410),
  ));

  router.all('/admin', (_req, res) => sendRouteError(
    res,
    routeError('HOST_ROLE_APPLICATION_REVIEW_REQUIRED', 410),
  ));

  return router;
}

module.exports = {
  createMiniappAuthorityApplicationsRouter,
  routeError,
};
