'use strict';

function cacheError(code) { return Object.assign(new Error(code), { code }); }

function createAuthorityDeviceControlCache({ db } = {}) {
  if (!db?.prepare || !db?.transaction) throw cacheError('AUTHORITY_DEVICE_CONTROL_CACHE_DATABASE_REQUIRED');
  db.exec(`CREATE TABLE IF NOT EXISTS authority_device_control_cache_versions (
    authority_id TEXT PRIMARY KEY, host_epoch_id TEXT NOT NULL, host_generation INTEGER NOT NULL,
    source_version INTEGER NOT NULL, updated_at TEXT NOT NULL
  )`);
  const replaceTransaction = db.transaction(snapshot => {
    const authorityId = String(snapshot?.authorityId || '').trim();
    const hostEpochId = String(snapshot?.hostEpochId || '').trim();
    const hostGeneration = Number(snapshot?.hostGeneration);
    const sourceVersion = Number(snapshot?.sourceVersion);
    if (!authorityId || !hostEpochId || !Number.isSafeInteger(hostGeneration) || hostGeneration < 1
      || !Number.isSafeInteger(sourceVersion) || sourceVersion < 0
      || !Array.isArray(snapshot?.accounts) || !Array.isArray(snapshot?.grants) || !Array.isArray(snapshot?.leases) || !Array.isArray(snapshot?.roleBindings)) {
      throw cacheError('AUTHORITY_DEVICE_CONTROL_CACHE_INVALID');
    }
    const current = db.prepare('SELECT * FROM authority_device_control_cache_versions WHERE authority_id=?').get(authorityId);
    if (current && current.host_epoch_id === hostEpochId
      && Number(current.source_version) > sourceVersion) {
      throw cacheError('AUTHORITY_DEVICE_CONTROL_CACHE_VERSION_STALE');
    }
    const grants = new Set(snapshot.grants.map(item => String(item?.grantId || '')));
    if (snapshot.grants.some(item => item?.authorityId !== authorityId || Number(item?.hostGeneration) !== hostGeneration || !item?.grantId || !item?.deviceId || !item?.userId || !item?.publicKey)
      || snapshot.leases.some(item => item?.authorityId !== authorityId || !grants.has(String(item?.grantId || '')) || !item?.leaseId || !item?.userId || !item?.deviceId)) {
      throw cacheError('AUTHORITY_DEVICE_CONTROL_CACHE_SCOPE_MISMATCH');
    }
    db.prepare('DELETE FROM device_leases WHERE authority_id=?').run(authorityId);
    db.prepare('DELETE FROM device_grants WHERE authority_id=?').run(authorityId);
    db.prepare('DELETE FROM authority_accounts WHERE authority_id=?').run(authorityId);
    const insertSubject = db.prepare(`INSERT OR IGNORE INTO users
      (id,phone,name,nickname,avatar_url,role,status,login_enabled,identity_kind,auth_version,
       review_status,deleted,created_at,updated_at)
      VALUES(?,?,?,?,?,'visitor',1,0,'visitor',1,'approved',0,?,?)`);
    for (const x of snapshot.accounts) {
      insertSubject.run(
        x.userId,
        x.phone || null,
        x.name || x.nickname || null,
        x.nickname || null,
        x.avatarUrl || null,
        x.createdAt,
        x.updatedAt,
      );
      db.prepare('INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at) VALUES(?,?,?,?,?)')
        .run(x.userId, authorityId, x.status, x.createdAt, x.updatedAt);
    }
    for (const x of snapshot.grants) db.prepare('INSERT INTO device_grants(grant_id,authority_id,device_id,user_id,public_key,host_generation,status,grant_version,approved_by,created_at,updated_at,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(x.grantId, authorityId, x.deviceId, x.userId, x.publicKey, hostGeneration, x.status, x.grantVersion, x.approvedBy || null, x.createdAt, x.updatedAt, x.revokedAt || null);
    for (const x of snapshot.leases) db.prepare('INSERT INTO device_leases(lease_id,grant_id,authority_id,device_id,user_id,active_role,grant_version,status,issued_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(x.leaseId, x.grantId, authorityId, x.deviceId, x.userId, x.activeRole, x.grantVersion, x.status, x.issuedAt, x.expiresAt, x.revokedAt || null);
    db.prepare('INSERT INTO authority_device_control_cache_versions(authority_id,host_epoch_id,host_generation,source_version,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(authority_id) DO UPDATE SET host_epoch_id=excluded.host_epoch_id,host_generation=excluded.host_generation,source_version=excluded.source_version,updated_at=excluded.updated_at').run(authorityId, hostEpochId, hostGeneration, sourceVersion, new Date().toISOString());
    return Object.freeze({
      authorityId,
      sourceVersion,
      accounts: snapshot.accounts.length,
      grants: snapshot.grants.length,
      leases: snapshot.leases.length,
      recoveryRoleBindings: 0,
      ignoredUnsignedRoleBindings: snapshot.roleBindings.length,
      roleBindingsPreserved: true,
    });
  });
  return Object.freeze({ replace: snapshot => replaceTransaction(snapshot) });
}

module.exports = { createAuthorityDeviceControlCache, cacheError };
