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
  commandInbox,
  commandAuthorization,
  onCommandQueued = () => {},
  now,
  createId,
} = {}) {
  if (!db || !commandInbox || !commandAuthorization) {
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
    const rows = db.prepare(`SELECT c.*,r.receipt_json
      FROM host_commands c
      LEFT JOIN host_receipts r ON r.command_id=c.command_id
      WHERE c.actor_user_id=? ORDER BY c.created_at DESC,c.command_id DESC LIMIT 50`)
      .all(userId);
    for (const row of rows) {
      const envelope = parseJson(row.envelope_json);
      if (envelope?.type === 'role-application.submit.v1'
        && envelope.authorityId === authorityId) {
        return { row, envelope, receipt: parseJson(row.receipt_json) };
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
    const state = row.status === 'completed'
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
      commandAuthorization.authorize(created.envelope);
      const queued = commandInbox.enqueue(created.envelope);
      try {
        await onCommandQueued({ envelope: created.envelope, queued, request: req });
      } catch (_error) {
        // Durable inbox polling is authoritative; wakeup is best effort only.
      }
      const application = {
        commandId: queued.id,
        requestedRole: created.envelope.payload.requestedRole,
        bindingHint: created.envelope.payload.bindingHint || null,
        status: queued.status,
        state: 'submitted',
        createdAt: created.envelope.createdAt,
      };
      return res.status(202).json({
        success: true,
        state: 'submitted',
        application,
        command: queued,
        data: { state: 'submitted', application, command: queued },
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
