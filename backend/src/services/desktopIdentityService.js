function serviceError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function presentAuthorization(row) {
  return Object.freeze({
    id: row.id,
    deviceId: row.device_id,
    deviceName: row.device_name,
    deviceKind: row.device_kind,
    userId: row.user_id,
    keyFingerprint: row.key_fingerprint,
    status: row.status,
    approvedByUserId: row.approved_by_user_id || null,
    approvedByDeviceId: row.approved_by_device_id || null,
    approvedAt: row.approved_at || null,
    lastPhoneVerifiedAt: row.last_phone_verified_at || null,
    phoneReverifyDueAt: row.phone_reverify_due_at || null,
    credentialVersion: Number(row.credential_version),
    lastSeenAt: row.last_seen_at || null,
    rowVersion: Number(row.row_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at || null,
    retiredAt: row.retired_at || null,
    replacedByDeviceId: row.replaced_by_device_id || null,
  });
}

function createDesktopIdentityService({ db } = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw serviceError('DESKTOP_IDENTITY_DB_REQUIRED');
  }

  function listDevicesForUser(userId) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) throw serviceError('DESKTOP_USER_ID_REQUIRED');
    const rows = db.prepare(`SELECT * FROM desktop_device_authorizations
      WHERE user_id=? ORDER BY created_at ASC, id ASC`).all(normalizedUserId);
    return Object.freeze(rows.map(presentAuthorization));
  }

  function listAllDevices() {
    const rows = db.prepare(`SELECT * FROM desktop_device_authorizations
      ORDER BY created_at ASC, id ASC`).all();
    return Object.freeze(rows.map(presentAuthorization));
  }

  return Object.freeze({ listAllDevices, listDevicesForUser });
}

module.exports = { createDesktopIdentityService };
