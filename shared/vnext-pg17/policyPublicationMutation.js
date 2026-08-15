'use strict';

const crypto = require('node:crypto');
const { types } = require('node:util');
const { isVNextPg17DisposableHandleForRuntime, withVNextPg17SyntheticQuery } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { isVNextPg17AccessContextResolverForHandle } = require('./accessContextResolver');
const policy = require('../vNextAuthorizationPolicyReference');

const COMMAND_KEYS = Object.freeze(['type', 'expectedPolicyRevision', 'idempotencyKey', 'reasonCode', 'manifest']);
const CONFIG_KEYS = Object.freeze(['runtime', 'handle', 'resolver', 'now', 'idFactory', 'testHooks']);
const HASH = /^[0-9a-f]{64}$/;

function failure(code) { return Object.assign(new Error(code), { code }); }
function sha256(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function stable(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw failure('POLICY_PUBLICATION_INPUT_INVALID');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function instant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}
function text(value, code = 'POLICY_PUBLICATION_INPUT_INVALID') {
  if (typeof value !== 'string' || value.trim() === '') throw failure(code);
  return value.trim();
}
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
function clonePlain(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw failure('POLICY_PUBLICATION_INPUT_INVALID'); return value; }
  if (!value || typeof value !== 'object' || types.isProxy(value) || seen.has(value)) throw failure('POLICY_PUBLICATION_INPUT_INVALID');
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) throw failure('POLICY_PUBLICATION_INPUT_INVALID');
    seen.add(value);
    const copy = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw failure('POLICY_PUBLICATION_INPUT_INVALID');
      copy.push(clonePlain(descriptor.value, seen));
    }
    seen.delete(value);
    return copy;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw failure('POLICY_PUBLICATION_INPUT_INVALID');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) throw failure('POLICY_PUBLICATION_INPUT_INVALID');
  seen.add(value);
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw failure('POLICY_PUBLICATION_INPUT_INVALID');
    copy[key] = clonePlain(descriptor.value, seen);
  }
  seen.delete(value);
  return copy;
}
function configSnapshot(value) {
  const copy = ownData(value, CONFIG_KEYS, ['runtime', 'handle', 'resolver', 'now', 'idFactory']);
  if (!copy || types.isProxy(copy.now) || types.isProxy(copy.idFactory) || typeof copy.now !== 'function' || typeof copy.idFactory !== 'function') return null;
  if (copy.testHooks !== undefined) {
    const hooks = ownData(copy.testHooks, ['afterWrite']);
    if (!hooks || types.isProxy(hooks.afterWrite) || typeof hooks.afterWrite !== 'function') return null;
  }
  return copy;
}
function commandSnapshot(value) {
  const copy = ownData(value, COMMAND_KEYS);
  if (!copy || Reflect.ownKeys(copy).length !== COMMAND_KEYS.length || copy.type !== 'authorization_policy.publish'
    || !Number.isSafeInteger(copy.expectedPolicyRevision) || copy.expectedPolicyRevision < 0) throw failure('POLICY_PUBLICATION_INPUT_INVALID');
  const canonicalManifestJson = policy.canonicalizePolicyManifest(clonePlain(copy.manifest));
  return Object.freeze({
    type: copy.type,
    expectedPolicyRevision: copy.expectedPolicyRevision,
    idempotencyKey: text(copy.idempotencyKey),
    reasonCode: text(copy.reasonCode),
    canonicalManifestJson,
    policyManifestSha256: sha256(canonicalManifestJson),
  });
}
function maintainsPolicyManagementCapability(canonicalManifestJson) {
  try {
    const manifest = JSON.parse(canonicalManifestJson);
    const capability = manifest.capabilities.find(item => item.capabilityId === 'access.manage');
    return !!capability && capability.status === 'active' && capability.allowedSurfaces.includes('desktop')
      && manifest.roleDefaults.super_admin.includes('access.manage');
  } catch (_) { return false; }
}
function parseResult(json, digest) {
  if (typeof json !== 'string' || !HASH.test(digest || '') || sha256(json) !== digest) throw failure('IDEMPOTENCY_RECEIPT_INVALID');
  let value;
  try { value = JSON.parse(json); } catch (_) { throw failure('IDEMPOTENCY_RECEIPT_INVALID'); }
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || stable(value) !== json) throw failure('IDEMPOTENCY_RECEIPT_INVALID');
  return value;
}
function exactResult(value, keys) {
  return !!value && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function requestFor(command) {
  return stable({ canonicalManifestJson: command.canonicalManifestJson, expectedPolicyRevision: command.expectedPolicyRevision, reasonCode: command.reasonCode, type: command.type });
}
function contextAllowed(context, timestamp) {
  return !!context && context.surface === 'desktop' && typeof context.authorityId === 'string' && typeof context.accountId === 'string'
    && Array.isArray(context.roles) && context.roles.includes('super_admin')
    && Array.isArray(context.capabilityIds) && context.capabilityIds.includes('access.manage')
    && instant(context.reauthenticatedUntil) && Date.parse(context.reauthenticatedUntil) > Date.parse(timestamp);
}

function createVNextPg17PolicyPublicationMutation(config) {
  const settings = configSnapshot(config);
  if (!settings || !isVNextPg17DisposableHandleForRuntime(settings.runtime, settings.handle)
    || !isVNextPg17AccessContextResolverForHandle(settings.resolver, settings.handle)) throw failure('POLICY_PUBLICATION_WRITER_INVALID');
  const catalog = createVNextPg17CatalogBoundary(settings.runtime);
  const nextId = kind => text(settings.idFactory(kind), 'POLICY_PUBLICATION_ID_INVALID');
  const hook = async stage => { if (settings.testHooks) await settings.testHooks.afterWrite(Object.freeze({ stage })); };

  async function replay(facade, receipt, command, authorityId, actorAccountId, requestHash) {
    if (receipt.canonical_request_sha256 !== requestHash || receipt.actor_key !== `account:${actorAccountId}`
      || receipt.actor_account_id !== actorAccountId || receipt.command_type !== command.type
      || receipt.target_kind !== 'authorization_policy' || receipt.target_id !== authorityId
      || String(receipt.expected_row_version) !== String(command.expectedPolicyRevision)) throw failure('IDEMPOTENCY_RECEIPT_INVALID');
    const result = parseResult(receipt.canonical_result_json, receipt.canonical_result_sha256);
    const auditResult = await facade.query('SELECT reason_code,context_sha256 FROM vnext_control_plane.vnext_authorization_audit_events WHERE authority_id=$1 AND receipt_id=$2', [authorityId, receipt.receipt_id]);
    const publicationResult = await facade.query('SELECT publication_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256 FROM vnext_control_plane.vnext_authorization_policy_publications WHERE authority_id=$1 AND receipt_id=$2', [authorityId, receipt.receipt_id]);
    const outboxResult = await facade.query('SELECT event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256 FROM vnext_control_plane.vnext_authorization_outbox_events WHERE authority_id=$1 AND receipt_id=$2', [authorityId, receipt.receipt_id]);
    const accepted = exactResult(result, ['authorityId', 'code', 'policyContractVersion', 'policyManifestSha256', 'policyRevision', 'publicationId', 'status'])
      && result.authorityId === authorityId && result.code === 'POLICY_PUBLISHED' && result.policyContractVersion === 1
      && result.policyManifestSha256 === command.policyManifestSha256 && Number.isSafeInteger(result.policyRevision)
      && result.policyRevision >= 1 && typeof result.publicationId === 'string' && result.status === 'accepted'
      && receipt.outcome === 'accepted' && receipt.result_code === 'POLICY_PUBLISHED'
      && receipt.committed_auth_version === null && receipt.committed_access_version === null && receipt.committed_revocation_version === null
      && String(receipt.committed_target_row_version) === String(result.policyRevision)
      && publicationResult.rows.length === 1 && publicationResult.rows[0].publication_id === result.publicationId
      && String(publicationResult.rows[0].policy_revision) === String(result.policyRevision)
      && String(publicationResult.rows[0].policy_contract_version) === '1'
      && publicationResult.rows[0].canonical_manifest_json === command.canonicalManifestJson
      && publicationResult.rows[0].policy_manifest_sha256 === command.policyManifestSha256;
    const noop = exactResult(result, ['code', 'policyRevision', 'status']) && result.code === 'POLICY_UNCHANGED'
      && Number.isSafeInteger(result.policyRevision) && result.status === 'noop' && receipt.outcome === 'noop'
      && receipt.result_code === 'POLICY_UNCHANGED' && receipt.committed_auth_version === null
      && receipt.committed_access_version === null && receipt.committed_revocation_version === null
      && receipt.committed_target_row_version === null && publicationResult.rows.length === 0 && outboxResult.rows.length === 0;
    const rejected = exactResult(result, ['code', 'policyRevision', 'status'])
      && ['FIRST_POLICY_BOOTSTRAP_REQUIRED', 'POLICY_REVISION_CONFLICT'].includes(result.code)
      && Number.isSafeInteger(result.policyRevision) && result.status === 'rejected' && receipt.outcome === 'rejected'
      && receipt.result_code === result.code && receipt.committed_auth_version === null
      && receipt.committed_access_version === null && receipt.committed_revocation_version === null
      && receipt.committed_target_row_version === null && publicationResult.rows.length === 0 && outboxResult.rows.length === 0;
    const contextRevision = accepted ? result.policyRevision - 1 : result.policyRevision;
    if ((!accepted && !noop && !rejected) || auditResult.rows.length !== 1
      || auditResult.rows[0].reason_code !== command.reasonCode
      || auditResult.rows[0].context_sha256 !== sha256(stable({ accountId: actorAccountId, policyRevision: contextRevision }))) throw failure('IDEMPOTENCY_RECEIPT_INVALID');
    if (accepted) {
      const payload = stable({ authorityId, policyManifestSha256: command.policyManifestSha256, policyRevision: result.policyRevision });
      const outbox = outboxResult.rows[0];
      if (outboxResult.rows.length !== 1 || outbox.event_type !== 'authorization_policy.published'
        || outbox.aggregate_kind !== 'authorization_policy' || outbox.aggregate_id !== authorityId
        || String(outbox.aggregate_version) !== String(result.policyRevision)
        || outbox.canonical_payload_json !== payload || outbox.payload_sha256 !== sha256(payload)) throw failure('IDEMPOTENCY_RECEIPT_INVALID');
    }
    return Object.freeze({ code: result.code, policyRevision: result.policyRevision, replayed: true, status: result.status });
  }

  async function execute(assertion, input) {
    const command = commandSnapshot(input);
    let context;
    try { context = await settings.resolver.resolve(assertion); } catch (_) { throw failure('POLICY_PUBLICATION_UNAUTHORIZED'); }
    let timestamp;
    try { timestamp = settings.now(); } catch (_) { throw failure('POLICY_PUBLICATION_INPUT_INVALID'); }
    if (!instant(timestamp) || !contextAllowed(context, timestamp)) throw failure('POLICY_PUBLICATION_UNAUTHORIZED');
    const authorityId = text(context.authorityId, 'POLICY_PUBLICATION_UNAUTHORIZED');
    const actorAccountId = text(context.accountId, 'POLICY_PUBLICATION_UNAUTHORIZED');
    const requestJson = requestFor(command);
    const requestHash = sha256(requestJson);
    await catalog.assert(settings.handle);
    return withVNextPg17SyntheticQuery(settings.handle, 'fixture-provisioner', async facade => {
      try {
        await facade.query('BEGIN');
        await facade.query("SELECT pg_advisory_xact_lock(hashtextextended('vnext:policy:' || $1, 0))", [authorityId]);
        const existing = await facade.query('SELECT * FROM vnext_control_plane.vnext_authorization_command_receipts WHERE authority_id=$1 AND actor_key=$2 AND idempotency_key=$3 FOR UPDATE', [authorityId, `account:${actorAccountId}`, command.idempotencyKey]);
        if (existing.rows.length === 1) {
          if (existing.rows[0].canonical_request_sha256 !== requestHash) throw failure('IDEMPOTENCY_KEY_CONFLICT');
          const replayed = await replay(facade, existing.rows[0], command, authorityId, actorAccountId, requestHash);
          await facade.query('COMMIT');
          return replayed;
        }
        const authority = await facade.query("SELECT authority_id FROM vnext_control_plane.vnext_authorities WHERE authority_id=$1 AND status='active' FOR UPDATE", [authorityId]);
        const actor = await facade.query("SELECT account_id FROM vnext_control_plane.vnext_accounts WHERE authority_id=$1 AND account_id=$2 AND status='active' FOR UPDATE", [authorityId, actorAccountId]);
        if (authority.rows.length !== 1 || actor.rows.length !== 1) throw failure('POLICY_PUBLICATION_UNAUTHORIZED');
        const currentResult = await facade.query('SELECT policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256 FROM vnext_control_plane.vnext_authorization_policy_publications WHERE authority_id=$1 ORDER BY policy_revision DESC LIMIT 1 FOR UPDATE', [authorityId]);
        const current = currentResult.rows[0] || null;
        const currentRevision = current ? Number(current.policy_revision) : 0;
        const receiptId = nextId('policy-receipt');
        const auditId = nextId('policy-audit');
        const record = async ({ outcome, code, result, publicationId = null, publish = false }) => {
          const resultJson = stable(result);
          const committedTarget = publish ? result.policyRevision : null;
          await facade.query('INSERT INTO vnext_control_plane.vnext_authorization_command_receipts(receipt_id,authority_id,actor_key,actor_account_id,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_auth_version,committed_access_version,committed_revocation_version,committed_target_row_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,NULL,NULL,$15,$16)', [receiptId, authorityId, `account:${actorAccountId}`, actorAccountId, command.idempotencyKey, command.type, 'authorization_policy', authorityId, requestHash, command.expectedPolicyRevision, outcome, code, resultJson, sha256(resultJson), committedTarget, timestamp]);
          await hook('receipt');
          if (publish) {
            await facade.query('INSERT INTO vnext_control_plane.vnext_authorization_policy_publications(publication_id,authority_id,receipt_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256,published_at) VALUES($1,$2,$3,$4,1,$5,$6,$7)', [publicationId, authorityId, receiptId, result.policyRevision, command.canonicalManifestJson, command.policyManifestSha256, timestamp]);
            await hook('publication');
          }
          const contextRevision = publish ? result.policyRevision - 1 : result.policyRevision;
          await facade.query('INSERT INTO vnext_control_plane.vnext_authorization_audit_events(event_id,authority_id,receipt_id,reason_code,context_sha256,created_at) VALUES($1,$2,$3,$4,$5,$6)', [auditId, authorityId, receiptId, command.reasonCode, sha256(stable({ accountId: actorAccountId, policyRevision: contextRevision })), timestamp]);
          await hook('audit');
          if (publish) {
            const payload = stable({ authorityId, policyManifestSha256: command.policyManifestSha256, policyRevision: result.policyRevision });
            await facade.query("INSERT INTO vnext_control_plane.vnext_authorization_outbox_events(event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at) VALUES($1,$2,$3,'authorization_policy.published','authorization_policy',$2,$4,$5,$6,$7)", [nextId('policy-outbox'), authorityId, receiptId, result.policyRevision, payload, sha256(payload), timestamp]);
            await hook('outbox');
          }
          return Object.freeze({ code, policyRevision: result.policyRevision, replayed: false, status: outcome });
        };
        if (command.expectedPolicyRevision === 0) {
          const value = await record({ outcome: 'rejected', code: 'FIRST_POLICY_BOOTSTRAP_REQUIRED', result: { code: 'FIRST_POLICY_BOOTSTRAP_REQUIRED', policyRevision: currentRevision, status: 'rejected' } });
          await facade.query('COMMIT');
          return value;
        }
        if (!current || command.expectedPolicyRevision !== currentRevision) {
          const value = await record({ outcome: 'rejected', code: 'POLICY_REVISION_CONFLICT', result: { code: 'POLICY_REVISION_CONFLICT', policyRevision: currentRevision, status: 'rejected' } });
          await facade.query('COMMIT');
          return value;
        }
        if (!maintainsPolicyManagementCapability(command.canonicalManifestJson)) throw failure('POLICY_MANAGEMENT_CAPABILITY_REQUIRED');
        if (String(current.policy_contract_version) === '1' && current.canonical_manifest_json === command.canonicalManifestJson && current.policy_manifest_sha256 === command.policyManifestSha256) {
          const value = await record({ outcome: 'noop', code: 'POLICY_UNCHANGED', result: { code: 'POLICY_UNCHANGED', policyRevision: currentRevision, status: 'noop' } });
          await facade.query('COMMIT');
          return value;
        }
        const nextRevision = currentRevision + 1;
        const publicationId = nextId('policy-publication');
        const value = await record({ outcome: 'accepted', code: 'POLICY_PUBLISHED', publicationId, publish: true, result: { authorityId, code: 'POLICY_PUBLISHED', policyContractVersion: 1, policyManifestSha256: command.policyManifestSha256, policyRevision: nextRevision, publicationId, status: 'accepted' } });
        await facade.query('COMMIT');
        return value;
      } catch (error) {
        try { await facade.query('ROLLBACK'); } catch (_) { /* no-op */ }
        if (error && typeof error.code === 'string' && /^(POLICY_|IDEMPOTENCY_)/.test(error.code)) throw error;
        throw failure('POLICY_PUBLICATION_UNAVAILABLE');
      }
    });
  }
  return Object.freeze({ execute });
}

module.exports = Object.freeze({ createVNextPg17PolicyPublicationMutation });
