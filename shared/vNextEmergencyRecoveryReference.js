'use strict';

const crypto = require('node:crypto');
const { types } = require('node:util');
const { assertVNextControlPlaneReferenceSchema } = require('./vNextControlPlaneReferenceKernel');
const { isVNextTrustRootVerifierBoundaryReferenceForDatabase } = require('./vNextTrustRootVerifierBoundaryReference');

const ERROR = code => Object.assign(new Error(code), { code });
const hash = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const freeze = value => Object.freeze(value);
const stable = value => `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(',')}}`;
const COMMAND_KEYS = ['type','recoveryEventId','authorityId','replacementAccountId','replacementDeviceId','replacementInstallationId','replacementInstallationPublicKey','replacementInstallationKeyFingerprint','backupId','backupManifestSha256','reasonCode','idempotencyKey'];
function instant(value) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) throw ERROR('RECOVERY_INPUT_INVALID'); return value; }
function exactCommand(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== COMMAND_KEYS.length) throw ERROR('RECOVERY_INPUT_INVALID');
  const copy = {}; for (const key of COMMAND_KEYS) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw ERROR('RECOVERY_INPUT_INVALID'); copy[key] = descriptor.value; }
  if (copy.type !== 'authority.owner_recover' || COMMAND_KEYS.slice(1).some(key => typeof copy[key] !== 'string' || !copy[key].trim())) throw ERROR('RECOVERY_INPUT_INVALID'); return Object.freeze(copy);
}
function exactConfig(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const allowed = new Set(['db', 'verifier', 'now', 'idFactory', 'testHooks']); const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || !allowed.has(key)) || !['db', 'verifier'].every(key => keys.includes(key))) return null;
  const copy = {}; for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null; copy[key] = descriptor.value; } return copy;
}
function exactHooks(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(value); if (keys.some(key => key !== 'afterWrite')) return null;
  if (!keys.length) return freeze({ afterWrite: null });
  const descriptor = Object.getOwnPropertyDescriptor(value, 'afterWrite');
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function' || types.isProxy(descriptor.value)) return null;
  return freeze({ afterWrite: descriptor.value });
}
function parseResult(json, digest) {
  if (typeof json !== 'string' || hash(json) !== digest) throw ERROR('IDEMPOTENCY_RECEIPT_INVALID');
  let value; try { value = JSON.parse(json); } catch { throw ERROR('IDEMPOTENCY_RECEIPT_INVALID'); }
  const keys = ['authorityId', 'code', 'replacementAccountId', 'status'];
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || stable(value) !== json || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || typeof value.authorityId !== 'string' || value.code !== 'OWNER_RECOVERY_COMPLETED' || typeof value.replacementAccountId !== 'string' || value.status !== 'accepted') throw ERROR('IDEMPOTENCY_RECEIPT_INVALID');
  return value;
}
function parsePayload(json, digest, command, linkId) {
  if (typeof json !== 'string' || hash(json) !== digest) throw ERROR('IDEMPOTENCY_RECEIPT_INVALID');
  let value; try { value = JSON.parse(json); } catch { throw ERROR('IDEMPOTENCY_RECEIPT_INVALID'); }
  const keys = ['authorityId', 'recoveryEventSha256', 'replacementAccountId', 'replacementDeviceId', 'replacementInstallationId', 'replacementLinkId', 'revokedGrantCount', 'revokedGrantIdsSha256', 'revokedSessionCount', 'revokedSessionIdsSha256'];
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || stable(value) !== json || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || value.authorityId !== command.authorityId || value.recoveryEventSha256 !== hash(command.recoveryEventId) || value.replacementAccountId !== command.replacementAccountId || value.replacementDeviceId !== command.replacementDeviceId || value.replacementInstallationId !== command.replacementInstallationId || value.replacementLinkId !== linkId || !Number.isSafeInteger(value.revokedGrantCount) || value.revokedGrantCount < 0 || !Number.isSafeInteger(value.revokedSessionCount) || value.revokedSessionCount < 0 || !['revokedGrantIdsSha256', 'revokedSessionIdsSha256'].every(key => typeof value[key] === 'string' && /^[0-9a-f]{64}$/.test(value[key]))) throw ERROR('IDEMPOTENCY_RECEIPT_INVALID');
  return value;
}
function createVNextEmergencyRecoveryReference(config) {
  const values = exactConfig(config); const { db, verifier, now = () => new Date().toISOString(), idFactory = kind => `${kind}-${crypto.randomUUID()}`, testHooks = {} } = values || {};
  const hooks = exactHooks(testHooks);
  if (!db || ['prepare', 'transaction', 'pragma', 'exec'].some(key => typeof db[key] !== 'function') || typeof now !== 'function' || typeof idFactory !== 'function' || !hooks || !isVNextTrustRootVerifierBoundaryReferenceForDatabase(verifier, db)) throw ERROR('RECOVERY_WRITER_INVALID');
  const nextId = kind => { const value = idFactory(kind); if (typeof value !== 'string' || !value.trim()) throw ERROR('RECOVERY_ID_INVALID'); return value.trim(); };
  const hook = stage => { if (hooks.afterWrite) hooks.afterWrite(freeze({ stage })); };
  const execute = db.transaction((assertion, input) => {
    assertVNextControlPlaneReferenceSchema(db);
    const command = exactCommand(input);
    let proof; try { proof = verifier.unwrap(assertion, 'owner_recovery_event'); } catch { throw ERROR('RECOVERY_ASSERTION_MISMATCH'); }
    if (!db.prepare("SELECT 1 FROM vNext_authorities WHERE authority_id=? AND status='active'").get(command.authorityId)) throw ERROR('RECOVERY_AUTHORITY_NOT_ACTIVE');
    let timestamp; try { timestamp = instant(now()); } catch { throw ERROR('RECOVERY_INPUT_INVALID'); }
    const required = ['recoveryEventId','authorityId','replacementAccountId','replacementDeviceId','replacementInstallationId','replacementInstallationPublicKey','replacementInstallationKeyFingerprint','backupId','backupManifestSha256','reasonCode','idempotencyKey'];
    if (required.some(key => typeof command[key] !== 'string' || !command[key].trim())) throw ERROR('RECOVERY_INPUT_INVALID');
    if (Date.parse(proof.expiresAt) <= Date.parse(timestamp) || required.slice(0, 9).some(key => proof[key] !== command[key]) || proof.backupManifestSha256 !== command.backupManifestSha256 || proof.reasonCode !== command.reasonCode) throw ERROR('RECOVERY_ASSERTION_MISMATCH');
    const requestHash = hash(stable(command)); const actorKey = `recovery:${command.recoveryEventId}`;
    const existing = db.prepare('SELECT * FROM vNext_authorization_command_receipts WHERE authority_id=? AND actor_key=? AND idempotency_key=?').get(command.authorityId, actorKey, command.idempotencyKey);
    if (existing && existing.canonical_request_sha256 !== requestHash) throw ERROR('IDEMPOTENCY_KEY_CONFLICT');
    if (existing) {
      const prior = parseResult(existing.canonical_result_json, existing.canonical_result_sha256);
      const account = db.prepare("SELECT * FROM vNext_accounts WHERE authority_id=? AND account_id=? AND status='active'").get(command.authorityId, command.replacementAccountId);
      const device = db.prepare("SELECT * FROM vNext_trusted_devices WHERE authority_id=? AND device_id=? AND status='active'").get(command.authorityId, command.replacementDeviceId);
      const installation = db.prepare("SELECT * FROM vNext_device_installations WHERE authority_id=? AND installation_id=? AND device_id=? AND status='active'").get(command.authorityId, command.replacementInstallationId, command.replacementDeviceId);
      const links = db.prepare("SELECT * FROM vNext_account_device_links WHERE authority_id=? AND account_id=? AND device_id=? AND installation_id=? AND status='active'").all(command.authorityId, command.replacementAccountId, command.replacementDeviceId, command.replacementInstallationId);
      const grants = db.prepare("SELECT * FROM vNext_role_grants WHERE authority_id=? AND account_id=? AND role='super_admin' AND status='active'").all(command.authorityId, command.replacementAccountId);
      const allAdmins = db.prepare("SELECT grant_id FROM vNext_role_grants WHERE authority_id=? AND role='super_admin' AND status='active'").all(command.authorityId);
      const evidence = db.prepare("SELECT * FROM vNext_trust_root_evidence WHERE authority_id=? AND receipt_id=? AND actor_kind='owner_recovery_event'").all(command.authorityId, existing.receipt_id);
      const audit = db.prepare('SELECT * FROM vNext_authorization_audit_events WHERE authority_id=? AND receipt_id=?').all(command.authorityId, existing.receipt_id);
      const outbox = db.prepare('SELECT * FROM vNext_authorization_outbox_events WHERE authority_id=? AND receipt_id=?').all(command.authorityId, existing.receipt_id);
      const payload = outbox.length === 1 ? parsePayload(outbox[0].canonical_payload_json, outbox[0].payload_sha256, command, links[0]?.link_id) : null;
      const valid = existing.actor_account_id === null && existing.command_type === command.type && existing.target_kind === 'authority' && existing.target_id === command.authorityId && existing.expected_row_version === null && existing.committed_target_row_version === null && existing.committed_auth_version === null && existing.committed_access_version === null && existing.committed_revocation_version === null && existing.outcome === 'accepted' && existing.result_code === prior.code && prior.authorityId === command.authorityId && prior.replacementAccountId === command.replacementAccountId && account && account.auth_version === 1 && account.access_version === 1 && account.revocation_version === 1 && account.row_version === 1 && device && device.credential_version === 1 && device.risk_version === 1 && device.row_version === 1 && installation && installation.installation_public_key === command.replacementInstallationPublicKey && installation.key_fingerprint === command.replacementInstallationKeyFingerprint && installation.credential_version === 1 && installation.row_version === 1 && links.length === 1 && links[0].auth_version === 1 && links[0].access_version === 1 && links[0].row_version === 1 && grants.length === 1 && grants[0].grant_version === 1 && grants[0].row_version === 1 && grants[0].granted_by_account_id === null && grants[0].ends_at === null && grants[0].revoked_at === null && grants[0].starts_at === existing.created_at && grants[0].created_at === existing.created_at && grants[0].updated_at === existing.created_at && allAdmins.length === 1 && evidence.length === 1 && evidence[0].event_id === command.recoveryEventId && evidence[0].assertion_evidence_sha256 === proof.assertionEvidenceSha256 && evidence[0].backup_id === command.backupId && evidence[0].backup_manifest_sha256 === command.backupManifestSha256 && audit.length === 1 && audit[0].reason_code === command.reasonCode && audit[0].context_sha256 === hash(stable({ authorityId: command.authorityId, recoveryEventId: command.recoveryEventId })) && outbox.length === 1 && outbox[0].event_type === 'authorization.owner_recovered' && outbox[0].aggregate_kind === 'authority' && outbox[0].aggregate_id === command.authorityId && outbox[0].aggregate_version === 1 && payload;
      if (!valid) throw ERROR('IDEMPOTENCY_RECEIPT_INVALID');
      return Object.freeze({ authorityId: command.authorityId, code: prior.code, replacementAccountId: prior.replacementAccountId, replayed: true, status: prior.status });
    }
    if (db.prepare('SELECT 1 FROM vNext_authorization_command_receipts WHERE actor_key=?').get(actorKey)) throw ERROR('RECOVERY_EVENT_ALREADY_CONSUMED');
    for (const table of [['vNext_accounts','account_id',command.replacementAccountId],['vNext_trusted_devices','device_id',command.replacementDeviceId],['vNext_device_installations','installation_id',command.replacementInstallationId]]) if (db.prepare(`SELECT 1 FROM ${table[0]} WHERE ${table[1]}=?`).get(table[2])) throw ERROR('RECOVERY_REPLACEMENT_EXISTS');
    if (db.prepare('SELECT 1 FROM vNext_device_installations WHERE authority_id=? AND key_fingerprint=?').get(command.authorityId, command.replacementInstallationKeyFingerprint)) throw ERROR('RECOVERY_REPLACEMENT_EXISTS');
    const oldGrants = db.prepare("SELECT * FROM vNext_role_grants WHERE authority_id=? AND role='super_admin' AND status='active' ORDER BY grant_id").all(command.authorityId);
    const oldSessions = db.prepare("SELECT * FROM vNext_sessions WHERE authority_id=? AND status='active' ORDER BY session_id").all(command.authorityId);
    const oldAccounts = [...new Set(oldGrants.map(grant => grant.account_id))].sort().map(accountId => db.prepare('SELECT * FROM vNext_accounts WHERE authority_id=? AND account_id=?').get(command.authorityId, accountId));
    if (oldAccounts.some(account => !account || account.status !== 'active')) throw ERROR('RECOVERY_CONFLICT');
    const result = { authorityId: command.authorityId, code: 'OWNER_RECOVERY_COMPLETED', replacementAccountId: command.replacementAccountId, status: 'accepted' }; const resultJson = stable(result); const receiptId = nextId('recovery-receipt'); const linkId = nextId('recovery-link'); const grantId = nextId('recovery-super-admin-grant'); const evidenceId = nextId('recovery-evidence'); const auditId = nextId('recovery-audit'); const outboxId = nextId('recovery-outbox');
    db.prepare("INSERT INTO vNext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(command.replacementAccountId,command.authorityId,'active',1,1,1,1,timestamp,timestamp); hook('account');
    db.prepare("INSERT INTO vNext_trusted_devices(device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(command.replacementDeviceId,command.authorityId,'active',1,1,1,timestamp,timestamp); hook('device');
    db.prepare("INSERT INTO vNext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(command.replacementInstallationId,command.authorityId,command.replacementDeviceId,command.replacementInstallationPublicKey,command.replacementInstallationKeyFingerprint,'active',1,1,timestamp,timestamp); hook('installation');
    db.prepare("INSERT INTO vNext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(linkId,command.authorityId,command.replacementAccountId,command.replacementDeviceId,command.replacementInstallationId,'active',1,1,1,timestamp,timestamp); hook('link');
    for (const grant of oldGrants) {
      const changed=db.prepare("UPDATE vNext_role_grants SET status='revoked',grant_version=grant_version+1,row_version=row_version+1,revoked_at=?,updated_at=? WHERE grant_id=? AND status='active' AND grant_version=? AND row_version=?").run(timestamp,timestamp,grant.grant_id,grant.grant_version,grant.row_version); if (changed.changes!==1) throw ERROR('RECOVERY_CONFLICT'); hook('old-grant');
    }
    for (const account of oldAccounts) { const changed=db.prepare("UPDATE vNext_accounts SET auth_version=auth_version+1,access_version=access_version+1,revocation_version=revocation_version+1,row_version=row_version+1,updated_at=? WHERE authority_id=? AND account_id=? AND status='active' AND auth_version=? AND access_version=? AND revocation_version=? AND row_version=?").run(timestamp,command.authorityId,account.account_id,account.auth_version,account.access_version,account.revocation_version,account.row_version); if (changed.changes!==1) throw ERROR('RECOVERY_CONFLICT'); hook('old-account'); }
    for (const session of oldSessions) { const changed=db.prepare("UPDATE vNext_sessions SET status='revoked',revoked_at=?,updated_at=?,row_version=row_version+1 WHERE authority_id=? AND session_id=? AND status='active' AND row_version=?").run(timestamp,timestamp,command.authorityId,session.session_id,session.row_version); if (changed.changes!==1) throw ERROR('RECOVERY_CONFLICT'); hook('session'); }
    db.prepare("INSERT INTO vNext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(grantId,command.authorityId,command.replacementAccountId,'super_admin','active',1,1,timestamp,timestamp,timestamp); hook('replacement-grant');
    const finalAdmins = db.prepare("SELECT account_id,granted_by_account_id FROM vNext_role_grants WHERE authority_id=? AND role='super_admin' AND status='active'").all(command.authorityId);
    if (finalAdmins.length !== 1 || finalAdmins[0].account_id !== command.replacementAccountId || finalAdmins[0].granted_by_account_id !== null || db.prepare("SELECT COUNT(*) AS count FROM vNext_sessions WHERE authority_id=? AND status='active'").get(command.authorityId).count !== 0) throw ERROR('RECOVERY_FINAL_INVARIANT_FAILED');
    db.prepare("INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,outcome,result_code,canonical_result_json,canonical_result_sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(receiptId,command.authorityId,actorKey,command.idempotencyKey,command.type,'authority',command.authorityId,requestHash,'accepted','OWNER_RECOVERY_COMPLETED',resultJson,hash(resultJson),timestamp); hook('receipt');
    db.prepare("INSERT INTO vNext_trust_root_evidence(evidence_id,authority_id,receipt_id,actor_kind,event_id,assertion_evidence_sha256,backup_id,backup_manifest_sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(evidenceId,command.authorityId,receiptId,'owner_recovery_event',command.recoveryEventId,proof.assertionEvidenceSha256,command.backupId,command.backupManifestSha256,timestamp); hook('evidence');
    db.prepare("INSERT INTO vNext_authorization_audit_events(event_id,authority_id,receipt_id,reason_code,context_sha256,created_at) VALUES(?,?,?,?,?,?)").run(auditId,command.authorityId,receiptId,command.reasonCode,hash(stable({authorityId:command.authorityId,recoveryEventId:command.recoveryEventId})),timestamp); hook('audit');
    const payload=stable({ authorityId: command.authorityId, recoveryEventSha256: hash(command.recoveryEventId), replacementAccountId: command.replacementAccountId, replacementDeviceId: command.replacementDeviceId, replacementInstallationId: command.replacementInstallationId, replacementLinkId: linkId, revokedGrantCount: oldGrants.length, revokedGrantIdsSha256: hash(JSON.stringify(oldGrants.map(grant => grant.grant_id))), revokedSessionCount: oldSessions.length, revokedSessionIdsSha256: hash(JSON.stringify(oldSessions.map(session => session.session_id)))}); db.prepare("INSERT INTO vNext_authorization_outbox_events(event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(outboxId,command.authorityId,receiptId,'authorization.owner_recovered','authority',command.authorityId,1,payload,hash(payload),timestamp); hook('outbox');
    return Object.freeze({ authorityId: command.authorityId, code: result.code, replacementAccountId: command.replacementAccountId, replayed: false, status: 'accepted' });
  });
  return Object.freeze({ execute });
}
module.exports = Object.freeze({ createVNextEmergencyRecoveryReference });
