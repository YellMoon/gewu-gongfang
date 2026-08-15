'use strict';

const crypto = require('node:crypto');
const { types } = require('node:util');
const {
  isVNextPg17DisposableHandleForRuntime,
  withVNextPg17SyntheticQuery,
} = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { isVNextTrustRootVerifierBoundaryReferenceForDatabase } = require('../vNextTrustRootVerifierBoundaryReference');
const policy = require('../vNextAuthorizationPolicyReference');

const COMMAND_KEYS = Object.freeze(['type', 'bootstrapIntentId', 'authorityId', 'accountId', 'deviceId', 'installationId', 'installationPublicKey', 'installationKeyFingerprint', 'policyManifest', 'idempotencyKey', 'reasonCode']);
const HASH = /^[0-9a-f]{64}$/;

function failure(code) { return Object.assign(new Error(code), { code }); }
function sha256(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function stable(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw failure('BOOTSTRAP_INPUT_INVALID');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function isInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}
function ownData(value, keys) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return null;
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    copy[key] = descriptor.value;
  }
  return copy;
}
function clonePlain(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw failure('BOOTSTRAP_INPUT_INVALID'); return value; }
  if (!value || typeof value !== 'object' || types.isProxy(value) || seen.has(value)) throw failure('BOOTSTRAP_INPUT_INVALID');
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) throw failure('BOOTSTRAP_INPUT_INVALID');
    seen.add(value);
    const copy = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw failure('BOOTSTRAP_INPUT_INVALID');
      copy.push(clonePlain(descriptor.value, seen));
    }
    seen.delete(value);
    return copy;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw failure('BOOTSTRAP_INPUT_INVALID');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) throw failure('BOOTSTRAP_INPUT_INVALID');
  seen.add(value);
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw failure('BOOTSTRAP_INPUT_INVALID');
    copy[key] = clonePlain(descriptor.value, seen);
  }
  seen.delete(value);
  return copy;
}
function nonblank(value) {
  if (typeof value !== 'string' || value.trim() === '') throw failure('BOOTSTRAP_INPUT_INVALID');
  return value.trim();
}
function snapshotCommand(value) {
  const copy = ownData(value, COMMAND_KEYS);
  if (!copy || copy.type !== 'authority.bootstrap') throw failure('BOOTSTRAP_INPUT_INVALID');
  for (const key of COMMAND_KEYS) if (key !== 'type' && key !== 'policyManifest') copy[key] = nonblank(copy[key]);
  if (!HASH.test(copy.installationKeyFingerprint)) throw failure('BOOTSTRAP_INPUT_INVALID');
  const canonicalManifestJson = policy.canonicalizePolicyManifest(clonePlain(copy.policyManifest));
  return Object.freeze({ ...copy, canonicalManifestJson, policyManifestSha256: sha256(canonicalManifestJson) });
}
function configSnapshot(value) {
  const keys = ['runtime', 'handle', 'verifierBoundary', 'now', 'idFactory', 'testHooks'];
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const own = Reflect.ownKeys(value);
  if (own.some(key => typeof key !== 'string' || !keys.includes(key)) || !['runtime', 'handle', 'verifierBoundary', 'now', 'idFactory'].every(key => own.includes(key))) return null;
  const copy = {};
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    copy[key] = descriptor.value;
  }
  if (types.isProxy(copy.now) || types.isProxy(copy.idFactory) || types.isProxy(copy.testHooks)
    || typeof copy.now !== 'function' || typeof copy.idFactory !== 'function') return null;
  if (copy.testHooks !== undefined) {
    const hooks = ownData(copy.testHooks, ['afterWrite']);
    if (!hooks || types.isProxy(hooks.afterWrite) || typeof hooks.afterWrite !== 'function') return null;
  }
  return copy;
}
function resultFor(command, publicationId) {
  return {
    authorityId: command.authorityId,
    code: 'AUTHORITY_BOOTSTRAPPED',
    policyContractVersion: 1,
    policyManifestSha256: command.policyManifestSha256,
    policyRevision: 1,
    publicationId,
    status: 'accepted',
  };
}
function parseResult(json, digest) {
  if (typeof json !== 'string' || sha256(json) !== digest) throw failure('IDEMPOTENCY_RECEIPT_INVALID');
  let value;
  try { value = JSON.parse(json); } catch { throw failure('IDEMPOTENCY_RECEIPT_INVALID'); }
  const keys = ['authorityId', 'code', 'policyContractVersion', 'policyManifestSha256', 'policyRevision', 'publicationId', 'status'];
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || stable(value) !== json || Reflect.ownKeys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key)) || typeof value.authorityId !== 'string'
    || value.code !== 'AUTHORITY_BOOTSTRAPPED' || value.policyContractVersion !== 1
    || typeof value.policyManifestSha256 !== 'string' || value.policyRevision !== 1
    || typeof value.publicationId !== 'string' || value.status !== 'accepted') throw failure('IDEMPOTENCY_RECEIPT_INVALID');
  return value;
}
function requestFor(command) {
  return stable({
    accountId: command.accountId, authorityId: command.authorityId, bootstrapIntentId: command.bootstrapIntentId,
    canonicalManifestJson: command.canonicalManifestJson, deviceId: command.deviceId, idempotencyKey: command.idempotencyKey,
    installationId: command.installationId, installationKeyFingerprint: command.installationKeyFingerprint,
    installationPublicKey: command.installationPublicKey, reasonCode: command.reasonCode, type: command.type,
  });
}
function proofMatches(proof, command, timestamp) {
  return proof && proof.kind === 'deployment_bootstrap' && isInstant(timestamp) && isInstant(proof.expiresAt)
    && Date.parse(proof.expiresAt) > Date.parse(timestamp)
    && proof.bootstrapIntentId === command.bootstrapIntentId && proof.authorityId === command.authorityId
    && proof.accountId === command.accountId && proof.deviceId === command.deviceId
    && proof.installationId === command.installationId && proof.installationPublicKey === command.installationPublicKey
    && proof.installationKeyFingerprint === command.installationKeyFingerprint
    && proof.policyManifestSha256 === command.policyManifestSha256;
}

function createVNextPg17FirstAuthorityBootstrapMutation(config) {
  const settings = configSnapshot(config);
  if (!settings || !isVNextPg17DisposableHandleForRuntime(settings.runtime, settings.handle)
    || !isVNextTrustRootVerifierBoundaryReferenceForDatabase(settings.verifierBoundary, settings.handle)) throw failure('BOOTSTRAP_WRITER_INVALID');
  const catalog = createVNextPg17CatalogBoundary(settings.runtime);
  const hook = stage => { if (settings.testHooks) settings.testHooks.afterWrite(Object.freeze({ stage })); };
  const nextId = kind => nonblank(settings.idFactory(kind));

  async function execute(assertion, input) {
    const command = snapshotCommand(input);
    let proof;
    try { proof = settings.verifierBoundary.unwrap(assertion, 'deployment_bootstrap'); } catch { throw failure('BOOTSTRAP_ASSERTION_MISMATCH'); }
    let timestamp;
    try { timestamp = settings.now(); } catch { throw failure('BOOTSTRAP_INPUT_INVALID'); }
    if (!proofMatches(proof, command, timestamp)) throw failure('BOOTSTRAP_ASSERTION_MISMATCH');
    const requestJson = requestFor(command);
    const requestHash = sha256(requestJson);
    await catalog.assert(settings.handle);
    return withVNextPg17SyntheticQuery(settings.handle, 'fixture-provisioner', async facade => {
      try {
        await facade.query('BEGIN');
        await facade.query("SELECT pg_advisory_xact_lock(hashtextextended('vnext:first-authority-bootstrap', 0))");
        const actorKey = `bootstrap:${command.bootstrapIntentId}`;
        const existing = await facade.query('SELECT * FROM vnext_control_plane.vnext_authorization_command_receipts WHERE authority_id=$1 AND actor_key=$2 AND idempotency_key=$3', [command.authorityId, actorKey, command.idempotencyKey]);
        if (existing.rows.length === 1) {
          const receipt = existing.rows[0];
          if (receipt.canonical_request_sha256 !== requestHash) throw failure('IDEMPOTENCY_KEY_CONFLICT');
          const result = parseResult(receipt.canonical_result_json, receipt.canonical_result_sha256);
          const payload = stable({ authorityId: command.authorityId, policyManifestSha256: command.policyManifestSha256, policyRevision: 1 });
          const contextHash = sha256(stable({ authorityId: command.authorityId, policyManifestSha256: command.policyManifestSha256 }));
          const chain = await facade.query("SELECT (SELECT count(*)::text FROM vnext_control_plane.vnext_authorities WHERE authority_id=$1 AND status='active') AS authority_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_accounts WHERE authority_id=$1 AND account_id=$2 AND status='active' AND auth_version=1 AND access_version=1 AND revocation_version=1 AND row_version=1) AS account_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_trusted_devices WHERE authority_id=$1 AND device_id=$3 AND status='active' AND credential_version=1 AND risk_version=1 AND row_version=1) AS device_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_device_installations WHERE authority_id=$1 AND device_id=$3 AND installation_id=$4 AND status='active' AND installation_public_key=$5 AND key_fingerprint=$6 AND credential_version=1 AND row_version=1) AS installation_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_account_device_links WHERE authority_id=$1 AND account_id=$2 AND device_id=$3 AND installation_id=$4 AND status='active' AND auth_version=1 AND access_version=1 AND row_version=1) AS link_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_role_grants WHERE authority_id=$1 AND account_id=$2 AND role='super_admin' AND status='active' AND grant_version=1 AND row_version=1 AND granted_by_account_id IS NULL AND starts_at=$7 AND ends_at IS NULL AND revoked_at IS NULL) AS grant_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_role_grants WHERE authority_id=$1 AND role='super_admin' AND status='active') AS all_grant_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_authorization_policy_publications WHERE authority_id=$1 AND receipt_id=$8 AND policy_manifest_sha256=$9 AND policy_revision=1 AND policy_contract_version=1 AND canonical_manifest_json=$10) AS publication_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_bootstrap_consumptions WHERE marker_key='single-authority-bootstrap' AND authority_id=$1 AND receipt_id=$8 AND bootstrap_intent_id=$11 AND installation_key_fingerprint=$6 AND policy_manifest_sha256=$9) AS marker_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_trust_root_evidence WHERE authority_id=$1 AND receipt_id=$8 AND actor_kind='deployment_bootstrap' AND event_id=$11 AND assertion_evidence_sha256=$12) AS evidence_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_authorization_audit_events WHERE authority_id=$1 AND receipt_id=$8 AND reason_code=$13 AND context_sha256=$14) AS audit_count, (SELECT count(*)::text FROM vnext_control_plane.vnext_authorization_outbox_events WHERE authority_id=$1 AND receipt_id=$8 AND event_type='authorization.authority_bootstrapped' AND aggregate_kind='authority' AND aggregate_id=$1 AND aggregate_version=1 AND canonical_payload_json=$15 AND payload_sha256=$16) AS outbox_count", [command.authorityId, command.accountId, command.deviceId, command.installationId, command.installationPublicKey, command.installationKeyFingerprint, receipt.created_at, receipt.receipt_id, command.policyManifestSha256, command.canonicalManifestJson, command.bootstrapIntentId, proof.assertionEvidenceSha256, command.reasonCode, contextHash, payload, sha256(payload)]);
          const row = chain.rows[0];
          if (receipt.actor_account_id !== null || receipt.command_type !== command.type || receipt.target_kind !== 'authority'
            || receipt.target_id !== command.authorityId || String(receipt.expected_row_version) !== '0'
            || receipt.outcome !== 'accepted' || receipt.result_code !== 'AUTHORITY_BOOTSTRAPPED'
            || String(receipt.committed_target_row_version) !== '1' || receipt.committed_auth_version !== null
            || receipt.committed_access_version !== null || receipt.committed_revocation_version !== null
            || result.authorityId !== command.authorityId || result.policyManifestSha256 !== command.policyManifestSha256
            || Object.values(row).some(value => value !== '1')) throw failure('IDEMPOTENCY_RECEIPT_INVALID');
          await facade.query('COMMIT');
          return Object.freeze({ authorityId: command.authorityId, code: result.code, replayed: true, status: result.status });
        }
        const consumed = await facade.query('SELECT (SELECT count(*)::text FROM vnext_control_plane.vnext_authorities) AS authorities, (SELECT count(*)::text FROM vnext_control_plane.vnext_bootstrap_consumptions) AS markers');
        if (consumed.rows[0].authorities !== '0' || consumed.rows[0].markers !== '0') throw failure('BOOTSTRAP_ALREADY_CONSUMED');
        const receiptId = nextId('bootstrap-receipt');
        const publicationId = nextId('bootstrap-publication');
        const linkId = nextId('bootstrap-link');
        const grantId = nextId('bootstrap-grant');
        const evidenceId = nextId('bootstrap-evidence');
        const auditId = nextId('bootstrap-audit');
        const outboxId = nextId('bootstrap-outbox');
        const result = resultFor(command, publicationId);
        const resultJson = stable(result);
        const payload = stable({ authorityId: command.authorityId, policyManifestSha256: command.policyManifestSha256, policyRevision: 1 });
        const contextHash = sha256(stable({ authorityId: command.authorityId, policyManifestSha256: command.policyManifestSha256 }));
        const writes = [
          ['authority', 'INSERT INTO vnext_control_plane.vnext_authorities(authority_id,status,created_at,updated_at) VALUES($1,$2,$3,$3)', [command.authorityId, 'active', timestamp]],
          ['account', 'INSERT INTO vnext_control_plane.vnext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES($1,$2,$3,1,1,1,1,$4,$4)', [command.accountId, command.authorityId, 'active', timestamp]],
          ['device', 'INSERT INTO vnext_control_plane.vnext_trusted_devices(device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at,revoked_at) VALUES($1,$2,$3,1,1,1,$4,$4,NULL)', [command.deviceId, command.authorityId, 'active', timestamp]],
          ['installation', 'INSERT INTO vnext_control_plane.vnext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,1,1,$7,$7,NULL)', [command.installationId, command.authorityId, command.deviceId, command.installationPublicKey, command.installationKeyFingerprint, 'active', timestamp]],
          ['link', 'INSERT INTO vnext_control_plane.vnext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,1,1,1,$7,$7,NULL)', [linkId, command.authorityId, command.accountId, command.deviceId, command.installationId, 'active', timestamp]],
          ['grant', 'INSERT INTO vnext_control_plane.vnext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,ends_at,revoked_at,granted_by_account_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,1,1,$6,NULL,NULL,NULL,$6,$6)', [grantId, command.authorityId, command.accountId, 'super_admin', 'active', timestamp]],
          ['receipt', 'INSERT INTO vnext_control_plane.vnext_authorization_command_receipts(receipt_id,authority_id,actor_key,actor_account_id,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_auth_version,committed_access_version,committed_revocation_version,committed_target_row_version,created_at) VALUES($1,$2,$3,NULL,$4,$5,$6,$2,$7,0,$8,$9,$10,$11,NULL,NULL,NULL,1,$12)', [receiptId, command.authorityId, actorKey, command.idempotencyKey, command.type, 'authority', requestHash, 'accepted', 'AUTHORITY_BOOTSTRAPPED', resultJson, sha256(resultJson), timestamp]],
          ['marker', "INSERT INTO vnext_control_plane.vnext_bootstrap_consumptions(marker_key,bootstrap_intent_id,authority_id,installation_key_fingerprint,policy_manifest_sha256,receipt_id,consumed_at) VALUES('single-authority-bootstrap',$1,$2,$3,$4,$5,$6)", [command.bootstrapIntentId, command.authorityId, command.installationKeyFingerprint, command.policyManifestSha256, receiptId, timestamp]],
          ['publication', 'INSERT INTO vnext_control_plane.vnext_authorization_policy_publications(publication_id,authority_id,receipt_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256,published_at) VALUES($1,$2,$3,1,1,$4,$5,$6)', [publicationId, command.authorityId, receiptId, command.canonicalManifestJson, command.policyManifestSha256, timestamp]],
          ['evidence', "INSERT INTO vnext_control_plane.vnext_trust_root_evidence(evidence_id,authority_id,receipt_id,actor_kind,event_id,assertion_evidence_sha256,backup_id,backup_manifest_sha256,created_at) VALUES($1,$2,$3,'deployment_bootstrap',$4,$5,NULL,NULL,$6)", [evidenceId, command.authorityId, receiptId, command.bootstrapIntentId, proof.assertionEvidenceSha256, timestamp]],
          ['audit', 'INSERT INTO vnext_control_plane.vnext_authorization_audit_events(event_id,authority_id,receipt_id,reason_code,context_sha256,created_at) VALUES($1,$2,$3,$4,$5,$6)', [auditId, command.authorityId, receiptId, command.reasonCode, contextHash, timestamp]],
          ['outbox', "INSERT INTO vnext_control_plane.vnext_authorization_outbox_events(event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at) VALUES($1,$2,$3,'authorization.authority_bootstrapped','authority',$2,1,$4,$5,$6)", [outboxId, command.authorityId, receiptId, payload, sha256(payload), timestamp]],
        ];
        for (const [stage, text, values] of writes) { await facade.query(text, values); hook(stage); }
        await facade.query('COMMIT');
        return Object.freeze({ authorityId: command.authorityId, code: 'AUTHORITY_BOOTSTRAPPED', replayed: false, status: 'accepted' });
      } catch (error) {
        try { await facade.query('ROLLBACK'); } catch (_) { /* no-op */ }
        if (error && typeof error.code === 'string' && /^(BOOTSTRAP_|IDEMPOTENCY_)/.test(error.code)) throw error;
        throw failure('BOOTSTRAP_UNAVAILABLE');
      }
    });
  }
  return Object.freeze({ execute });
}

module.exports = Object.freeze({ createVNextPg17FirstAuthorityBootstrapMutation });
