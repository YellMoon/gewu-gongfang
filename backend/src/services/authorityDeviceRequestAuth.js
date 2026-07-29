const {
  verifyAuthorityHttpSignature,
} = require('../../../shared/authorityHttpAuth');

function requestAuthError(code, statusCode) {
  return Object.assign(new Error(code), { code, statusCode });
}

function actorFromHeaders(req) {
  return Object.freeze({
    userId: String(req.headers['x-gewu-authority-user-id'] || '').trim(),
    deviceId: String(req.headers['x-gewu-authority-device-id'] || '').trim(),
    role: String(req.headers['x-gewu-authority-role'] || '').trim(),
  });
}

function createAuthorityDeviceRequestAuth({ db } = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw requestAuthError('AUTHORITY_DEVICE_AUTH_DATABASE_REQUIRED', 500);
  }

  function authenticate(req) {
    const actor = actorFromHeaders(req);
    if (!actor.userId || !actor.deviceId || !actor.role) {
      throw requestAuthError('AUTHORITY_ACTOR_REQUIRED', 401);
    }
    let authorityId = String(
      req.body?.authorityId
      || req.headers['x-gewu-authority-id']
      || ''
    ).trim();
    if (!authorityId) {
      const commandId = String(req.params?.id || '').trim();
      const row = commandId
        ? db.prepare('SELECT envelope_json FROM host_commands WHERE command_id=?').get(commandId)
        : null;
      if (!row) throw requestAuthError('AUTHORITY_COMMAND_NOT_FOUND', 404);
      const stored = JSON.parse(row.envelope_json);
      authorityId = String(stored.authorityId || '').trim();
      if (stored.actor?.userId !== actor.userId || stored.actor?.deviceId !== actor.deviceId) {
        throw requestAuthError('AUTHORITY_RECEIPT_FORBIDDEN', 403);
      }
    }
    const grant = db.prepare(`SELECT public_key FROM device_grants
      WHERE authority_id=? AND user_id=? AND device_id=? AND status='active'`)
      .get(authorityId, actor.userId, actor.deviceId);
    if (!grant) throw requestAuthError('DEVICE_GRANT_INACTIVE', 403);
    try {
      verifyAuthorityHttpSignature({
        method: req.method,
        path: String(req.originalUrl || req.url || '').split('?')[0],
        actor,
        body: req.method === 'GET' || req.method === 'HEAD' ? null : req.body,
        publicKey: grant.public_key,
        signature: req.headers['x-gewu-device-signature'],
      });
    } catch (error) {
      throw requestAuthError(error?.code || 'AUTHORITY_DEVICE_SIGNATURE_INVALID', 401);
    }
    return actor;
  }

  return Object.freeze({ authenticate });
}

module.exports = {
  actorFromHeaders,
  createAuthorityDeviceRequestAuth,
  requestAuthError,
};
