const {
  verifySignedAuthorityProjection,
} = require('../../../shared/authorityProjectionProtocol');
const {
  createAuthorityProjectionStoreService,
} = require('../../../backend/src/services/authorityProjectionStoreService');
const {
  createAuthorityRoleMirrorService,
} = require('./authorityRoleMirrorService');

function gatewayProjectionError(code, statusCode = 403) {
  return Object.assign(new Error(code), { code, statusCode });
}

function createGatewayAuthorityProjectionService({ db } = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw gatewayProjectionError('AUTHORITY_PROJECTION_DATABASE_REQUIRED', 500);
  }
  const store = createAuthorityProjectionStoreService({ db });
  const roleMirrors = createAuthorityRoleMirrorService({ db });

  function publish(input) {
    const epoch = db.prepare(`SELECT id,db_authority_id,host_public_key
      FROM primary_host_epochs WHERE id=? AND status='active'`)
      .get(String(input?.hostEpochId || '').trim());
    if (!epoch || epoch.db_authority_id !== input?.authorityId || !epoch.host_public_key) {
      throw gatewayProjectionError('AUTHORITY_PROJECTION_HOST_EPOCH_INACTIVE');
    }
    let verified;
    try {
      verified = verifySignedAuthorityProjection({
        projection: input,
        publicKey: epoch.host_public_key,
      });
    } catch (error) {
      throw gatewayProjectionError(error?.code || 'AUTHORITY_PROJECTION_SIGNATURE_INVALID', 400);
    }
    const published = store.publish(verified);
    if (verified.role === 'super_admin') {
      roleMirrors.replaceFromVerifiedProjection(verified);
    }
    return published;
  }

  return Object.freeze({
    publish,
    read: input => store.read(input),
  });
}

module.exports = {
  createGatewayAuthorityProjectionService,
  gatewayProjectionError,
};
