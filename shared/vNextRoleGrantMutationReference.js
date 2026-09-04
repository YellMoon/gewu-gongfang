'use strict';

const crypto = require('crypto');
const { assertVNextControlPlaneReferenceSchema } = require('./vNextControlPlaneReferenceKernel');
const { isVNextAccessContextResolverReferenceForDatabase } = require('./vNextAccessContextResolverReference');
const { types } = require('node:util');

const ROLES = new Set(['super_admin', 'teacher', 'student', 'family_member']);
const INPUT_KEYS = Object.freeze({
  'role.grant': new Set(['type', 'targetAccountId', 'role', 'expectedTargetRowVersion', 'idempotencyKey', 'reasonCode']),
  'role.revoke': new Set(['type', 'targetGrantId', 'expectedTargetRowVersion', 'idempotencyKey', 'reasonCode']),
});

function mutationError(code) { return Object.assign(new Error(code), { code }); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stableJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw mutationError('MUTATION_INPUT_INVALID'); return JSON.stringify(value); }
  if (typeof value === 'bigint' || typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') throw mutationError('MUTATION_INPUT_INVALID');
  if (Array.isArray(value)) {
    if (seen.has(value) || Object.keys(value).length !== value.length) throw mutationError('MUTATION_INPUT_INVALID');
    seen.add(value); const result = `[${value.map(item => stableJson(item, seen)).join(',')}]`; seen.delete(value); return result;
  }
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || seen.has(value)) throw mutationError('MUTATION_INPUT_INVALID');
  seen.add(value);
  const result = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key], seen)}`).join(',')}}`;
  seen.delete(value);
  return result;
}
function cleanText(value, code) { const text = typeof value === 'string' ? value.trim() : ''; if (!text) throw mutationError(code); return text; }
function frozen(value) { return Object.freeze(value); }
function isInteger(value, minimum) { return typeof value === 'number' && Number.isInteger(value) && value >= minimum; }
function parseCanonicalResult(json, expectedHash) {
  if (sha256(json) !== expectedHash) throw mutationError('IDEMPOTENCY_RECEIPT_INVALID');
  let result;
  try { result = JSON.parse(json); } catch (_error) { throw mutationError('IDEMPOTENCY_RECEIPT_INVALID'); }
  if (!result || Object.getPrototypeOf(result) !== Object.prototype || Object.keys(result).some(key => !['code', 'grantId', 'status', 'context'].includes(key))) throw mutationError('IDEMPOTENCY_RECEIPT_INVALID');
  if (typeof result.code !== 'string' || typeof result.status !== 'string' || ('grantId' in result && typeof result.grantId !== 'string') || !result.context || Object.getPrototypeOf(result.context) !== Object.prototype || Object.keys(result.context).length !== 3 || typeof result.context.accountId !== 'string' || typeof result.context.linkId !== 'string' || !Number.isInteger(result.context.policyRevision) || result.context.policyRevision < 1) throw mutationError('IDEMPOTENCY_RECEIPT_INVALID');
  if (stableJson(result) !== json) throw mutationError('IDEMPOTENCY_RECEIPT_INVALID');
  return result;
}
function validReplayResult(type, selector, result, receipt) {
  if (result.code !== receipt.result_code || result.status !== receipt.outcome) return false;
  if (type === 'role.grant') {
    if (result.status === 'accepted') return result.code === 'ROLE_GRANTED' && typeof result.grantId === 'string' && receipt.target_kind === 'role_grant' && receipt.target_id === result.grantId;
    return result.status === 'rejected' && !Object.hasOwn(result, 'grantId') && ['TARGET_ACCOUNT_NOT_ACTIVE', 'ROLE_GRANT_CONFLICT'].includes(result.code) && receipt.target_kind === 'account' && receipt.target_id === selector.targetAccountId;
  }
  if (result.status === 'accepted') return result.code === 'ROLE_REVOKED' && result.grantId === selector.targetGrantId && receipt.target_kind === 'role_grant' && receipt.target_id === selector.targetGrantId;
  if (result.status === 'noop') return result.code === 'ROLE_ALREADY_REVOKED' && result.grantId === selector.targetGrantId && receipt.target_kind === 'role_grant' && receipt.target_id === selector.targetGrantId;
  return result.status === 'rejected' && !Object.hasOwn(result, 'grantId') && ['ROLE_GRANT_NOT_ACTIVE', 'ROLE_GRANT_VERSION_CONFLICT', 'LAST_SUPER_ADMIN_REVOKE_FORBIDDEN'].includes(result.code) && receipt.target_kind === 'role_grant' && receipt.target_id === selector.targetGrantId;
}

function exactConfig(config) {
  if (!config || typeof config !== 'object' || types.isProxy(config) || Object.getPrototypeOf(config) !== Object.prototype) return null;
  const allowed = new Set(['db', 'resolver', 'now', 'idFactory', 'testHooks']); const keys = Reflect.ownKeys(config);
  if (keys.some(key => typeof key !== 'string' || !allowed.has(key)) || !['db', 'resolver'].every(key => keys.includes(key))) return null;
  const values = {};
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(config, key); if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null; values[key] = descriptor.value; }
  return values;
}
function exactInput(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw mutationError('MUTATION_INPUT_INVALID');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) throw mutationError('MUTATION_INPUT_INVALID');
  const snapshot = {};
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw mutationError('MUTATION_INPUT_INVALID'); snapshot[key] = descriptor.value; }
  return snapshot;
}

function createVNextRoleGrantMutationReference(config) {
  const values = exactConfig(config);
  const { db, resolver, now = () => new Date().toISOString(), idFactory = kind => `${kind}-${crypto.randomUUID()}`, testHooks = {} } = values || {};
  if (!db || ['prepare', 'transaction', 'pragma', 'exec'].some(key => typeof db[key] !== 'function') || !isVNextAccessContextResolverReferenceForDatabase(resolver, db) || typeof now !== 'function' || typeof idFactory !== 'function' || !testHooks || types.isProxy(testHooks) || Object.getPrototypeOf(testHooks) !== Object.prototype) throw mutationError('ROLE_MUTATION_CONFIGURATION_INVALID');
  const nextId = kind => cleanText(idFactory(kind), 'ID_FACTORY_INVALID');
  const execute = db.transaction((assertion, input) => {
    assertVNextControlPlaneReferenceSchema(db);
    const snapshot = exactInput(input);
    const type = cleanText(snapshot.type, 'MUTATION_TYPE_REQUIRED');
    if (!['role.grant', 'role.revoke'].includes(type)) throw mutationError('MUTATION_TYPE_UNSUPPORTED');
    if (Reflect.ownKeys(snapshot).length !== INPUT_KEYS[type].size || [...INPUT_KEYS[type]].some(key => !Object.hasOwn(snapshot, key))) throw mutationError('MUTATION_INPUT_INVALID');
    const idempotencyKey = cleanText(snapshot.idempotencyKey, 'IDEMPOTENCY_KEY_REQUIRED');
    const reasonCode = cleanText(snapshot.reasonCode, 'REASON_CODE_REQUIRED');
    const selector = type === 'role.grant'
      ? { targetAccountId: cleanText(snapshot.targetAccountId, 'TARGET_ACCOUNT_REQUIRED'), role: cleanText(snapshot.role, 'ROLE_REQUIRED'), expectedTargetRowVersion: snapshot.expectedTargetRowVersion }
      : { targetGrantId: cleanText(snapshot.targetGrantId, 'TARGET_GRANT_REQUIRED'), expectedTargetRowVersion: snapshot.expectedTargetRowVersion };
    if (!isInteger(selector.expectedTargetRowVersion, type === 'role.grant' ? 0 : 1) || (type === 'role.grant' && (!ROLES.has(selector.role) || selector.expectedTargetRowVersion !== 0))) throw mutationError('MUTATION_INPUT_INVALID');
    let context;
    try { context = resolver.resolve(assertion); } catch (_error) { throw mutationError('AUTHORIZATION_DENIED'); }
    const timestamp = now();
    if (typeof timestamp !== 'string' || !timestamp || Number.isNaN(Date.parse(timestamp))) throw mutationError('AUTHORIZATION_DENIED');
    if (!context || context.surface !== 'desktop' || !Array.isArray(context.roles) || !context.roles.includes('super_admin') || !Array.isArray(context.capabilityIds) || !context.capabilityIds.includes('access.manage') || typeof context.reauthenticatedUntil !== 'string' || Number.isNaN(Date.parse(context.reauthenticatedUntil)) || Date.parse(context.reauthenticatedUntil) <= Date.parse(timestamp)) throw mutationError('AUTHORIZATION_DENIED');
    const authorityId = cleanText(context.authorityId, 'AUTHORIZATION_DENIED');
    const actorAccountId = cleanText(context.accountId, 'AUTHORIZATION_DENIED');
    const authority = db.prepare("SELECT authority_id FROM vNext_authorities WHERE authority_id=? AND status='active'").get(authorityId);
    const actor = db.prepare("SELECT account_id FROM vNext_accounts WHERE authority_id=? AND account_id=? AND status='active'").get(authorityId, actorAccountId);
    if (!authority || !actor) throw mutationError('AUTHORIZATION_DENIED');
    const actorKey = `account:${actor.account_id}`;
    const executionContext = { accountId: actorAccountId, linkId: cleanText(context.linkId, 'AUTHORIZATION_DENIED'), policyRevision: context.policyRevision };
    if (!Number.isInteger(executionContext.policyRevision) || executionContext.policyRevision < 1) throw mutationError('AUTHORIZATION_DENIED');
    const contextHash = sha256(stableJson(executionContext));
    const requestJson = stableJson({ type, ...selector, reasonCode });
    const requestHash = sha256(requestJson);
    const existing = db.prepare("SELECT receipt_id,canonical_request_sha256,canonical_result_json,canonical_result_sha256,actor_account_id,command_type,target_kind,target_id,result_code,outcome,committed_auth_version,committed_access_version,committed_revocation_version,committed_target_row_version FROM vNext_authorization_command_receipts WHERE authority_id=? AND actor_key=? AND idempotency_key=?").get(authorityId, actorKey, idempotencyKey);
    if (existing) {
      if (existing.canonical_request_sha256 !== requestHash) throw mutationError('IDEMPOTENCY_KEY_CONFLICT');
      const parsedResult = parseCanonicalResult(existing.canonical_result_json, existing.canonical_result_sha256);
      const audits = db.prepare("SELECT reason_code,context_sha256 FROM vNext_authorization_audit_events WHERE authority_id=? AND receipt_id=?").all(authorityId, existing.receipt_id);
      const outbox = db.prepare("SELECT event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256 FROM vNext_authorization_outbox_events WHERE authority_id=? AND receipt_id=?").all(authorityId, existing.receipt_id);
      const acceptedVersions = type === 'role.grant'
        ? existing.committed_auth_version !== null && existing.committed_access_version !== null && existing.committed_revocation_version === null && existing.committed_target_row_version === 1
        : existing.committed_auth_version !== null && existing.committed_access_version !== null && existing.committed_revocation_version !== null && existing.committed_target_row_version !== null;
      let outboxValid = outbox.length === 0 && existing.committed_auth_version === null && existing.committed_access_version === null && existing.committed_revocation_version === null && existing.committed_target_row_version === null;
      if (parsedResult.status === 'accepted') {
        const grant = db.prepare('SELECT authority_id,account_id,role,status,grant_version,row_version FROM vNext_role_grants WHERE authority_id=? AND grant_id=?').get(authorityId, parsedResult.grantId);
        const accountId = grant?.account_id;
        const account = accountId ? db.prepare('SELECT auth_version,access_version,revocation_version FROM vNext_accounts WHERE authority_id=? AND account_id=?').get(authorityId, accountId) : null;
        const expectedPayload = type === 'role.grant'
          ? { accountId, accessVersion: existing.committed_access_version, authVersion: existing.committed_auth_version, grantId: parsedResult.grantId, role: selector.role }
          : { accessVersion: existing.committed_access_version, accountId, grantId: parsedResult.grantId, revocationVersion: existing.committed_revocation_version };
        const expectedPayloadJson = stableJson(expectedPayload);
        const targetValid = Boolean(grant && account) && grant.authority_id === authorityId && (type === 'role.grant' ? grant.account_id === selector.targetAccountId && grant.role === selector.role && grant.status === 'active' : ROLES.has(grant.role) && grant.status === 'revoked') && grant.row_version >= existing.committed_target_row_version && grant.grant_version >= existing.committed_target_row_version && account.auth_version >= existing.committed_auth_version && account.access_version >= existing.committed_access_version && (type === 'role.grant' ? existing.committed_revocation_version === null : account.revocation_version >= existing.committed_revocation_version);
        outboxValid = targetValid && outbox.length === 1
          && outbox[0].event_type === (type === 'role.grant' ? 'authorization.role_granted' : 'authorization.role_revoked')
          && outbox[0].aggregate_kind === 'role_grant'
          && outbox[0].aggregate_id === parsedResult.grantId
          && outbox[0].aggregate_version === existing.committed_target_row_version
          && outbox[0].canonical_payload_json === expectedPayloadJson
          && outbox[0].payload_sha256 === sha256(expectedPayloadJson);
      }
      if (existing.actor_account_id !== actorAccountId || existing.command_type !== type || !validReplayResult(type, selector, parsedResult, existing) || audits.length !== 1 || audits[0].reason_code !== reasonCode || audits[0].context_sha256 !== sha256(stableJson(parsedResult.context)) || !outboxValid || (parsedResult.status === 'accepted' && !acceptedVersions)) throw mutationError('IDEMPOTENCY_RECEIPT_INVALID');
      const { context: _context, ...output } = parsedResult;
      return frozen({ ...output, replayed: true });
    }
    const record = ({ outcome, code, targetKind, targetId, result, versions = null, outbox = null }) => {
      const storedResult = { ...result, context: executionContext };
      const resultJson = stableJson(storedResult);
      const receiptId = nextId('receipt');
      db.prepare("INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,actor_account_id,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_auth_version,committed_access_version,committed_revocation_version,committed_target_row_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(receiptId, authorityId, actorKey, actorAccountId, idempotencyKey, type, targetKind, targetId, requestHash, selector.expectedTargetRowVersion, outcome, code, resultJson, sha256(resultJson), versions?.authVersion || null, versions?.accessVersion || null, versions?.revocationVersion || null, versions?.targetRowVersion || null, timestamp);
      if (typeof testHooks.afterReceipt === 'function') testHooks.afterReceipt();
      db.prepare("INSERT INTO vNext_authorization_audit_events(event_id,authority_id,receipt_id,reason_code,context_sha256,created_at) VALUES(?,?,?,?,?,?)").run(nextId('audit'), authorityId, receiptId, reasonCode, contextHash, timestamp);
      if (typeof testHooks.afterAudit === 'function') testHooks.afterAudit();
      if (outbox) {
        const payloadJson = stableJson(outbox.payload);
        db.prepare("INSERT INTO vNext_authorization_outbox_events(event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
          .run(nextId('outbox'), authorityId, receiptId, outbox.eventType, 'role_grant', outbox.grantId, outbox.aggregateVersion, payloadJson, sha256(payloadJson), timestamp);
        if (typeof testHooks.afterOutbox === 'function') testHooks.afterOutbox();
      }
      return frozen({ ...result, replayed: false });
    };
    if (type === 'role.grant') {
      const target = db.prepare("SELECT * FROM vNext_accounts WHERE authority_id=? AND account_id=? AND status='active'").get(authorityId, selector.targetAccountId);
      if (!target) return record({ outcome: 'rejected', code: 'TARGET_ACCOUNT_NOT_ACTIVE', targetKind: 'account', targetId: selector.targetAccountId, result: { code: 'TARGET_ACCOUNT_NOT_ACTIVE', status: 'rejected' } });
      const active = db.prepare("SELECT grant_id FROM vNext_role_grants WHERE authority_id=? AND account_id=? AND role=? AND status='active'").get(authorityId, selector.targetAccountId, selector.role);
      if (active) return record({ outcome: 'rejected', code: 'ROLE_GRANT_CONFLICT', targetKind: 'account', targetId: selector.targetAccountId, result: { code: 'ROLE_GRANT_CONFLICT', status: 'rejected' } });
      const grantId = nextId('role-grant');
      db.prepare("INSERT INTO vNext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,created_at,updated_at,granted_by_account_id) VALUES(?,?,?,?,'active',1,1,?,?,?,?)").run(grantId, authorityId, selector.targetAccountId, selector.role, timestamp, timestamp, timestamp, actorAccountId);
      if (typeof testHooks.afterTarget === 'function') testHooks.afterTarget();
      const changed = db.prepare("UPDATE vNext_accounts SET auth_version=auth_version+1,access_version=access_version+1,row_version=row_version+1,updated_at=? WHERE authority_id=? AND account_id=? AND status='active'").run(timestamp, authorityId, selector.targetAccountId);
      if (changed.changes !== 1) throw mutationError('TARGET_ACCOUNT_NOT_ACTIVE');
      if (typeof testHooks.afterAccount === 'function') testHooks.afterAccount();
      const account = db.prepare("SELECT auth_version,access_version,row_version FROM vNext_accounts WHERE authority_id=? AND account_id=?").get(authorityId, selector.targetAccountId);
      return record({ outcome: 'accepted', code: 'ROLE_GRANTED', targetKind: 'role_grant', targetId: grantId, result: { code: 'ROLE_GRANTED', grantId, status: 'accepted' }, versions: { authVersion: account.auth_version, accessVersion: account.access_version, targetRowVersion: 1 }, outbox: { eventType: 'authorization.role_granted', grantId, aggregateVersion: 1, payload: { accountId: selector.targetAccountId, accessVersion: account.access_version, authVersion: account.auth_version, grantId, role: selector.role } } });
    }
    const grant = db.prepare("SELECT g.*,a.status AS account_status FROM vNext_role_grants g JOIN vNext_accounts a ON a.account_id=g.account_id AND a.authority_id=g.authority_id WHERE g.authority_id=? AND g.grant_id=?").get(authorityId, selector.targetGrantId);
    if (!grant || grant.account_status !== 'active') return record({ outcome: 'rejected', code: 'ROLE_GRANT_NOT_ACTIVE', targetKind: 'role_grant', targetId: selector.targetGrantId, result: { code: 'ROLE_GRANT_NOT_ACTIVE', status: 'rejected' } });
    if (grant.status === 'revoked') return record({ outcome: 'noop', code: 'ROLE_ALREADY_REVOKED', targetKind: 'role_grant', targetId: grant.grant_id, result: { code: 'ROLE_ALREADY_REVOKED', grantId: grant.grant_id, status: 'noop' } });
    if (grant.status !== 'active' || grant.row_version !== selector.expectedTargetRowVersion) return record({ outcome: 'rejected', code: 'ROLE_GRANT_VERSION_CONFLICT', targetKind: 'role_grant', targetId: grant.grant_id, result: { code: 'ROLE_GRANT_VERSION_CONFLICT', status: 'rejected' } });
    if (grant.role === 'super_admin') {
      const targetEffective = db.prepare("SELECT julianday(starts_at)<=julianday(?) AND (ends_at IS NULL OR julianday(ends_at)>julianday(?)) AS effective FROM vNext_role_grants WHERE authority_id=? AND grant_id=?").get(timestamp, timestamp, authorityId, grant.grant_id).effective === 1;
      if (targetEffective) {
        const activeAdmins = db.prepare("SELECT COUNT(*) AS count FROM vNext_role_grants g JOIN vNext_accounts a ON a.account_id=g.account_id AND a.authority_id=g.authority_id WHERE g.authority_id=? AND g.role='super_admin' AND g.status='active' AND a.status='active' AND julianday(g.starts_at)<=julianday(?) AND (g.ends_at IS NULL OR julianday(g.ends_at)>julianday(?))").get(authorityId, timestamp, timestamp).count;
        if (activeAdmins <= 1) return record({ outcome: 'rejected', code: 'LAST_SUPER_ADMIN_REVOKE_FORBIDDEN', targetKind: 'role_grant', targetId: grant.grant_id, result: { code: 'LAST_SUPER_ADMIN_REVOKE_FORBIDDEN', status: 'rejected' } });
      }
    }
    const targetChanged = db.prepare("UPDATE vNext_role_grants SET status='revoked',grant_version=grant_version+1,row_version=row_version+1,revoked_at=?,updated_at=? WHERE authority_id=? AND grant_id=? AND status='active' AND row_version=?").run(timestamp, timestamp, authorityId, grant.grant_id, selector.expectedTargetRowVersion);
    if (targetChanged.changes !== 1) return record({ outcome: 'rejected', code: 'ROLE_GRANT_VERSION_CONFLICT', targetKind: 'role_grant', targetId: grant.grant_id, result: { code: 'ROLE_GRANT_VERSION_CONFLICT', status: 'rejected' } });
    if (typeof testHooks.afterTarget === 'function') testHooks.afterTarget();
    const accountChanged = db.prepare("UPDATE vNext_accounts SET auth_version=auth_version+1,access_version=access_version+1,revocation_version=revocation_version+1,row_version=row_version+1,updated_at=? WHERE authority_id=? AND account_id=? AND status='active'").run(timestamp, authorityId, grant.account_id);
    if (accountChanged.changes !== 1) throw mutationError('TARGET_ACCOUNT_NOT_ACTIVE');
    if (typeof testHooks.afterAccount === 'function') testHooks.afterAccount();
    const account = db.prepare("SELECT auth_version,access_version,revocation_version FROM vNext_accounts WHERE authority_id=? AND account_id=?").get(authorityId, grant.account_id);
    return record({ outcome: 'accepted', code: 'ROLE_REVOKED', targetKind: 'role_grant', targetId: grant.grant_id, result: { code: 'ROLE_REVOKED', grantId: grant.grant_id, status: 'accepted' }, versions: { authVersion: account.auth_version, accessVersion: account.access_version, revocationVersion: account.revocation_version, targetRowVersion: grant.row_version + 1 }, outbox: { eventType: 'authorization.role_revoked', grantId: grant.grant_id, aggregateVersion: grant.row_version + 1, payload: { accessVersion: account.access_version, accountId: grant.account_id, grantId: grant.grant_id, revocationVersion: account.revocation_version } } });
  });
  return Object.freeze({ execute });
}

module.exports = { createVNextRoleGrantMutationReference };
