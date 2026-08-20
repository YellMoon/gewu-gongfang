'use strict';

const crypto = require('crypto');
const { types } = require('node:util');
const { assertVNextControlPlaneReferenceSchema } = require('./vNextControlPlaneReferenceKernel');
const { isVNextAccessContextResolverReferenceForDatabase } = require('./vNextAccessContextResolverReference');
const { stablePlainObjectJson } = require('./vNextCanonicalJsonReference');

const COMMAND_KEYS = new Set(['type', 'targetLinkId', 'expectedTargetRowVersion', 'idempotencyKey', 'reasonCode']);
const ERROR = code => Object.assign(new Error(code), { code });
const sha256 = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const frozen = value => Object.freeze(value);

function stableJson(value) {
  const json = stablePlainObjectJson(value);
  if (json === null) throw ERROR('ACCOUNT_DEVICE_LINK_REVOCATION_INPUT_INVALID');
  return json;
}
function text(value, code) { const result = typeof value === 'string' ? value.trim() : ''; if (!result) throw ERROR(code); return result; }
function at(value) { if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) throw ERROR('ACCOUNT_DEVICE_LINK_REVOCATION_UNAUTHORIZED'); return Date.parse(value); }
function exactConfig(config) {
  if (!config || typeof config !== 'object' || types.isProxy(config) || Object.getPrototypeOf(config) !== Object.prototype) return null;
  const allowed = new Set(['db', 'resolver', 'now', 'idFactory', 'testHooks']); const keys = Reflect.ownKeys(config);
  if (keys.some(key => typeof key !== 'string' || !allowed.has(key)) || !['db', 'resolver'].every(key => keys.includes(key))) return null;
  const result = {};
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(config, key); if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null; result[key] = descriptor.value; }
  return result;
}
function exactCommand(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== COMMAND_KEYS.size || [...COMMAND_KEYS].some(key => !Object.hasOwn(value, key))) throw ERROR('ACCOUNT_DEVICE_LINK_REVOCATION_INPUT_INVALID');
  const snapshot = {};
  for (const key of COMMAND_KEYS) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw ERROR('ACCOUNT_DEVICE_LINK_REVOCATION_INPUT_INVALID'); snapshot[key] = descriptor.value; }
  if (snapshot.type !== 'account_device_link.revoke' || !Number.isInteger(snapshot.expectedTargetRowVersion) || snapshot.expectedTargetRowVersion < 1) throw ERROR('ACCOUNT_DEVICE_LINK_REVOCATION_INPUT_INVALID');
  return frozen({ type: snapshot.type, targetLinkId: text(snapshot.targetLinkId, 'ACCOUNT_DEVICE_LINK_REVOCATION_INPUT_INVALID'), expectedTargetRowVersion: snapshot.expectedTargetRowVersion, idempotencyKey: text(snapshot.idempotencyKey, 'ACCOUNT_DEVICE_LINK_REVOCATION_INPUT_INVALID'), reasonCode: text(snapshot.reasonCode, 'ACCOUNT_DEVICE_LINK_REVOCATION_INPUT_INVALID') });
}
function parseResult(json, hash) {
  if (sha256(json) !== hash) throw ERROR('IDEMPOTENCY_RECEIPT_INVALID');
  let result; try { result = JSON.parse(json); } catch { throw ERROR('IDEMPOTENCY_RECEIPT_INVALID'); }
  if (!result || Object.getPrototypeOf(result) !== Object.prototype || stableJson(result) !== json || Object.keys(result).length !== 7 || !['code', 'linkId', 'linkRowVersion', 'policyRevision', 'revokedAt', 'status', 'targetStatus'].every(key => Object.hasOwn(result, key)) || typeof result.code !== 'string' || typeof result.status !== 'string' || typeof result.linkId !== 'string' || !Number.isInteger(result.policyRevision) || result.policyRevision < 1 || !(result.linkRowVersion === null || (Number.isInteger(result.linkRowVersion) && result.linkRowVersion >= 1)) || !(result.revokedAt === null || (typeof result.revokedAt === 'string' && !Number.isNaN(Date.parse(result.revokedAt)))) || !['active', 'expired', 'missing', 'revoked', 'self'].includes(result.targetStatus)) throw ERROR('IDEMPOTENCY_RECEIPT_INVALID');
  return result;
}

function createVNextAccountDeviceLinkRevocationMutationReference(config) {
  const values = exactConfig(config);
  const { db, resolver, now = () => new Date().toISOString(), idFactory = kind => `${kind}-${crypto.randomUUID()}`, testHooks = {} } = values || {};
  if (!db || ['prepare', 'transaction', 'pragma', 'exec'].some(key => typeof db[key] !== 'function') || !isVNextAccessContextResolverReferenceForDatabase(resolver, db) || typeof now !== 'function' || typeof idFactory !== 'function' || !testHooks || types.isProxy(testHooks) || Object.getPrototypeOf(testHooks) !== Object.prototype) throw ERROR('ACCOUNT_DEVICE_LINK_REVOCATION_CONFIGURATION_INVALID');
  const nextId = kind => text(idFactory(kind), 'ACCOUNT_DEVICE_LINK_REVOCATION_ID_INVALID');

  const execute = db.transaction((assertion, input) => {
    assertVNextControlPlaneReferenceSchema(db);
    const command = exactCommand(input);
    let context; try { context = resolver.resolve(assertion); } catch { throw ERROR('ACCOUNT_DEVICE_LINK_REVOCATION_UNAUTHORIZED'); }
    const timestamp = now(); const nowMillis = at(timestamp);
    if (!context || context.surface !== 'desktop' || !Array.isArray(context.roles) || !context.roles.includes('super_admin') || !Array.isArray(context.capabilityIds) || !context.capabilityIds.includes('device.revoke') || !context.reauthenticatedUntil || at(context.reauthenticatedUntil) <= nowMillis) throw ERROR('ACCOUNT_DEVICE_LINK_REVOCATION_UNAUTHORIZED');
    const authorityId = text(context.authorityId, 'ACCOUNT_DEVICE_LINK_REVOCATION_UNAUTHORIZED');
    const actorAccountId = text(context.accountId, 'ACCOUNT_DEVICE_LINK_REVOCATION_UNAUTHORIZED');
    const actorKey = `account:${actorAccountId}`;
    const requestJson = stableJson({ expectedTargetRowVersion: command.expectedTargetRowVersion, reasonCode: command.reasonCode, targetLinkId: command.targetLinkId, type: command.type });
    const requestHash = sha256(requestJson);
    const existing = db.prepare('SELECT receipt_id,canonical_request_sha256,canonical_result_json,canonical_result_sha256,actor_account_id,command_type,target_kind,target_id,expected_row_version,outcome,result_code,committed_auth_version,committed_access_version,committed_revocation_version,committed_target_row_version,created_at FROM vNext_authorization_command_receipts WHERE authority_id=? AND actor_key=? AND idempotency_key=?').get(authorityId, actorKey, command.idempotencyKey);
    if (existing) {
      if (existing.canonical_request_sha256 !== requestHash) throw ERROR('IDEMPOTENCY_KEY_CONFLICT');
      const result = parseResult(existing.canonical_result_json, existing.canonical_result_sha256);
      const audits = db.prepare('SELECT reason_code,context_sha256 FROM vNext_authorization_audit_events WHERE authority_id=? AND receipt_id=?').all(authorityId, existing.receipt_id);
      const outbox = db.prepare('SELECT event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256 FROM vNext_authorization_outbox_events WHERE authority_id=? AND receipt_id=?').all(authorityId, existing.receipt_id);
      const target = db.prepare('SELECT account_id,status,auth_version,access_version,row_version,updated_at,revoked_at FROM vNext_account_device_links WHERE authority_id=? AND link_id=?').get(authorityId, command.targetLinkId);
      const targetMatches = result.targetStatus === 'self'
        ? command.targetLinkId === context.linkId && result.linkRowVersion === null
        : result.targetStatus === 'missing'
          ? !target && result.linkRowVersion === null
          : target && target.status === result.targetStatus && target.row_version === result.linkRowVersion && target.revoked_at === result.revokedAt;
      const base = existing.actor_account_id === actorAccountId && existing.command_type === command.type && existing.target_kind === 'account_device_link' && existing.target_id === command.targetLinkId && existing.expected_row_version === command.expectedTargetRowVersion && result.linkId === command.targetLinkId && result.code === existing.result_code && result.status === existing.outcome && targetMatches && audits.length === 1 && audits[0].reason_code === command.reasonCode && audits[0].context_sha256 === sha256(stableJson({ accountId: actorAccountId, linkId: context.linkId, policyRevision: result.policyRevision }));
      let valid = false;
      if (result.status === 'accepted') {
        const payload = stableJson({ accountId: target?.account_id, linkAccessVersion: existing.committed_access_version, linkAuthVersion: existing.committed_auth_version, linkId: command.targetLinkId, linkRowVersion: existing.committed_target_row_version });
        valid = result.code === 'ACCOUNT_DEVICE_LINK_REVOKED' && result.targetStatus === 'revoked' && result.linkRowVersion === existing.committed_target_row_version && result.revokedAt === existing.created_at && existing.committed_auth_version !== null && existing.committed_access_version !== null && existing.committed_revocation_version === null && existing.committed_target_row_version !== null && target && target.auth_version === existing.committed_auth_version && target.access_version === existing.committed_access_version && target.updated_at === existing.created_at && outbox.length === 1 && outbox[0].event_type === 'authorization.account_device_link_revoked' && outbox[0].aggregate_kind === 'account_device_link' && outbox[0].aggregate_id === command.targetLinkId && outbox[0].aggregate_version === existing.committed_target_row_version && outbox[0].canonical_payload_json === payload && outbox[0].payload_sha256 === sha256(payload);
      } else if (result.status === 'noop') valid = result.code === 'ACCOUNT_DEVICE_LINK_ALREADY_REVOKED' && result.targetStatus === 'revoked' && Number.isInteger(result.linkRowVersion) && typeof result.revokedAt === 'string' && existing.committed_auth_version === null && existing.committed_access_version === null && existing.committed_revocation_version === null && existing.committed_target_row_version === null && outbox.length === 0;
      else valid = (result.code === 'ACCOUNT_DEVICE_LINK_VERSION_CONFLICT' && result.targetStatus === 'active' && result.linkRowVersion !== command.expectedTargetRowVersion && result.revokedAt === null || result.code === 'ACCOUNT_DEVICE_LINK_NOT_ACTIVE' && ['missing', 'expired'].includes(result.targetStatus) && result.revokedAt === null || result.code === 'ACCOUNT_DEVICE_LINK_SELF_REVOKE_FORBIDDEN' && result.targetStatus === 'self' && result.linkRowVersion === null && result.revokedAt === null) && existing.committed_auth_version === null && existing.committed_access_version === null && existing.committed_revocation_version === null && existing.committed_target_row_version === null && outbox.length === 0;
      if (!base || !valid) throw ERROR('IDEMPOTENCY_RECEIPT_INVALID');
      return frozen({ code: result.code, linkId: result.linkId, replayed: true, status: result.status });
    }
    const resultFor = (code, linkRowVersion, status, targetStatus, revokedAt = null) => ({ code, linkId: command.targetLinkId, linkRowVersion, policyRevision: context.policyRevision, revokedAt, status, targetStatus });
    const contextHash = sha256(stableJson({ accountId: actorAccountId, linkId: context.linkId, policyRevision: context.policyRevision }));
    const record = ({ outcome, code, result, versions = null, outbox = null }) => {
      const resultJson = stableJson(result); const receiptId = nextId('link-revoke-receipt');
      db.prepare('INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,actor_account_id,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_auth_version,committed_access_version,committed_revocation_version,committed_target_row_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(receiptId, authorityId, actorKey, actorAccountId, command.idempotencyKey, command.type, 'account_device_link', command.targetLinkId, requestHash, command.expectedTargetRowVersion, outcome, code, resultJson, sha256(resultJson), versions?.authVersion ?? null, versions?.accessVersion ?? null, null, versions?.rowVersion ?? null, timestamp);
      if (typeof testHooks.afterReceipt === 'function') testHooks.afterReceipt();
      db.prepare('INSERT INTO vNext_authorization_audit_events(event_id,authority_id,receipt_id,reason_code,context_sha256,created_at) VALUES(?,?,?,?,?,?)').run(nextId('link-revoke-audit'), authorityId, receiptId, command.reasonCode, contextHash, timestamp);
      if (typeof testHooks.afterAudit === 'function') testHooks.afterAudit();
      if (outbox) {
        const payloadJson = stableJson(outbox.payload);
        db.prepare('INSERT INTO vNext_authorization_outbox_events(event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(nextId('link-revoke-outbox'), authorityId, receiptId, 'authorization.account_device_link_revoked', 'account_device_link', command.targetLinkId, outbox.aggregateVersion, payloadJson, sha256(payloadJson), timestamp);
        if (typeof testHooks.afterOutbox === 'function') testHooks.afterOutbox();
      }
      return frozen({ code: result.code, linkId: result.linkId, replayed: false, status: result.status });
    };
    if (command.targetLinkId === context.linkId) return record({ outcome: 'rejected', code: 'ACCOUNT_DEVICE_LINK_SELF_REVOKE_FORBIDDEN', result: resultFor('ACCOUNT_DEVICE_LINK_SELF_REVOKE_FORBIDDEN', null, 'rejected', 'self') });
    const target = db.prepare('SELECT * FROM vNext_account_device_links WHERE authority_id=? AND link_id=?').get(authorityId, command.targetLinkId);
    if (!target || target.status === 'expired') return record({ outcome: 'rejected', code: 'ACCOUNT_DEVICE_LINK_NOT_ACTIVE', result: resultFor('ACCOUNT_DEVICE_LINK_NOT_ACTIVE', target?.row_version ?? null, 'rejected', target?.status ?? 'missing') });
    if (target.status === 'revoked') return record({ outcome: 'noop', code: 'ACCOUNT_DEVICE_LINK_ALREADY_REVOKED', result: resultFor('ACCOUNT_DEVICE_LINK_ALREADY_REVOKED', target.row_version, 'noop', 'revoked', target.revoked_at) });
    if (target.row_version !== command.expectedTargetRowVersion) return record({ outcome: 'rejected', code: 'ACCOUNT_DEVICE_LINK_VERSION_CONFLICT', result: resultFor('ACCOUNT_DEVICE_LINK_VERSION_CONFLICT', target.row_version, 'rejected', 'active') });
    const changed = db.prepare("UPDATE vNext_account_device_links SET status='revoked',auth_version=auth_version+1,access_version=access_version+1,row_version=row_version+1,revoked_at=?,updated_at=? WHERE authority_id=? AND link_id=? AND status='active' AND row_version=?").run(timestamp, timestamp, authorityId, command.targetLinkId, command.expectedTargetRowVersion);
    if (changed.changes !== 1) return record({ outcome: 'rejected', code: 'ACCOUNT_DEVICE_LINK_VERSION_CONFLICT', result: resultFor('ACCOUNT_DEVICE_LINK_VERSION_CONFLICT', target.row_version, 'rejected', 'active') });
    if (typeof testHooks.afterTarget === 'function') testHooks.afterTarget();
    const updated = db.prepare('SELECT auth_version,access_version,row_version FROM vNext_account_device_links WHERE authority_id=? AND link_id=?').get(authorityId, command.targetLinkId);
    const payload = { accountId: target.account_id, linkAccessVersion: updated.access_version, linkAuthVersion: updated.auth_version, linkId: command.targetLinkId, linkRowVersion: updated.row_version };
    return record({ outcome: 'accepted', code: 'ACCOUNT_DEVICE_LINK_REVOKED', result: resultFor('ACCOUNT_DEVICE_LINK_REVOKED', updated.row_version, 'accepted', 'revoked', timestamp), versions: { authVersion: updated.auth_version, accessVersion: updated.access_version, rowVersion: updated.row_version }, outbox: { aggregateVersion: updated.row_version, payload } });
  });
  return frozen({ execute });
}

module.exports = frozen({ createVNextAccountDeviceLinkRevocationMutationReference });
