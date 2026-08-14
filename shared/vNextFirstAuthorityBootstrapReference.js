'use strict';

const crypto = require('node:crypto');
const { types } = require('node:util');
const { assertVNextControlPlaneReferenceSchema } = require('./vNextControlPlaneReferenceKernel');
const { isVNextTrustRootVerifierBoundaryReferenceForDatabase } = require('./vNextTrustRootVerifierBoundaryReference');
const policy = require('./vNextAuthorizationPolicyReference');

const COMMAND_KEYS = ['type', 'bootstrapIntentId', 'authorityId', 'accountId', 'deviceId', 'installationId', 'installationPublicKey', 'installationKeyFingerprint', 'policyManifest', 'idempotencyKey', 'reasonCode'];
const ERROR = code => Object.assign(new Error(code), { code });
const hash = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const freeze = value => Object.freeze(value);

function text(value, code) { const result = typeof value === 'string' ? value.trim() : ''; if (!result) throw ERROR(code); return result; }
function instant(value, code) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) throw ERROR(code); return value; }
function stable(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw ERROR('BOOTSTRAP_INPUT_INVALID');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function clonePlain(value, seen = new Set()) {
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) { if (typeof value === 'number' && !Number.isFinite(value)) throw ERROR('BOOTSTRAP_INPUT_INVALID'); return value; }
  if (!value || typeof value !== 'object' || types.isProxy(value) || seen.has(value)) throw ERROR('BOOTSTRAP_INPUT_INVALID');
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) throw ERROR('BOOTSTRAP_INPUT_INVALID');
    seen.add(value); const copy = [];
    for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw ERROR('BOOTSTRAP_INPUT_INVALID'); copy.push(clonePlain(descriptor.value, seen)); }
    seen.delete(value); return copy;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw ERROR('BOOTSTRAP_INPUT_INVALID');
  const keys = Reflect.ownKeys(value); if (keys.some(key => typeof key !== 'string')) throw ERROR('BOOTSTRAP_INPUT_INVALID');
  seen.add(value); const copy = {};
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw ERROR('BOOTSTRAP_INPUT_INVALID'); copy[key] = clonePlain(descriptor.value, seen); }
  seen.delete(value); return copy;
}
function exactConfig(config) {
  if (!config || typeof config !== 'object' || types.isProxy(config) || Object.getPrototypeOf(config) !== Object.prototype) return null;
  const allowed = new Set(['db', 'verifier', 'now', 'idFactory', 'testHooks']); const keys = Reflect.ownKeys(config);
  if (keys.some(key => typeof key !== 'string' || !allowed.has(key)) || !['db', 'verifier'].every(key => keys.includes(key))) return null;
  const copy = {};
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(config, key); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null; copy[key] = descriptor.value; }
  return copy;
}
function exactHooks(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(value); if (keys.some(key => key !== 'afterWrite')) return null;
  if (!keys.length) return freeze({ afterWrite: null });
  const descriptor = Object.getOwnPropertyDescriptor(value, 'afterWrite');
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function' || types.isProxy(descriptor.value)) return null;
  return freeze({ afterWrite: descriptor.value });
}
function snapshotCommand(input) {
  if (!input || typeof input !== 'object' || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).length !== COMMAND_KEYS.length) throw ERROR('BOOTSTRAP_INPUT_INVALID');
  const copy = {};
  for (const key of COMMAND_KEYS) { const descriptor = Object.getOwnPropertyDescriptor(input, key); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw ERROR('BOOTSTRAP_INPUT_INVALID'); copy[key] = descriptor.value; }
  if (copy.type !== 'authority.bootstrap') throw ERROR('BOOTSTRAP_INPUT_INVALID');
  for (const key of COMMAND_KEYS) if (key !== 'policyManifest' && key !== 'type') copy[key] = text(copy[key], 'BOOTSTRAP_INPUT_INVALID');
  const canonicalManifestJson = policy.canonicalizePolicyManifest(clonePlain(copy.policyManifest));
  return freeze({ ...copy, canonicalManifestJson, policyManifestSha256: hash(canonicalManifestJson) });
}
function bootstrapResult(command, publicationId) { return { authorityId: command.authorityId, code: 'AUTHORITY_BOOTSTRAPPED', policyContractVersion: 1, policyManifestSha256: command.policyManifestSha256, policyRevision: 1, publicationId, status: 'accepted' }; }
function parseResult(json, digest) {
  if (typeof json !== 'string' || hash(json) !== digest) throw ERROR('IDEMPOTENCY_RECEIPT_INVALID');
  let value; try { value = JSON.parse(json); } catch { throw ERROR('IDEMPOTENCY_RECEIPT_INVALID'); }
  const keys = ['authorityId', 'code', 'policyContractVersion', 'policyManifestSha256', 'policyRevision', 'publicationId', 'status'];
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || stable(value) !== json || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || typeof value.authorityId !== 'string' || value.code !== 'AUTHORITY_BOOTSTRAPPED' || value.policyContractVersion !== 1 || typeof value.policyManifestSha256 !== 'string' || value.policyRevision !== 1 || typeof value.publicationId !== 'string' || value.status !== 'accepted') throw ERROR('IDEMPOTENCY_RECEIPT_INVALID');
  return value;
}

function createVNextFirstAuthorityBootstrapReference(config) {
  const values = exactConfig(config); const { db, verifier, now = () => new Date().toISOString(), idFactory = kind => `${kind}-${crypto.randomUUID()}`, testHooks = {} } = values || {};
  const hooks = exactHooks(testHooks);
  if (!db || ['prepare', 'transaction', 'pragma', 'exec'].some(key => typeof db[key] !== 'function') || typeof now !== 'function' || typeof idFactory !== 'function' || !hooks || !isVNextTrustRootVerifierBoundaryReferenceForDatabase(verifier, db)) throw ERROR('BOOTSTRAP_WRITER_INVALID');
  const nextId = kind => text(idFactory(kind), 'BOOTSTRAP_ID_INVALID');
  const hook = stage => { if (hooks.afterWrite) hooks.afterWrite(freeze({ stage })); };

  const execute = db.transaction((assertion, input) => {
    assertVNextControlPlaneReferenceSchema(db);
    const command = snapshotCommand(input);
    let proof; try { proof = verifier.unwrap(assertion, 'deployment_bootstrap'); } catch { throw ERROR('BOOTSTRAP_ASSERTION_MISMATCH'); }
    let timestamp; try { timestamp = instant(now(), 'BOOTSTRAP_INPUT_INVALID'); } catch { throw ERROR('BOOTSTRAP_INPUT_INVALID'); }
    if (Date.parse(proof.expiresAt) <= Date.parse(timestamp) || proof.bootstrapIntentId !== command.bootstrapIntentId || proof.authorityId !== command.authorityId || proof.accountId !== command.accountId || proof.deviceId !== command.deviceId || proof.installationId !== command.installationId || proof.installationPublicKey !== command.installationPublicKey || proof.installationKeyFingerprint !== command.installationKeyFingerprint || proof.policyManifestSha256 !== command.policyManifestSha256) throw ERROR('BOOTSTRAP_ASSERTION_MISMATCH');
    const actorKey = `bootstrap:${command.bootstrapIntentId}`;
    const requestJson = stable({ accountId: command.accountId, authorityId: command.authorityId, bootstrapIntentId: command.bootstrapIntentId, canonicalManifestJson: command.canonicalManifestJson, deviceId: command.deviceId, installationId: command.installationId, installationKeyFingerprint: command.installationKeyFingerprint, installationPublicKey: command.installationPublicKey, reasonCode: command.reasonCode, type: command.type });
    const requestHash = hash(requestJson);
    const existing = db.prepare('SELECT * FROM vNext_authorization_command_receipts WHERE authority_id=? AND actor_key=? AND idempotency_key=?').get(command.authorityId, actorKey, command.idempotencyKey);
    if (existing) {
      if (existing.canonical_request_sha256 !== requestHash) throw ERROR('IDEMPOTENCY_KEY_CONFLICT');
      const result = parseResult(existing.canonical_result_json, existing.canonical_result_sha256);
      const authority = db.prepare("SELECT * FROM vNext_authorities WHERE authority_id=? AND status='active'").get(command.authorityId);
      const account = db.prepare("SELECT * FROM vNext_accounts WHERE authority_id=? AND account_id=? AND status='active'").get(command.authorityId, command.accountId);
      const device = db.prepare("SELECT * FROM vNext_trusted_devices WHERE authority_id=? AND device_id=? AND status='active'").get(command.authorityId, command.deviceId);
      const installation = db.prepare("SELECT * FROM vNext_device_installations WHERE authority_id=? AND installation_id=? AND device_id=? AND status='active'").get(command.authorityId, command.installationId, command.deviceId);
      const links = db.prepare("SELECT * FROM vNext_account_device_links WHERE authority_id=? AND account_id=? AND device_id=? AND installation_id=? AND status='active'").all(command.authorityId, command.accountId, command.deviceId, command.installationId);
      const grants = db.prepare("SELECT * FROM vNext_role_grants WHERE authority_id=? AND account_id=? AND role='super_admin' AND status='active'").all(command.authorityId, command.accountId);
      const allActiveGrants = db.prepare("SELECT grant_id FROM vNext_role_grants WHERE authority_id=? AND role='super_admin' AND status='active'").all(command.authorityId);
      const publication = db.prepare('SELECT * FROM vNext_authorization_policy_publications WHERE authority_id=? AND receipt_id=?').get(command.authorityId, existing.receipt_id);
      const marker = db.prepare('SELECT * FROM vNext_bootstrap_consumptions WHERE marker_key=?').get('single-authority-bootstrap');
      const evidence = db.prepare("SELECT * FROM vNext_trust_root_evidence WHERE authority_id=? AND receipt_id=? AND actor_kind='deployment_bootstrap'").all(command.authorityId, existing.receipt_id);
      const audit = db.prepare('SELECT * FROM vNext_authorization_audit_events WHERE authority_id=? AND receipt_id=?').all(command.authorityId, existing.receipt_id);
      const outbox = db.prepare('SELECT * FROM vNext_authorization_outbox_events WHERE authority_id=? AND receipt_id=?').all(command.authorityId, existing.receipt_id);
      const payload = stable({ authorityId: command.authorityId, policyManifestSha256: command.policyManifestSha256, policyRevision: 1 });
      const valid = existing.actor_account_id === null && existing.command_type === command.type && existing.target_kind === 'authority' && existing.target_id === command.authorityId && existing.expected_row_version === 0 && existing.outcome === 'accepted' && existing.result_code === result.code && existing.committed_target_row_version === 1 && existing.committed_auth_version === null && existing.committed_access_version === null && existing.committed_revocation_version === null && result.authorityId === command.authorityId && result.policyManifestSha256 === command.policyManifestSha256 && authority && account && account.auth_version === 1 && account.access_version === 1 && account.revocation_version === 1 && account.row_version === 1 && device && device.credential_version === 1 && device.risk_version === 1 && device.row_version === 1 && installation && installation.installation_public_key === command.installationPublicKey && installation.key_fingerprint === command.installationKeyFingerprint && installation.credential_version === 1 && installation.row_version === 1 && links.length === 1 && links[0].auth_version === 1 && links[0].access_version === 1 && links[0].row_version === 1 && grants.length === 1 && grants[0].grant_version === 1 && grants[0].row_version === 1 && grants[0].granted_by_account_id === null && grants[0].ends_at === null && grants[0].revoked_at === null && grants[0].starts_at === existing.created_at && grants[0].created_at === existing.created_at && grants[0].updated_at === existing.created_at && allActiveGrants.length === 1 && publication && publication.publication_id === result.publicationId && publication.policy_revision === 1 && publication.policy_contract_version === 1 && publication.canonical_manifest_json === command.canonicalManifestJson && publication.policy_manifest_sha256 === command.policyManifestSha256 && marker && marker.bootstrap_intent_id === command.bootstrapIntentId && marker.authority_id === command.authorityId && marker.installation_key_fingerprint === command.installationKeyFingerprint && marker.policy_manifest_sha256 === command.policyManifestSha256 && marker.receipt_id === existing.receipt_id && evidence.length === 1 && evidence[0].event_id === command.bootstrapIntentId && evidence[0].assertion_evidence_sha256 === proof.assertionEvidenceSha256 && audit.length === 1 && audit[0].reason_code === command.reasonCode && audit[0].context_sha256 === hash(stable({ authorityId: command.authorityId, policyManifestSha256: command.policyManifestSha256 })) && outbox.length === 1 && outbox[0].event_type === 'authorization.authority_bootstrapped' && outbox[0].aggregate_kind === 'authority' && outbox[0].aggregate_id === command.authorityId && outbox[0].aggregate_version === 1 && outbox[0].canonical_payload_json === payload && outbox[0].payload_sha256 === hash(payload);
      if (!valid) throw ERROR('IDEMPOTENCY_RECEIPT_INVALID');
      return freeze({ authorityId: command.authorityId, code: result.code, replayed: true, status: result.status });
    }
    if (db.prepare('SELECT COUNT(*) AS count FROM vNext_authorities').get().count !== 0 || db.prepare('SELECT COUNT(*) AS count FROM vNext_bootstrap_consumptions').get().count !== 0) throw ERROR('BOOTSTRAP_ALREADY_CONSUMED');
    const receiptId = nextId('bootstrap-receipt'); const publicationId = nextId('bootstrap-policy-publication'); const linkId = nextId('bootstrap-link'); const grantId = nextId('bootstrap-super-admin-grant'); const evidenceId = nextId('bootstrap-evidence'); const resultObject = bootstrapResult(command, publicationId); const resultJson = stable(resultObject);
    db.prepare("INSERT INTO vNext_authorities(authority_id,status,created_at,updated_at) VALUES(?,?,?,?)").run(command.authorityId, 'active', timestamp, timestamp); hook('authority');
    db.prepare("INSERT INTO vNext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(command.accountId, command.authorityId, 'active', 1, 1, 1, 1, timestamp, timestamp); hook('account');
    db.prepare("INSERT INTO vNext_trusted_devices(device_id,authority_id,status,credential_version,risk_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(command.deviceId, command.authorityId, 'active', 1, 1, 1, timestamp, timestamp); hook('device');
    db.prepare("INSERT INTO vNext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(command.installationId, command.authorityId, command.deviceId, command.installationPublicKey, command.installationKeyFingerprint, 'active', 1, 1, timestamp, timestamp); hook('installation');
    db.prepare("INSERT INTO vNext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(linkId, command.authorityId, command.accountId, command.deviceId, command.installationId, 'active', 1, 1, 1, timestamp, timestamp); hook('link');
    db.prepare("INSERT INTO vNext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(grantId, command.authorityId, command.accountId, 'super_admin', 'active', 1, 1, timestamp, timestamp, timestamp); hook('grant');
    db.prepare("INSERT INTO vNext_authorization_command_receipts(receipt_id,authority_id,actor_key,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_target_row_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(receiptId, command.authorityId, actorKey, command.idempotencyKey, command.type, 'authority', command.authorityId, requestHash, 0, 'accepted', 'AUTHORITY_BOOTSTRAPPED', resultJson, hash(resultJson), 1, timestamp); hook('receipt');
    db.prepare("INSERT INTO vNext_bootstrap_consumptions(marker_key,bootstrap_intent_id,authority_id,installation_key_fingerprint,policy_manifest_sha256,receipt_id,consumed_at) VALUES('single-authority-bootstrap',?,?,?,?,?,?)").run(command.bootstrapIntentId, command.authorityId, command.installationKeyFingerprint, command.policyManifestSha256, receiptId, timestamp); hook('marker');
    db.prepare("INSERT INTO vNext_authorization_policy_publications(publication_id,authority_id,receipt_id,policy_revision,policy_contract_version,canonical_manifest_json,policy_manifest_sha256,published_at) VALUES(?,?,?,?,?,?,?,?)").run(publicationId, command.authorityId, receiptId, 1, 1, command.canonicalManifestJson, command.policyManifestSha256, timestamp); hook('publication');
    db.prepare("INSERT INTO vNext_trust_root_evidence(evidence_id,authority_id,receipt_id,actor_kind,event_id,assertion_evidence_sha256,created_at) VALUES(?,?,?,?,?,?,?)").run(evidenceId, command.authorityId, receiptId, 'deployment_bootstrap', command.bootstrapIntentId, proof.assertionEvidenceSha256, timestamp); hook('evidence');
    db.prepare("INSERT INTO vNext_authorization_audit_events(event_id,authority_id,receipt_id,reason_code,context_sha256,created_at) VALUES(?,?,?,?,?,?)").run(nextId('bootstrap-audit'), command.authorityId, receiptId, command.reasonCode, hash(stable({ authorityId: command.authorityId, policyManifestSha256: command.policyManifestSha256 })), timestamp); hook('audit');
    const payload = stable({ authorityId: command.authorityId, policyManifestSha256: command.policyManifestSha256, policyRevision: 1 });
    db.prepare("INSERT INTO vNext_authorization_outbox_events(event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(nextId('bootstrap-outbox'), command.authorityId, receiptId, 'authorization.authority_bootstrapped', 'authority', command.authorityId, 1, payload, hash(payload), timestamp); hook('outbox');
    return freeze({ authorityId: command.authorityId, code: 'AUTHORITY_BOOTSTRAPPED', replayed: false, status: 'accepted' });
  });
  return freeze({ execute });
}

module.exports = freeze({ createVNextFirstAuthorityBootstrapReference });
