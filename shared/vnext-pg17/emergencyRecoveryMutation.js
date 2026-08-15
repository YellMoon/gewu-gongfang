'use strict';

const crypto = require('node:crypto');
const { types } = require('node:util');
const { isVNextPg17DisposableHandleForRuntime, withVNextPg17SyntheticQuery } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { isVNextTrustRootVerifierBoundaryReferenceForDatabase } = require('../vNextTrustRootVerifierBoundaryReference');

const COMMAND_KEYS = Object.freeze(['type', 'recoveryEventId', 'authorityId', 'replacementAccountId', 'replacementDeviceId', 'replacementInstallationId', 'replacementInstallationPublicKey', 'replacementInstallationKeyFingerprint', 'backupId', 'backupManifestSha256', 'reasonCode', 'idempotencyKey']);
const OUTBOX_KEYS = Object.freeze(['authorityId', 'recoveryEventSha256', 'replacementAccountId', 'replacementDeviceId', 'replacementInstallationId', 'replacementLinkId', 'revokedGrantCount', 'revokedGrantIdsSha256', 'revokedSessionCount', 'revokedSessionIdsSha256']);
const HASH = /^[0-9a-f]{64}$/;

function failure(code) { return Object.assign(new Error(code), { code }); }
function hash(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function stable(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw failure('RECOVERY_INPUT_INVALID');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function instant(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value; }
function ownData(value, keys, required = keys) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const own = Reflect.ownKeys(value);
  if (own.some(key => typeof key !== 'string' || !keys.includes(key)) || required.some(key => !own.includes(key))) return null;
  const copy = {};
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    copy[key] = descriptor.value;
  }
  return copy;
}
function text(value, code = 'RECOVERY_INPUT_INVALID') {
  if (typeof value !== 'string' || value.trim() === '') throw failure(code);
  return value.trim();
}
function commandSnapshot(value) {
  const copy = ownData(value, COMMAND_KEYS);
  if (!copy || Reflect.ownKeys(copy).length !== COMMAND_KEYS.length || copy.type !== 'authority.owner_recover') throw failure('RECOVERY_INPUT_INVALID');
  for (const key of COMMAND_KEYS) if (key !== 'type') copy[key] = text(copy[key]);
  if (!HASH.test(copy.replacementInstallationKeyFingerprint) || !HASH.test(copy.backupManifestSha256)) throw failure('RECOVERY_INPUT_INVALID');
  return Object.freeze(copy);
}
function configSnapshot(value) {
  const keys = ['runtime', 'handle', 'verifierBoundary', 'now', 'idFactory', 'testHooks'];
  const copy = ownData(value, keys, ['runtime', 'handle', 'verifierBoundary', 'now', 'idFactory']);
  if (!copy || types.isProxy(copy.now) || types.isProxy(copy.idFactory) || typeof copy.now !== 'function' || typeof copy.idFactory !== 'function') return null;
  if (copy.testHooks !== undefined) {
    const hooks = ownData(copy.testHooks, ['afterWrite']);
    if (!hooks || types.isProxy(hooks.afterWrite) || typeof hooks.afterWrite !== 'function') return null;
  }
  return copy;
}
function result(command) { return { authorityId: command.authorityId, code: 'OWNER_RECOVERY_COMPLETED', replacementAccountId: command.replacementAccountId, status: 'accepted' }; }
function matchesProof(proof, command, timestamp) {
  const keys = ['recoveryEventId', 'authorityId', 'replacementAccountId', 'replacementDeviceId', 'replacementInstallationId', 'replacementInstallationPublicKey', 'replacementInstallationKeyFingerprint', 'backupId', 'backupManifestSha256', 'reasonCode'];
  return proof && proof.kind === 'owner_recovery_event' && instant(timestamp) && instant(proof.expiresAt)
    && Date.parse(proof.expiresAt) > Date.parse(timestamp) && keys.every(key => proof[key] === command[key]);
}
function validOutboxPayload(value, command, replacementLinkId, json, sha256) {
  const payload = ownData(value, OUTBOX_KEYS);
  if (!payload || Reflect.ownKeys(payload).length !== OUTBOX_KEYS.length || stable(payload) !== json || hash(json) !== sha256) return false;
  if (payload.authorityId !== command.authorityId || payload.recoveryEventSha256 !== hash(command.recoveryEventId)
    || payload.replacementAccountId !== command.replacementAccountId || payload.replacementDeviceId !== command.replacementDeviceId
    || payload.replacementInstallationId !== command.replacementInstallationId || payload.replacementLinkId !== replacementLinkId) return false;
  return HASH.test(payload.revokedGrantIdsSha256) && HASH.test(payload.revokedSessionIdsSha256)
    && Number.isSafeInteger(payload.revokedGrantCount) && payload.revokedGrantCount >= 0
    && Number.isSafeInteger(payload.revokedSessionCount) && payload.revokedSessionCount >= 0;
}

function createVNextPg17EmergencyRecoveryMutation(config) {
  const settings = configSnapshot(config);
  if (!settings || !isVNextPg17DisposableHandleForRuntime(settings.runtime, settings.handle)
    || !isVNextTrustRootVerifierBoundaryReferenceForDatabase(settings.verifierBoundary, settings.handle)) throw failure('RECOVERY_WRITER_INVALID');
  const catalog = createVNextPg17CatalogBoundary(settings.runtime);
  const nextId = kind => text(settings.idFactory(kind), 'RECOVERY_ID_INVALID');
  const hook = async stage => { if (settings.testHooks) await settings.testHooks.afterWrite(Object.freeze({ stage })); };

  async function execute(assertion, input) {
    const command = commandSnapshot(input);
    let proof;
    try { proof = settings.verifierBoundary.unwrap(assertion, 'owner_recovery_event'); } catch { throw failure('RECOVERY_ASSERTION_MISMATCH'); }
    let timestamp;
    try { timestamp = settings.now(); } catch { throw failure('RECOVERY_INPUT_INVALID'); }
    if (!matchesProof(proof, command, timestamp)) throw failure('RECOVERY_ASSERTION_MISMATCH');
    const requestJson = stable(command);
    const requestHash = hash(requestJson);
    await catalog.assert(settings.handle);
    return withVNextPg17SyntheticQuery(settings.handle, 'fixture-provisioner', async facade => {
      try {
        await facade.query('BEGIN');
        await facade.query("SELECT pg_advisory_xact_lock(hashtextextended('vnext:owner-recovery:' || $1, 0))", [command.recoveryEventId]);
        const actorKey = `recovery:${command.recoveryEventId}`;
        const existing = await facade.query('SELECT * FROM vnext_control_plane.vnext_authorization_command_receipts WHERE authority_id=$1 AND actor_key=$2 AND idempotency_key=$3 FOR UPDATE', [command.authorityId, actorKey, command.idempotencyKey]);
        if (existing.rows.length === 1) {
          const receipt = existing.rows[0];
          if (receipt.canonical_request_sha256 !== requestHash) throw failure('IDEMPOTENCY_KEY_CONFLICT');
          let prior;
          try { prior = JSON.parse(receipt.canonical_result_json); } catch { throw failure('IDEMPOTENCY_RECEIPT_INVALID'); }
          const expectedResult = result(command);
          const context = hash(stable({ authorityId: command.authorityId, recoveryEventId: command.recoveryEventId }));
          const companion = await facade.query("SELECT (SELECT count(*)::text FROM vnext_control_plane.vnext_accounts WHERE authority_id=$1 AND account_id=$2 AND status='active' AND auth_version=1 AND access_version=1 AND revocation_version=1 AND row_version=1) AS account_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_trusted_devices WHERE authority_id=$1 AND device_id=$3 AND status='active' AND credential_version=1 AND risk_version=1 AND row_version=1) AS device_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_device_installations WHERE authority_id=$1 AND device_id=$3 AND installation_id=$4 AND status='active' AND installation_public_key=$5 AND key_fingerprint=$6 AND credential_version=1 AND row_version=1) AS installation_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_account_device_links WHERE authority_id=$1 AND account_id=$2 AND device_id=$3 AND installation_id=$4 AND status='active' AND auth_version=1 AND access_version=1 AND row_version=1) AS link_count, (SELECT link_id FROM vnext_control_plane.vnext_account_device_links WHERE authority_id=$1 AND account_id=$2 AND device_id=$3 AND installation_id=$4 AND status='active' AND auth_version=1 AND access_version=1 AND row_version=1) AS replacement_link_id, (SELECT count(*)::text FROM vnext_control_plane.vnext_role_grants WHERE authority_id=$1 AND role='super_admin' AND status='active' AND account_id=$2 AND granted_by_account_id IS NULL AND grant_version=1 AND row_version=1) AS admin_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_role_grants WHERE authority_id=$1 AND role='super_admin' AND status='active') AS all_admin_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_trust_root_evidence WHERE authority_id=$1 AND receipt_id=$7 AND actor_kind='owner_recovery_event' AND event_id=$8 AND assertion_evidence_sha256=$9 AND backup_id=$10 AND backup_manifest_sha256=$11) AS evidence_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_authorization_audit_events WHERE authority_id=$1 AND receipt_id=$7 AND reason_code=$12 AND context_sha256=$13) AS audit_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_authorization_outbox_events WHERE authority_id=$1 AND receipt_id=$7 AND event_type='authorization.owner_recovered' AND aggregate_kind='authority' AND aggregate_id=$1 AND aggregate_version=1) AS outbox_count, (SELECT canonical_payload_json FROM vnext_control_plane.vnext_authorization_outbox_events WHERE authority_id=$1 AND receipt_id=$7 AND event_type='authorization.owner_recovered' AND aggregate_kind='authority' AND aggregate_id=$1 AND aggregate_version=1) AS outbox_payload, (SELECT payload_sha256 FROM vnext_control_plane.vnext_authorization_outbox_events WHERE authority_id=$1 AND receipt_id=$7 AND event_type='authorization.owner_recovered' AND aggregate_kind='authority' AND aggregate_id=$1 AND aggregate_version=1) AS outbox_sha", [command.authorityId, command.replacementAccountId, command.replacementDeviceId, command.replacementInstallationId, command.replacementInstallationPublicKey, command.replacementInstallationKeyFingerprint, receipt.receipt_id, command.recoveryEventId, proof.assertionEvidenceSha256, command.backupId, command.backupManifestSha256, command.reasonCode, context]);
          const validReceipt = receipt.actor_account_id === null && receipt.command_type === command.type && receipt.target_kind === 'authority' && receipt.target_id === command.authorityId && receipt.expected_row_version === null && receipt.outcome === 'accepted' && receipt.result_code === 'OWNER_RECOVERY_COMPLETED' && receipt.committed_auth_version === null && receipt.committed_access_version === null && receipt.committed_revocation_version === null && receipt.committed_target_row_version === null && receipt.canonical_result_sha256 === hash(receipt.canonical_result_json) && stable(prior) === receipt.canonical_result_json && stable(prior) === stable(expectedResult);
          const row = companion.rows[0];
          const countsValid = ['account_count', 'device_count', 'installation_count', 'link_count', 'admin_count', 'all_admin_count', 'evidence_count', 'audit_count', 'outbox_count'].every(key => row[key] === '1');
          let outboxValid = false;
          try { outboxValid = validOutboxPayload(JSON.parse(row.outbox_payload), command, row.replacement_link_id, row.outbox_payload, row.outbox_sha); } catch { outboxValid = false; }
          if (!validReceipt || !countsValid || !outboxValid) throw failure('IDEMPOTENCY_RECEIPT_INVALID');
          await facade.query('COMMIT');
          return Object.freeze({ ...expectedResult, replayed: true });
        }
        const priorEvent = await facade.query('SELECT 1 FROM vnext_control_plane.vnext_authorization_command_receipts WHERE actor_key=$1', [actorKey]);
        if (priorEvent.rows.length) throw failure('RECOVERY_EVENT_ALREADY_CONSUMED');
        const authority = await facade.query("SELECT authority_id FROM vnext_control_plane.vnext_authorities WHERE authority_id=$1 AND status='active' FOR UPDATE", [command.authorityId]);
        if (authority.rows.length !== 1) throw failure('RECOVERY_AUTHORITY_NOT_ACTIVE');
        const collision = await facade.query("SELECT 1 FROM vnext_control_plane.vnext_accounts WHERE account_id=$1 UNION ALL SELECT 1 FROM vnext_control_plane.vnext_trusted_devices WHERE device_id=$2 UNION ALL SELECT 1 FROM vnext_control_plane.vnext_device_installations WHERE installation_id=$3 OR (authority_id=$4 AND key_fingerprint=$5)", [command.replacementAccountId, command.replacementDeviceId, command.replacementInstallationId, command.authorityId, command.replacementInstallationKeyFingerprint]);
        if (collision.rows.length) throw failure('RECOVERY_REPLACEMENT_EXISTS');
        const oldGrants = await facade.query("SELECT grant_id, account_id, grant_version, row_version FROM vnext_control_plane.vnext_role_grants WHERE authority_id=$1 AND role='super_admin' AND status='active' ORDER BY grant_id FOR UPDATE", [command.authorityId]);
        const accountIds = [...new Set(oldGrants.rows.map(row => row.account_id))].sort();
        const oldAccounts = [];
        for (const accountId of accountIds) {
          const rows = await facade.query("SELECT account_id, auth_version, access_version, revocation_version, row_version FROM vnext_control_plane.vnext_accounts WHERE authority_id=$1 AND account_id=$2 AND status='active' FOR UPDATE", [command.authorityId, accountId]);
          if (rows.rows.length !== 1) throw failure('RECOVERY_CONFLICT');
          oldAccounts.push(rows.rows[0]);
        }
        const oldSessions = await facade.query("SELECT session_id, row_version FROM vnext_control_plane.vnext_sessions WHERE authority_id=$1 AND status='active' ORDER BY session_id FOR UPDATE", [command.authorityId]);
        const ids = { link: nextId('recovery-link'), grant: nextId('recovery-grant'), receipt: nextId('recovery-receipt'), evidence: nextId('recovery-evidence'), audit: nextId('recovery-audit'), outbox: nextId('recovery-outbox') };
        const resultJson = stable(result(command));
        const writes = [
          ['account', 'INSERT INTO vnext_control_plane.vnext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES($1,$2,$3,1,1,1,1,$4,$4)', [command.replacementAccountId, command.authorityId, 'active', timestamp]],
          ['device', 'INSERT INTO vnext_control_plane.vnext_trusted_devices(device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at,revoked_at) VALUES($1,$2,$3,1,1,1,$4,$4,NULL)', [command.replacementDeviceId, command.authorityId, 'active', timestamp]],
          ['installation', 'INSERT INTO vnext_control_plane.vnext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,1,1,$7,$7,NULL)', [command.replacementInstallationId, command.authorityId, command.replacementDeviceId, command.replacementInstallationPublicKey, command.replacementInstallationKeyFingerprint, 'active', timestamp]],
          ['link', 'INSERT INTO vnext_control_plane.vnext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,1,1,1,$7,$7,NULL)', [ids.link, command.authorityId, command.replacementAccountId, command.replacementDeviceId, command.replacementInstallationId, 'active', timestamp]],
        ];
        for (const [stage, sql, values] of writes) { await facade.query(sql, values); await hook(stage); }
        for (const grant of oldGrants.rows) {
          const changed = await facade.query("UPDATE vnext_control_plane.vnext_role_grants SET status='revoked', grant_version=grant_version+1, row_version=row_version+1, revoked_at=$1, updated_at=$1 WHERE grant_id=$2 AND status='active' AND grant_version=$3 AND row_version=$4", [timestamp, grant.grant_id, grant.grant_version, grant.row_version]);
          if (changed.rowCount !== 1) throw failure('RECOVERY_CONFLICT');
          await hook('old-grant');
        }
        for (const account of oldAccounts) {
          const changed = await facade.query('UPDATE vnext_control_plane.vnext_accounts SET auth_version=auth_version+1, access_version=access_version+1, revocation_version=revocation_version+1, row_version=row_version+1, updated_at=$1 WHERE authority_id=$2 AND account_id=$3 AND status=\'active\' AND auth_version=$4 AND access_version=$5 AND revocation_version=$6 AND row_version=$7', [timestamp, command.authorityId, account.account_id, account.auth_version, account.access_version, account.revocation_version, account.row_version]);
          if (changed.rowCount !== 1) throw failure('RECOVERY_CONFLICT');
          await hook('old-account');
        }
        for (const session of oldSessions.rows) {
          const changed = await facade.query("UPDATE vnext_control_plane.vnext_sessions SET status='revoked', revoked_at=$1, updated_at=$1, row_version=row_version+1 WHERE authority_id=$2 AND session_id=$3 AND status='active' AND row_version=$4", [timestamp, command.authorityId, session.session_id, session.row_version]);
          if (changed.rowCount !== 1) throw failure('RECOVERY_CONFLICT');
          await hook('session');
        }
        await facade.query('INSERT INTO vnext_control_plane.vnext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,ends_at,revoked_at,granted_by_account_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,1,1,$6,NULL,NULL,NULL,$6,$6)', [ids.grant, command.authorityId, command.replacementAccountId, 'super_admin', 'active', timestamp]);
        await hook('replacement-grant');
        const finalState = await facade.query("SELECT (SELECT count(*)::text FROM vnext_control_plane.vnext_role_grants WHERE authority_id=$1 AND role='super_admin' AND status='active' AND account_id=$2 AND granted_by_account_id IS NULL) AS admins, (SELECT count(*)::text FROM vnext_control_plane.vnext_sessions WHERE authority_id=$1 AND status='active') AS sessions", [command.authorityId, command.replacementAccountId]);
        if (finalState.rows[0].admins !== '1' || finalState.rows[0].sessions !== '0') throw failure('RECOVERY_FINAL_INVARIANT_FAILED');
        await facade.query('INSERT INTO vnext_control_plane.vnext_authorization_command_receipts(receipt_id,authority_id,actor_key,actor_account_id,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_auth_version,committed_access_version,committed_revocation_version,committed_target_row_version,created_at) VALUES($1,$2,$3,NULL,$4,$5,$6,$2,$7,NULL,$8,$9,$10,$11,NULL,NULL,NULL,NULL,$12)', [ids.receipt, command.authorityId, actorKey, command.idempotencyKey, command.type, 'authority', requestHash, 'accepted', 'OWNER_RECOVERY_COMPLETED', resultJson, hash(resultJson), timestamp]);
        await hook('receipt');
        await facade.query("INSERT INTO vnext_control_plane.vnext_trust_root_evidence(evidence_id,authority_id,receipt_id,actor_kind,event_id,assertion_evidence_sha256,backup_id,backup_manifest_sha256,created_at) VALUES($1,$2,$3,'owner_recovery_event',$4,$5,$6,$7,$8)", [ids.evidence, command.authorityId, ids.receipt, command.recoveryEventId, proof.assertionEvidenceSha256, command.backupId, command.backupManifestSha256, timestamp]);
        await hook('evidence');
        const context = hash(stable({ authorityId: command.authorityId, recoveryEventId: command.recoveryEventId }));
        await facade.query('INSERT INTO vnext_control_plane.vnext_authorization_audit_events(event_id,authority_id,receipt_id,reason_code,context_sha256,created_at) VALUES($1,$2,$3,$4,$5,$6)', [ids.audit, command.authorityId, ids.receipt, command.reasonCode, context, timestamp]);
        await hook('audit');
        const payload = stable({ authorityId: command.authorityId, recoveryEventSha256: hash(command.recoveryEventId), replacementAccountId: command.replacementAccountId, replacementDeviceId: command.replacementDeviceId, replacementInstallationId: command.replacementInstallationId, replacementLinkId: ids.link, revokedGrantCount: oldGrants.rows.length, revokedGrantIdsSha256: hash(JSON.stringify(oldGrants.rows.map(row => row.grant_id))), revokedSessionCount: oldSessions.rows.length, revokedSessionIdsSha256: hash(JSON.stringify(oldSessions.rows.map(row => row.session_id))) });
        await facade.query("INSERT INTO vnext_control_plane.vnext_authorization_outbox_events(event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at) VALUES($1,$2,$3,'authorization.owner_recovered','authority',$2,1,$4,$5,$6)", [ids.outbox, command.authorityId, ids.receipt, payload, hash(payload), timestamp]);
        await hook('outbox');
        await facade.query('COMMIT');
        return Object.freeze({ ...result(command), replayed: false });
      } catch (error) {
        try { await facade.query('ROLLBACK'); } catch (_) { /* no-op */ }
        if (error && typeof error.code === 'string' && /^(RECOVERY_|IDEMPOTENCY_)/.test(error.code)) throw error;
        throw failure('RECOVERY_UNAVAILABLE');
      }
    });
  }
  return Object.freeze({ execute });
}

module.exports = Object.freeze({ createVNextPg17EmergencyRecoveryMutation });
