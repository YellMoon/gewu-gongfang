const {
  verifySignedAuthorityProjection,
} = require('../../../shared/authorityProjectionProtocol');
const {
  FORMAL_TOKEN_USE,
  VISITOR_TOKEN_USE,
} = require('../services/miniappIdentityService');

const FORMAL_ROLES = new Set(['student', 'teacher', 'super_admin']);

function errorResponse(res, statusCode, code) {
  return res.status(statusCode).json({ success: false, code, error: code });
}

function createMiniappAuthorityProjectionHandler({
  db,
  projectionStore,
  verifyProjection = verifySignedAuthorityProjection,
} = {}) {
  if (!db?.prepare || !projectionStore?.read || typeof verifyProjection !== 'function') {
    throw new Error('MINIAPP_AUTHORITY_PROJECTION_DEPENDENCIES_REQUIRED');
  }

  const findFormalAuthority = db.prepare(`SELECT DISTINCT a.authority_id AS authorityId
    FROM authority_accounts a
    JOIN authority_role_bindings b
      ON b.authority_id=a.authority_id AND b.user_id=a.user_id
    WHERE a.user_id=? AND a.status='active'
      AND b.user_id=? AND b.role=? AND b.status='active'
    ORDER BY a.authority_id`);
  const findActiveEpoch = db.prepare(`SELECT id,db_authority_id,host_public_key
    FROM primary_host_epochs
    WHERE id=? AND db_authority_id=? AND status='active'`);

  return function miniappAuthorityProjectionHandler(req, res) {
    try {
      const authz = req.authz || {};
      let authorityId = '';
      let role = '';
      if (authz.tokenUse === VISITOR_TOKEN_USE
        && authz.accountState === 'visitor'
        && authz.authorityId) {
        authorityId = String(authz.authorityId).trim();
        role = 'visitor';
      } else if (authz.tokenUse === FORMAL_TOKEN_USE
        && authz.accountState === 'formal'
        && FORMAL_ROLES.has(authz.activeRole)) {
        const rows = findFormalAuthority.all(authz.userId, authz.userId, authz.activeRole);
        if (rows.length > 1) {
          return errorResponse(res, 409, 'MINIAPP_AUTHORITY_SCOPE_AMBIGUOUS');
        }
        if (rows.length === 1) {
          authorityId = String(rows[0].authorityId || '').trim();
          role = authz.activeRole;
        }
      }
      if (!authorityId || !role || !authz.userId) {
        return errorResponse(res, 403, 'MINIAPP_AUTHORITY_PROJECTION_SESSION_REQUIRED');
      }
      const projection = projectionStore.read({
        authorityId,
        userId: authz.userId,
        role,
      });
      if (!projection) {
        return errorResponse(res, 404, 'AUTHORITY_PROJECTION_NOT_FOUND');
      }
      const epoch = findActiveEpoch.get(projection.hostEpochId, authorityId);
      if (!epoch?.host_public_key) {
        return errorResponse(res, 409, 'AUTHORITY_PROJECTION_HOST_EPOCH_INACTIVE');
      }
      const verifiedProjection = verifyProjection({
        projection,
        publicKey: epoch.host_public_key,
      });
      if (String(verifiedProjection?.authorityId || '').trim() !== authorityId
        || String(verifiedProjection?.userId || '').trim() !== String(authz.userId).trim()
        || String(verifiedProjection?.role || '').trim() !== role) {
        return errorResponse(res, 403, 'AUTHORITY_PROJECTION_SCOPE_MISMATCH');
      }
      return res.json({
        success: true,
        projection: verifiedProjection,
        data: { projection: verifiedProjection },
      });
    } catch (error) {
      return errorResponse(
        res,
        error?.statusCode || 400,
        error?.code || 'MINIAPP_AUTHORITY_PROJECTION_READ_FAILED',
      );
    }
  };
}

module.exports = { createMiniappAuthorityProjectionHandler };
