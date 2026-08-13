'use strict';

const crypto = require('crypto');
const { assertVNextControlPlaneReferenceSchema } = require('./vNextControlPlaneReferenceKernel');
const policy = require('./vNextAuthorizationPolicyReference');
const { isVNextAccessContextResolverReferenceForDatabase } = require('./vNextAccessContextResolverReference');
const { types } = require('node:util');

const INPUT_KEYS = new Set(['type', 'expectedPolicyRevision', 'idempotencyKey', 'reasonCode', 'manifest']);
const ERROR = code => Object.assign(new Error(code), { code });
const sha256 = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const frozen = value => Object.freeze(value);

function stableJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw ERROR('POLICY_PUBLICATION_INPUT_INVALID'); return JSON.stringify(value); }
  if (typeof value === 'bigint' || typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') throw ERROR('POLICY_PUBLICATION_INPUT_INVALID');
  if (Array.isArray(value)) {
    if (seen.has(value) || Object.keys(value).length !== value.length) throw ERROR('POLICY_PUBLICATION_INPUT_INVALID');
    seen.add(value); const json = `[${value.map(item => stableJson(item, seen)).join(',')}]`; seen.delete(value); return json;
  }
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || seen.has(value)) throw ERROR('POLICY_PUBLICATION_INPUT_INVALID');
  seen.add(value); const json = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key], seen)}`).join(',')}}`; seen.delete(value); return json;
}
function text(value, code) { const result = typeof value === 'string' ? value.trim() : ''; if (!result) throw ERROR(code); return result; }
function instant(value) { if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) throw ERROR('POLICY_PUBLICATION_UNAUTHORIZED'); return Date.parse(value); }
function exactConfig(config) {
  if (!config || typeof config !== 'object' || types.isProxy(config) || Object.getPrototypeOf(config) !== Object.prototype) return null;
  const allowed = new Set(['db', 'resolver', 'now', 'idFactory', 'testHooks']); const keys = Reflect.ownKeys(config);
  if (keys.some(key => typeof key !== 'string' || !allowed.has(key)) || !['db', 'resolver'].every(key => keys.includes(key))) return null;
  const values = {};
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(config, key); if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null; values[key] = descriptor.value; }
  return values;
}
function exactCommand(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== INPUT_KEYS.size || [...INPUT_KEYS].some(key => !Object.hasOwn(value, key))) throw ERROR('POLICY_PUBLICATION_INPUT_INVALID');
  const snapshot = {};
  for (const key of INPUT_KEYS) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw ERROR('POLICY_PUBLICATION_INPUT_INVALID'); snapshot[key] = descriptor.value; }
  if (snapshot.type !== 'authorization_policy.publish' || !Number.isInteger(snapshot.expectedPolicyRevision) || snapshot.expectedPolicyRevision < 0) throw ERROR('POLICY_PUBLICATION_INPUT_INVALID');
  const canonicalManifestJson = policy.canonicalizePolicyManifest(clonePlainData(snapshot.manifest));
  try {
    if (policy.canonicalizePolicyManifest(JSON.parse(canonicalManifestJson)) !== canonicalManifestJson) throw ERROR('POLICY_PUBLICATION_INPUT_INVALID');
  } catch (error) {
    if (error && error.code === 'POLICY_PUBLICATION_INPUT_INVALID') throw error;
    throw ERROR('POLICY_PUBLICATION_INPUT_INVALID');
  }
  return frozen({ type: snapshot.type, expectedPolicyRevision: snapshot.expectedPolicyRevision, idempotencyKey: text(snapshot.idempotencyKey, 'POLICY_PUBLICATION_INPUT_INVALID'), reasonCode: text(snapshot.reasonCode, 'POLICY_PUBLICATION_INPUT_INVALID'), canonicalManifestJson, policyManifestSha256: sha256(canonicalManifestJson) });
}
function clonePlainData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value !== 'object' || types.isProxy(value) || seen.has(value)) throw ERROR('POLICY_PUBLICATION_INPUT_INVALID');
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) throw ERROR('POLICY_PUBLICATION_INPUT_INVALID');
    seen.add(value); const copy = [];
    for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw ERROR('POLICY_PUBLICATION_INPUT_INVALID'); copy.push(clonePlainData(descriptor.value, seen)); }
    seen.delete(value); return copy;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw ERROR('POLICY_PUBLICATION_INPUT_INVALID');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) throw ERROR('POLICY_PUBLICATION_INPUT_INVALID');
  seen.add(value); const copy = {};
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw ERROR('POLICY_PUBLICATION_INPUT_INVALID'); copy[key] = clonePlainData(descriptor.value, seen); }
  seen.delete(value); return copy;
}
function parseResult(json, hash) {
  if (sha256(json) !== hash) throw ERROR('IDEMPOTENCY_RECEIPT_INVALID');
  let result; try { result = JSON.parse(json); } catch { throw ERROR('IDEMPOTENCY_RECEIPT_INVALID'); }
  if (!result || Object.getPrototypeOf(result) !== Object.prototype || stableJson(result) !== json || typeof result.code !== 'string' || typeof result.status !== 'string') throw ERROR('IDEMPOTENCY_RECEIPT_INVALID');
  return result;
}
function maintainsPolicyManagementCapability(manifest) {
  const parsed = JSON.parse(manifest);
  const capability = parsed.capabilities.find(item => item.capabilityId === 'access.manage');
  return !!capability && capability.status === 'active' && capability.allowedSurfaces.includes('desktop') && parsed.roleDefaults.super_admin.includes('access.manage');
}

function createVNextPolicyPublicationMutationReference(config) {
  const values = exactConfig(config);
  const { db, resolver, now = () => new Date().toISOString(), idFactory = kind => `${kind}-${crypto.randomUUID()}`, testHooks = {} } = values || {};
  if (!db || ['prepare', 'transaction', 'pragma', 'exec'].some(key => typeof db[key] !== 'function') || !isVNextAccessContextResolverReferenceForDatabase(resolver, db) || typeof now !== 'function' || typeof idFactory !== 'function' || !testHooks || Object.getPrototypeOf(testHooks) !== Object.prototype) throw ERROR('POLICY_PUBLICATION_CONFIGURATION_INVALID');
  const nextId = kind => text(idFactory(kind), 'POLICY_PUBLICATION_ID_INVALID');

  const execute = db.transaction((assertion, input) => {
    assertVNextControlPlaneReferenceSchema(db);
    const command = exactCommand(input);
    let context;
    try { context = resolver.resolve(assertion); } catch { throw ERROR('POLICY_PUBLICATION_UNAUTHORIZED'); }
    const timestamp = now();
    const nowMillis = instant(timestamp);
    if (!context || context.surface !== 'desktop' || !Array.isArray(context.roles) || !context.roles.includes('super_admin') || !Array.isArray(context.capabilityIds) || !context.capabilityIds.includes('access.manage') || context.reauthenticatedUntil === null || instant(context.reauthenticatedUntil) <= nowMillis) throw ERROR('POLICY_PUBLICATION_UNAUTHORIZED');
    const authorityId = text(context.authorityId, 'POLICY_PUBLICATION_UNAUTHORIZED');
    const actorAccountId = text(context.accountId, 'POLICY_PUBLICATION_UNAUTHORIZED');
    const actorKey = `account:${actorAccountId}`;
    const authority = db.prepare("SELECT authority_id FROM vNext_authorities WHERE authority_id=? AND status='active'").get(authorityId);
    const actor = db.prepare("SELECT account_id FROM vNext_accounts WHERE authority_id=? AND account_id=? AND status='active'").get(authorityId, actorAccountId);
    if (!authority || !actor) throw ERROR('POLICY_PUBLICATION_UNAUTHORIZED');
    const requestJson = stableJson({ type: command.type, expectedPolicyRevision: command.expectedPolicyRevision, reasonCode: command.reasonCode, canonicalManifestJson: command.canonicalManifestJson });
    const requestHash = sha256(requestJson);
    const existing = db.prepare('SELECT * FROM vNext_authorization_command_receipts WHERE authority_id=? AND actor_key=? AND idempotency_key=?').get(authorityId, actorKey, command.idempotencyKey);
    if (existing) {
      if (existing.canonical_request_sha256 !== requestHash) throw ERROR('IDEMPOTENCY_KEY_CONFLICT');
      const result = parseResult(existing.canonical_result_json, existing.canonical_result_sha256);
      const audit = db.prepare('SELECT reason_code,context_sha256 FROM vNext_authorization_audit_events WHERE authority_id=? AND receipt_id=?').all(authorityId, existing.receipt_id);
      const outbox = db.prepare('SELECT event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256 FROM vNext_authorization_outbox_events WHERE authority_id=? AND receipt_id=?').all(authorityId, existing.receipt_id);
      const publication = db.prepare('SELECT publication_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256 FROM vNext_authorization_policy_publications WHERE authority_id=? AND receipt_id=?').get(authorityId, existing.receipt_id);
      const accepted = Object.keys(result).length === 7 && result.authorityId === authorityId && result.code === 'POLICY_PUBLISHED' && result.policyContractVersion === 1 && result.policyManifestSha256 === command.policyManifestSha256 && result.policyRevision === existing.committed_target_row_version && typeof result.publicationId === 'string' && result.status === 'accepted' && existing.outcome === 'accepted' && existing.result_code === 'POLICY_PUBLISHED' && existing.committed_auth_version === null && existing.committed_access_version === null && existing.committed_revocation_version === null && publication && publication.publication_id === result.publicationId && publication.policy_revision === result.policyRevision && publication.policy_contract_version === 1 && publication.canonical_manifest_json === command.canonicalManifestJson && publication.policy_manifest_sha256 === command.policyManifestSha256;
      const noop = Object.keys(result).length === 3 && result.status === 'noop' && result.code === 'POLICY_UNCHANGED' && result.policyRevision === command.expectedPolicyRevision && existing.outcome === 'noop' && existing.result_code === 'POLICY_UNCHANGED' && existing.committed_target_row_version === null && existing.committed_auth_version === null && existing.committed_access_version === null && existing.committed_revocation_version === null && !publication && outbox.length === 0;
      const rejected = Object.keys(result).length === 3 && result.status === 'rejected' && ((result.code === 'FIRST_POLICY_BOOTSTRAP_REQUIRED' && command.expectedPolicyRevision === 0) || (result.code === 'POLICY_REVISION_CONFLICT' && command.expectedPolicyRevision > 0)) && existing.outcome === 'rejected' && existing.result_code === result.code && existing.committed_target_row_version === null && existing.committed_auth_version === null && existing.committed_access_version === null && existing.committed_revocation_version === null && !publication && outbox.length === 0;
      const contextPolicyRevision = accepted ? result.policyRevision - 1 : result.policyRevision;
      if (!Number.isInteger(contextPolicyRevision) || contextPolicyRevision < 0 || existing.actor_account_id !== actorAccountId || existing.command_type !== command.type || existing.target_kind !== 'authorization_policy' || existing.target_id !== authorityId || existing.expected_row_version !== command.expectedPolicyRevision || audit.length !== 1 || audit[0].reason_code !== command.reasonCode || audit[0].context_sha256 !== sha256(stableJson({ accountId: actorAccountId, policyRevision: contextPolicyRevision })) || (!accepted && !noop && !rejected)) throw ERROR('IDEMPOTENCY_RECEIPT_INVALID');
      if (accepted) {
        const payloadJson = stableJson({ authorityId, policyManifestSha256: command.policyManifestSha256, policyRevision: result.policyRevision });
        if (outbox.length !== 1 || outbox[0].event_type !== 'authorization_policy.published' || outbox[0].aggregate_kind !== 'authorization_policy' || outbox[0].aggregate_id !== authorityId || outbox[0].aggregate_version !== result.policyRevision || outbox[0].canonical_payload_json !== payloadJson || outbox[0].payload_sha256 !== sha256(payloadJson)) throw ERROR('IDEMPOTENCY_RECEIPT_INVALID');
      }
      return frozen({ code: result.code, policyRevision: result.policyRevision, replayed: true, status: result.status });
    }
    const current = db.prepare('SELECT policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256 FROM vNext_authorization_policy_publications WHERE authority_id=? ORDER BY policy_revision DESC LIMIT 1').get(authorityId);
    const currentRevision = current ? current.policy_revision : 0;
    const record = ({ outcome, code, result, committedTargetRowVersion = null, publication = null, outbox = false }) => {
      const resultJson = stableJson(result); const receiptId = nextId('policy-receipt');
      db.prepare('INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,actor_account_id,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_target_row_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(receiptId, authorityId, actorKey, actorAccountId, command.idempotencyKey, command.type, 'authorization_policy', authorityId, requestHash, command.expectedPolicyRevision, outcome, code, resultJson, sha256(resultJson), committedTargetRowVersion, timestamp);
      if (typeof testHooks.afterReceipt === 'function') testHooks.afterReceipt();
      if (publication) {
        db.prepare('INSERT INTO vNext_authorization_policy_publications(publication_id,authority_id,receipt_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256,published_at) VALUES(?,?,?,?,?,?,?,?)').run(publication.publicationId, authorityId, receiptId, publication.policyRevision, 1, command.canonicalManifestJson, command.policyManifestSha256, timestamp);
        if (typeof testHooks.afterPublication === 'function') testHooks.afterPublication();
      }
      db.prepare('INSERT INTO vNext_authorization_audit_events(event_id,authority_id,receipt_id,reason_code,context_sha256,created_at) VALUES(?,?,?,?,?,?)').run(nextId('policy-audit'), authorityId, receiptId, command.reasonCode, sha256(stableJson({ accountId: actorAccountId, policyRevision: currentRevision })), timestamp);
      if (typeof testHooks.afterAudit === 'function') testHooks.afterAudit();
      if (outbox) {
        const payload = { authorityId, policyManifestSha256: command.policyManifestSha256, policyRevision: publication.policyRevision }; const payloadJson = stableJson(payload);
        db.prepare('INSERT INTO vNext_authorization_outbox_events(event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(nextId('policy-outbox'), authorityId, receiptId, 'authorization_policy.published', 'authorization_policy', authorityId, publication.policyRevision, payloadJson, sha256(payloadJson), timestamp);
        if (typeof testHooks.afterOutbox === 'function') testHooks.afterOutbox();
      }
      return frozen({ code, policyRevision: result.policyRevision, replayed: false, status: outcome });
    };
    if (command.expectedPolicyRevision === 0) return record({ outcome: 'rejected', code: 'FIRST_POLICY_BOOTSTRAP_REQUIRED', result: { code: 'FIRST_POLICY_BOOTSTRAP_REQUIRED', policyRevision: currentRevision, status: 'rejected' } });
    if (!current || command.expectedPolicyRevision !== currentRevision) return record({ outcome: 'rejected', code: 'POLICY_REVISION_CONFLICT', result: { code: 'POLICY_REVISION_CONFLICT', policyRevision: currentRevision, status: 'rejected' } });
    if (!maintainsPolicyManagementCapability(command.canonicalManifestJson)) throw ERROR('POLICY_MANAGEMENT_CAPABILITY_REQUIRED');
    if (current.policy_contract_version === 1 && current.policy_manifest_sha256 === command.policyManifestSha256 && current.canonical_manifest_json === command.canonicalManifestJson) return record({ outcome: 'noop', code: 'POLICY_UNCHANGED', result: { code: 'POLICY_UNCHANGED', policyRevision: currentRevision, status: 'noop' } });
    const nextRevision = currentRevision + 1; const publicationId = nextId('policy-publication');
    return record({ outcome: 'accepted', code: 'POLICY_PUBLISHED', committedTargetRowVersion: nextRevision, publication: { publicationId, policyRevision: nextRevision }, outbox: true, result: { authorityId, code: 'POLICY_PUBLISHED', policyContractVersion: 1, policyManifestSha256: command.policyManifestSha256, policyRevision: nextRevision, publicationId, status: 'accepted' } });
  });
  return frozen({ execute });
}

module.exports = frozen({ createVNextPolicyPublicationMutationReference });
