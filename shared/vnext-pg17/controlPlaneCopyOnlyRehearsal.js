'use strict';

const Database = require('better-sqlite3');
const { types } = require('util');
const { createHash } = require('crypto');
const { withVNextPg17CopyOnlyRehearsalTarget } = require('./disposableRuntime');
const { stablePlainObjectJson } = require('../vNextCanonicalJsonReference');

const sources = new WeakMap();
const COLLECTIONS = Object.freeze(['authorities', 'accounts', 'trustedDevices', 'installations', 'links', 'roleGrants', 'capabilityCatalog', 'capabilityOverrides', 'dataScopeGrants', 'profileBindings', 'verifiedContacts', 'receipts', 'auditEvents', 'outboxEvents', 'legacySessions', 'legacyDeviceGrants', 'legacyOfflineLicenses', 'legacyCredentials', 'legacyTokens', 'legacyPasswords', 'legacyPrivateKeys', 'legacyBackups']);
const IDENTITY_COLLECTIONS = Object.freeze(['authorities', 'accounts', 'trustedDevices', 'installations', 'links']);
const HISTORICAL_AUTHORIZATION_COLLECTIONS = Object.freeze(['capabilityCatalog', 'roleGrants', 'capabilityOverrides', 'dataScopeGrants']);
const PROFILE_METADATA_COLLECTIONS = Object.freeze(['profileBindings']);
const VERIFIED_CONTACT_COLLECTIONS = Object.freeze(['verifiedContacts']);
const LINK_REVOCATION_EVIDENCE_COLLECTIONS = Object.freeze(['receipts', 'auditEvents', 'outboxEvents']);
const DEFERRED_MAPPED_COLLECTIONS = Object.freeze(COLLECTIONS.filter(key => !IDENTITY_COLLECTIONS.includes(key) && !HISTORICAL_AUTHORIZATION_COLLECTIONS.includes(key) && !PROFILE_METADATA_COLLECTIONS.includes(key) && !VERIFIED_CONTACT_COLLECTIONS.includes(key) && !LINK_REVOCATION_EVIDENCE_COLLECTIONS.includes(key) && !key.startsWith('legacy')));
const INERT_ARCHIVE_COLLECTIONS = Object.freeze(COLLECTIONS.filter(key => key.startsWith('legacy')));
const IDENTITY_FIELDS = Object.freeze({
  authorities: Object.freeze(['authority_id', 'status', 'created_at', 'updated_at']),
  accounts: Object.freeze(['account_id', 'authority_id', 'status', 'auth_version', 'access_version', 'revocation_version', 'row_version', 'created_at', 'updated_at']),
  trustedDevices: Object.freeze(['device_id', 'authority_id', 'status', 'hardware_evidence_hash', 'risk_code', 'credential_version', 'risk_version', 'row_version', 'created_at', 'updated_at', 'revoked_at']),
  installations: Object.freeze(['installation_id', 'authority_id', 'device_id', 'installation_public_key', 'key_fingerprint', 'status', 'credential_version', 'row_version', 'created_at', 'updated_at', 'revoked_at']),
  links: Object.freeze(['link_id', 'authority_id', 'account_id', 'device_id', 'installation_id', 'status', 'auth_version', 'access_version', 'row_version', 'created_at', 'updated_at', 'revoked_at']),
});
const HISTORICAL_FIELDS = Object.freeze({
  capabilityCatalog: Object.freeze(['capability_id', 'status', 'surface_mask', 'created_at']),
  roleGrants: Object.freeze(['grant_id', 'authority_id', 'account_id', 'role', 'status', 'grant_version', 'row_version', 'starts_at', 'ends_at', 'revoked_at', 'granted_by_account_id', 'created_at', 'updated_at']),
  capabilityOverrides: Object.freeze(['override_id', 'authority_id', 'account_id', 'capability_id', 'effect', 'status', 'starts_at', 'ends_at', 'row_version', 'created_at', 'updated_at', 'revoked_at']),
  dataScopeGrants: Object.freeze(['scope_grant_id', 'authority_id', 'account_id', 'scope_type', 'scope_value_hash', 'effect', 'status', 'starts_at', 'ends_at', 'row_version', 'created_at', 'updated_at', 'revoked_at']),
});
const PROFILE_FIELDS = Object.freeze({
  profileBindings: Object.freeze(['binding_id', 'authority_id', 'account_id', 'profile_type', 'profile_id', 'status', 'evidence_hash', 'row_version', 'created_at', 'updated_at', 'revoked_at']),
});
const VERIFIED_CONTACT_FIELDS = Object.freeze({
  verifiedContacts: Object.freeze(['contact_id', 'authority_id', 'account_id', 'contact_type', 'normalized_value_hash', 'verification_state', 'verification_evidence_hash', 'verified_at', 'revoked_at', 'row_version', 'created_at', 'updated_at']),
});
const LINK_REVOCATION_EVIDENCE_FIELDS = Object.freeze({
  receipts: Object.freeze(['receipt_id', 'authority_id', 'actor_key', 'actor_account_id', 'idempotency_key', 'command_type', 'target_kind', 'target_id', 'canonical_request_sha256', 'expected_row_version', 'outcome', 'result_code', 'canonical_result_json', 'canonical_result_sha256', 'committed_auth_version', 'committed_access_version', 'committed_revocation_version', 'committed_target_row_version', 'created_at', 'canonicalRequest']),
  auditEvents: Object.freeze(['event_id', 'authority_id', 'receipt_id', 'reason_code', 'context_sha256', 'created_at', 'context']),
  outboxEvents: Object.freeze(['event_id', 'authority_id', 'receipt_id', 'event_type', 'aggregate_kind', 'aggregate_id', 'aggregate_version', 'canonical_payload_json', 'payload_sha256', 'occurred_at']),
});
const LINK_REVOCATION_TARGET_FIELDS = Object.freeze({
  receipts: Object.freeze(LINK_REVOCATION_EVIDENCE_FIELDS.receipts.filter(key => key !== 'canonicalRequest')),
  auditEvents: Object.freeze(LINK_REVOCATION_EVIDENCE_FIELDS.auditEvents.filter(key => key !== 'context')),
  outboxEvents: LINK_REVOCATION_EVIDENCE_FIELDS.outboxEvents,
});

function fail(code) { const error = new Error(code); error.code = code; return error; }
function clone(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) {
    if (types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) throw fail('VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID');
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    if (!length || !Object.prototype.hasOwnProperty.call(length, 'value') || !Number.isSafeInteger(length.value) || length.value < 0) throw fail('VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID');
    const expectedKeys = new Set(['length', ...Array.from({ length: length.value }, (_, index) => String(index))]);
    if (Reflect.ownKeys(value).length !== expectedKeys.size || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !expectedKeys.has(key))) throw fail('VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID');
    const copy = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw fail('VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID');
      copy.push(clone(descriptor.value));
    }
    return Object.freeze(copy);
  }
  if (!value || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw fail('VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID');
  return Object.freeze(Object.fromEntries(Reflect.ownKeys(value).sort().map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw fail('VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID');
    return [key, clone(descriptor.value)];
  })));
}
function canonical(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`;
  return `{${Reflect.ownKeys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function sha256(value) { return createHash('sha256').update(canonical(value), 'utf8').digest('hex'); }
function sha256Text(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function linkRevokeStableJson(value) {
  const json = stablePlainObjectJson(value);
  if (json === null) throw fail('VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID');
  return json;
}
function canonicalCollectionRows(rows) { return [...rows].sort((left, right) => {
  const leftText = canonical(left);
  const rightText = canonical(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}); }
function normalizedSnapshot(snapshot, collections = COLLECTIONS) { return collections.map(key => [key, canonicalCollectionRows(snapshot[key])]); }
function normalizeIdentityRow(row) {
  return Object.fromEntries(Reflect.ownKeys(row).sort().map(key => {
    const value = row[key];
    if (key.endsWith('_at') && value !== null) return [key, new Date(value).toISOString()];
    if (key.endsWith('_version')) return [key, Number(value)];
    return [key, value];
  }));
}
function identityLogicalRows(snapshot) { return IDENTITY_COLLECTIONS.map(key => [key, canonicalCollectionRows(snapshot[key].map(normalizeIdentityRow))]); }
function historicalAuthorizationLogicalRows(snapshot) { return HISTORICAL_AUTHORIZATION_COLLECTIONS.map(key => [key, canonicalCollectionRows(snapshot[key].map(normalizeIdentityRow))]); }
function profileMetadataLogicalRows(snapshot) { return PROFILE_METADATA_COLLECTIONS.map(key => [key, canonicalCollectionRows(snapshot[key].map(normalizeIdentityRow))]); }
function verifiedContactLogicalRows(snapshot) { return VERIFIED_CONTACT_COLLECTIONS.map(key => [key, canonicalCollectionRows(snapshot[key].map(normalizeIdentityRow))]); }
function linkRevocationEvidenceLogicalRows(snapshot) {
  return LINK_REVOCATION_EVIDENCE_COLLECTIONS.map(key => {
    const rows = snapshot[key].map(row => normalizeIdentityRow(Object.fromEntries(LINK_REVOCATION_TARGET_FIELDS[key].map(field => [field, row[field]]))));
    return [key, canonicalCollectionRows(rows)];
  });
}
function fingerprint(value) { return sha256(normalizedSnapshot(value)); }
function inventory(snapshot) {
  return Object.freeze(Object.fromEntries(INERT_ARCHIVE_COLLECTIONS.map(key => [key, Object.freeze({
    count: snapshot[key].length,
    sha256: sha256(canonicalCollectionRows(snapshot[key])),
  })])));
}
function sameKeys(value, fields) { return Reflect.ownKeys(value).length === fields.length && fields.every(key => Object.prototype.hasOwnProperty.call(value, key)); }
function nonBlank(value) { return typeof value === 'string' && value.trim() !== ''; }
function canonicalText(value) { return nonBlank(value) && value === value.trim(); }
function finiteInstant(value) { return typeof value === 'string' && (() => { try { return new Date(value).toISOString() === value; } catch (_) { return false; } })(); }
function positiveInteger(value) { return Number.isSafeInteger(value) && value >= 1; }
function validVersions(row, keys) { return keys.every(key => positiveInteger(row[key])); }
function validTimestamps(row, keys) { return keys.every(key => finiteInstant(row[key])) && Date.parse(row.updated_at) >= Date.parse(row.created_at); }
function validNullableInstant(value) { return value === null || finiteInstant(value); }
function validRevocationState(row, states) { return states.includes(row.status) && validNullableInstant(row.revoked_at) && (row.status === 'revoked' ? row.revoked_at !== null : row.revoked_at === null); }
function validHistoricalLifecycle(row) {
  return validTimestamps(row, ['starts_at', 'created_at', 'updated_at'])
    && validNullableInstant(row.ends_at) && validNullableInstant(row.revoked_at)
    && (row.ends_at === null || Date.parse(row.ends_at) > Date.parse(row.starts_at))
    && ((row.status === 'revoked' && row.revoked_at !== null) || (row.status === 'expired' && row.ends_at !== null && row.revoked_at === null));
}
function validIdentityTopology(snapshot) {
  const authority = snapshot.authorities[0];
  if (!sameKeys(authority, IDENTITY_FIELDS.authorities) || !nonBlank(authority.authority_id) || authority.status !== 'active' || !validTimestamps(authority, ['created_at', 'updated_at'])) return false;
  const authorityId = authority.authority_id;
  const accounts = new Map();
  for (const row of snapshot.accounts) {
    if (!sameKeys(row, IDENTITY_FIELDS.accounts) || !nonBlank(row.account_id) || row.authority_id !== authorityId || !['active', 'disabled', 'revoked'].includes(row.status)
      || !validVersions(row, ['auth_version', 'access_version', 'revocation_version', 'row_version']) || !validTimestamps(row, ['created_at', 'updated_at']) || accounts.has(row.account_id)) return false;
    accounts.set(row.account_id, row.status);
  }
  const devices = new Map();
  for (const row of snapshot.trustedDevices) {
    if (!sameKeys(row, IDENTITY_FIELDS.trustedDevices) || !nonBlank(row.device_id) || row.authority_id !== authorityId || !validRevocationState(row, ['active', 'risk_limited', 'revoked', 'retired'])
      || ![row.hardware_evidence_hash, row.risk_code].every(value => value === null || nonBlank(value)) || !validVersions(row, ['credential_version', 'risk_version', 'row_version']) || !validTimestamps(row, ['created_at', 'updated_at']) || devices.has(row.device_id)) return false;
    devices.set(row.device_id, row.status);
  }
  const installations = new Map();
  for (const row of snapshot.installations) {
    if (!sameKeys(row, IDENTITY_FIELDS.installations) || !nonBlank(row.installation_id) || row.authority_id !== authorityId || !devices.has(row.device_id) || !validRevocationState(row, ['active', 'revoked', 'retired'])
      || !nonBlank(row.installation_public_key) || !/^[0-9a-f]{64}$/.test(row.key_fingerprint) || !validVersions(row, ['credential_version', 'row_version']) || !validTimestamps(row, ['created_at', 'updated_at']) || installations.has(row.installation_id)) return false;
    installations.set(row.installation_id, row.status);
  }
  const links = new Set();
  for (const row of snapshot.links) {
    if (!sameKeys(row, IDENTITY_FIELDS.links) || !nonBlank(row.link_id) || row.authority_id !== authorityId || !accounts.has(row.account_id) || !devices.has(row.device_id) || !installations.has(row.installation_id) || !validRevocationState(row, ['active', 'revoked', 'expired'])
      || !validVersions(row, ['auth_version', 'access_version', 'row_version']) || !validTimestamps(row, ['created_at', 'updated_at']) || links.has(row.link_id)) return false;
    links.add(row.link_id);
  }
  return true;
}
function validHistoricalAuthorization(snapshot) {
  const authorityId = snapshot.authorities[0].authority_id;
  const accounts = new Set(snapshot.accounts.map(row => row.account_id));
  const capabilities = new Set();
  for (const row of snapshot.capabilityCatalog) {
    if (!sameKeys(row, HISTORICAL_FIELDS.capabilityCatalog) || !nonBlank(row.capability_id) || !['active', 'retired'].includes(row.status) || !nonBlank(row.surface_mask) || !finiteInstant(row.created_at) || capabilities.has(row.capability_id)) return false;
    capabilities.add(row.capability_id);
  }
  const grants = new Set();
  for (const row of snapshot.roleGrants) {
    if (!sameKeys(row, HISTORICAL_FIELDS.roleGrants) || !nonBlank(row.grant_id) || row.authority_id !== authorityId || !accounts.has(row.account_id) || !['super_admin', 'teacher', 'student', 'family_member'].includes(row.role) || !['revoked', 'expired'].includes(row.status)
      || !validVersions(row, ['grant_version', 'row_version']) || !validHistoricalLifecycle(row) || !(row.granted_by_account_id === null || accounts.has(row.granted_by_account_id)) || grants.has(row.grant_id)) return false;
    grants.add(row.grant_id);
  }
  const overrides = new Set();
  for (const row of snapshot.capabilityOverrides) {
    if (!sameKeys(row, HISTORICAL_FIELDS.capabilityOverrides) || !nonBlank(row.override_id) || row.authority_id !== authorityId || !accounts.has(row.account_id) || !capabilities.has(row.capability_id) || !['allow', 'deny'].includes(row.effect) || !['revoked', 'expired'].includes(row.status)
      || !validVersions(row, ['row_version']) || !validHistoricalLifecycle(row) || overrides.has(row.override_id)) return false;
    overrides.add(row.override_id);
  }
  const scopes = new Set();
  for (const row of snapshot.dataScopeGrants) {
    if (!sameKeys(row, HISTORICAL_FIELDS.dataScopeGrants) || !nonBlank(row.scope_grant_id) || row.authority_id !== authorityId || !accounts.has(row.account_id) || !['teacher_profile', 'student_profile', 'school', 'household', 'resource_owner'].includes(row.scope_type) || !nonBlank(row.scope_value_hash) || !['allow', 'deny'].includes(row.effect) || !['revoked', 'expired'].includes(row.status)
      || !validVersions(row, ['row_version']) || !validHistoricalLifecycle(row) || scopes.has(row.scope_grant_id)) return false;
    scopes.add(row.scope_grant_id);
  }
  return true;
}
function validProfileMetadata(snapshot) {
  const authorityId = snapshot.authorities[0].authority_id;
  const accounts = new Set(snapshot.accounts.map(row => row.account_id));
  const activeAccounts = new Set(snapshot.accounts.filter(row => row.status === 'active').map(row => row.account_id));
  const bindingIds = new Set();
  const activeByAccountType = new Set();
  const activeByProfileType = new Set();
  for (const row of snapshot.profileBindings) {
    if (!sameKeys(row, PROFILE_FIELDS.profileBindings) || !nonBlank(row.binding_id) || row.authority_id !== authorityId || !accounts.has(row.account_id)
      || !['teacher', 'student'].includes(row.profile_type) || !nonBlank(row.profile_id) || !['active', 'pending', 'revoked'].includes(row.status)
      || !nonBlank(row.evidence_hash) || !positiveInteger(row.row_version) || !validTimestamps(row, ['created_at', 'updated_at'])
      || !validNullableInstant(row.revoked_at) || (row.status === 'revoked' ? row.revoked_at === null : row.revoked_at !== null) || bindingIds.has(row.binding_id)) return false;
    if (row.status === 'active') {
      if (!activeAccounts.has(row.account_id)) return false;
      const accountType = `${row.authority_id}\u0000${row.account_id}\u0000${row.profile_type}`;
      const profileType = `${row.authority_id}\u0000${row.profile_type}\u0000${row.profile_id}`;
      if (activeByAccountType.has(accountType) || activeByProfileType.has(profileType)) return false;
      activeByAccountType.add(accountType);
      activeByProfileType.add(profileType);
    }
    bindingIds.add(row.binding_id);
  }
  return true;
}
function validVerifiedContactMetadata(snapshot) {
  const authorityId = snapshot.authorities[0].authority_id;
  const accounts = new Map(snapshot.accounts.map(row => [row.account_id, row]));
  const contactIds = new Set();
  const identities = new Set();
  for (const row of snapshot.verifiedContacts) {
    if (!sameKeys(row, VERIFIED_CONTACT_FIELDS.verifiedContacts) || !nonBlank(row.contact_id) || row.authority_id !== authorityId || !accounts.has(row.account_id)
      || !['phone', 'wechat_openid', 'wechat_unionid'].includes(row.contact_type) || !nonBlank(row.normalized_value_hash) || !nonBlank(row.verification_evidence_hash)
      || !['verified', 'revoked'].includes(row.verification_state) || !positiveInteger(row.row_version) || !validTimestamps(row, ['created_at', 'updated_at'])
      || !validNullableInstant(row.verified_at) || !validNullableInstant(row.revoked_at) || contactIds.has(row.contact_id)) return false;
    const verified = row.verification_state === 'verified';
    if ((verified && (row.verified_at === null || row.revoked_at !== null)) || (!verified && (row.verified_at === null || row.revoked_at === null))) return false;
    if (verified && accounts.get(row.account_id).status !== 'active') return false;
    const identity = `${row.authority_id}\u0000${row.contact_type}\u0000${row.normalized_value_hash}`;
    if (identities.has(identity)) return false;
    contactIds.add(row.contact_id); identities.add(identity);
  }
  return true;
}
function parseLinkRevokeObject(json, fields) {
  if (typeof json !== 'string') return null;
  try {
    const value = JSON.parse(json);
    return value && Object.getPrototypeOf(value) === Object.prototype && sameKeys(value, fields) && linkRevokeStableJson(value) === json ? value : null;
  } catch (_) { return null; }
}
function nullCommittedVersions(receipt) {
  return receipt.committed_auth_version === null && receipt.committed_access_version === null && receipt.committed_revocation_version === null && receipt.committed_target_row_version === null;
}
function validLinkRevocationEvidence(snapshot) {
  if (snapshot.receipts.length === 0 && snapshot.auditEvents.length === 0 && snapshot.outboxEvents.length === 0) return true;
  const authorityId = snapshot.authorities[0].authority_id;
  const accounts = new Set(snapshot.accounts.map(row => row.account_id));
  const links = new Map(snapshot.links.map(row => [row.link_id, row]));
  const audits = new Map();
  const auditEventIds = new Set();
  for (const audit of snapshot.auditEvents) {
    if (!sameKeys(audit, LINK_REVOCATION_EVIDENCE_FIELDS.auditEvents) || !nonBlank(audit.event_id) || audit.authority_id !== authorityId || !nonBlank(audit.receipt_id) || !canonicalText(audit.reason_code) || !/^[0-9a-f]{64}$/.test(audit.context_sha256) || !finiteInstant(audit.created_at)
      || !audit.context || Object.getPrototypeOf(audit.context) !== Object.prototype || !sameKeys(audit.context, ['accountId', 'linkId', 'policyRevision']) || !nonBlank(audit.context.accountId) || !nonBlank(audit.context.linkId) || !positiveInteger(audit.context.policyRevision)
      || audit.context_sha256 !== sha256Text(linkRevokeStableJson(audit.context)) || audits.has(audit.receipt_id) || auditEventIds.has(audit.event_id)) return false;
    audits.set(audit.receipt_id, audit);
    auditEventIds.add(audit.event_id);
  }
  const outbox = new Map();
  const outboxEventIds = new Set();
  for (const event of snapshot.outboxEvents) {
    if (!sameKeys(event, LINK_REVOCATION_EVIDENCE_FIELDS.outboxEvents) || !nonBlank(event.event_id) || event.authority_id !== authorityId || !nonBlank(event.receipt_id) || !nonBlank(event.event_type) || !nonBlank(event.aggregate_kind) || !nonBlank(event.aggregate_id) || !positiveInteger(event.aggregate_version) || !finiteInstant(event.occurred_at)
      || !/^[0-9a-f]{64}$/.test(event.payload_sha256) || event.payload_sha256 !== sha256Text(event.canonical_payload_json) || outbox.has(event.receipt_id) || outboxEventIds.has(event.event_id)) return false;
    outbox.set(event.receipt_id, event);
    outboxEventIds.add(event.event_id);
  }
  const receiptIds = new Set();
  const idempotencyKeys = new Set();
  const acceptedReceiptIds = new Set();
  for (const receipt of snapshot.receipts) {
    if (!sameKeys(receipt, LINK_REVOCATION_EVIDENCE_FIELDS.receipts) || !nonBlank(receipt.receipt_id) || receipt.authority_id !== authorityId || !nonBlank(receipt.actor_account_id) || receipt.actor_key !== `account:${receipt.actor_account_id}` || !accounts.has(receipt.actor_account_id)
      || !canonicalText(receipt.idempotency_key) || receipt.command_type !== 'account_device_link.revoke' || receipt.target_kind !== 'account_device_link' || !nonBlank(receipt.target_id) || !positiveInteger(receipt.expected_row_version) || !['accepted', 'noop', 'rejected'].includes(receipt.outcome) || !nonBlank(receipt.result_code) || !finiteInstant(receipt.created_at)
      || !/^[0-9a-f]{64}$/.test(receipt.canonical_request_sha256) || !/^[0-9a-f]{64}$/.test(receipt.canonical_result_sha256) || ![receipt.committed_auth_version, receipt.committed_access_version, receipt.committed_revocation_version, receipt.committed_target_row_version].every(value => value === null || positiveInteger(value)) || receiptIds.has(receipt.receipt_id) || idempotencyKeys.has(`${receipt.authority_id}\u0000${receipt.actor_key}\u0000${receipt.idempotency_key}`)) return false;
    const request = receipt.canonicalRequest;
    if (!request || Object.getPrototypeOf(request) !== Object.prototype || !sameKeys(request, ['type', 'targetLinkId', 'expectedTargetRowVersion', 'idempotencyKey', 'reasonCode']) || request.type !== receipt.command_type || request.targetLinkId !== receipt.target_id || request.expectedTargetRowVersion !== receipt.expected_row_version || request.idempotencyKey !== receipt.idempotency_key || !canonicalText(request.idempotencyKey) || !canonicalText(request.reasonCode)
      || receipt.canonical_request_sha256 !== sha256Text(linkRevokeStableJson({ expectedTargetRowVersion: request.expectedTargetRowVersion, reasonCode: request.reasonCode, targetLinkId: request.targetLinkId, type: request.type }))) return false;
    const target = links.get(receipt.target_id);
    const result = parseLinkRevokeObject(receipt.canonical_result_json, ['code', 'linkId', 'linkRowVersion', 'policyRevision', 'revokedAt', 'status', 'targetStatus']);
    const audit = audits.get(receipt.receipt_id);
    const event = outbox.get(receipt.receipt_id);
    if (!result || receipt.canonical_result_sha256 !== sha256Text(receipt.canonical_result_json) || result.code !== receipt.result_code || result.linkId !== receipt.target_id || !(result.linkRowVersion === null || positiveInteger(result.linkRowVersion)) || !positiveInteger(result.policyRevision) || !(result.revokedAt === null || finiteInstant(result.revokedAt)) || result.status !== receipt.outcome || !['active', 'expired', 'missing', 'revoked', 'self'].includes(result.targetStatus)
      || !audit || audit.reason_code !== request.reasonCode || audit.created_at !== receipt.created_at || audit.context.accountId !== receipt.actor_account_id || !links.has(audit.context.linkId) || links.get(audit.context.linkId).account_id !== receipt.actor_account_id || audit.context.policyRevision !== result.policyRevision) return false;
    if (receipt.outcome === 'accepted') {
      if (!target || target.status !== 'revoked' || target.auth_version !== receipt.committed_auth_version || target.access_version !== receipt.committed_access_version || target.row_version !== receipt.committed_target_row_version || target.row_version !== receipt.expected_row_version + 1 || target.updated_at !== receipt.created_at || target.revoked_at !== receipt.created_at
        || result.code !== 'ACCOUNT_DEVICE_LINK_REVOKED' || result.linkRowVersion !== target.row_version || result.revokedAt !== receipt.created_at || result.targetStatus !== 'revoked' || audit.context.linkId === receipt.target_id
        || !event || event.event_type !== 'authorization.account_device_link_revoked' || event.aggregate_kind !== 'account_device_link' || event.aggregate_id !== receipt.target_id || event.aggregate_version !== target.row_version || event.occurred_at !== receipt.created_at || event.canonical_payload_json !== linkRevokeStableJson({ accountId: target.account_id, linkAccessVersion: target.access_version, linkAuthVersion: target.auth_version, linkId: receipt.target_id, linkRowVersion: target.row_version }) || event.payload_sha256 !== sha256Text(event.canonical_payload_json)) return false;
      acceptedReceiptIds.add(receipt.receipt_id);
    } else if (receipt.outcome === 'noop') {
      if (!target || target.status !== 'revoked' || result.code !== 'ACCOUNT_DEVICE_LINK_ALREADY_REVOKED' || result.targetStatus !== 'revoked' || result.linkRowVersion !== target.row_version || result.revokedAt !== target.revoked_at || !nullCommittedVersions(receipt) || audit.context.linkId === receipt.target_id || event) return false;
    } else {
      const versionConflict = result.code === 'ACCOUNT_DEVICE_LINK_VERSION_CONFLICT' && target && target.status === 'active' && result.targetStatus === 'active' && result.linkRowVersion === target.row_version && result.linkRowVersion !== receipt.expected_row_version && result.revokedAt === null && audit.context.linkId !== receipt.target_id;
      const notActive = result.code === 'ACCOUNT_DEVICE_LINK_NOT_ACTIVE' && ((result.targetStatus === 'missing' && !target && result.linkRowVersion === null) || (result.targetStatus === 'expired' && target && target.status === 'expired' && result.linkRowVersion === target.row_version)) && result.revokedAt === null && audit.context.linkId !== receipt.target_id;
      const self = result.code === 'ACCOUNT_DEVICE_LINK_SELF_REVOKE_FORBIDDEN' && result.targetStatus === 'self' && result.linkRowVersion === null && result.revokedAt === null && audit.context.linkId === receipt.target_id;
      if (!(versionConflict || notActive || self) || !nullCommittedVersions(receipt) || event) return false;
    }
    receiptIds.add(receipt.receipt_id);
    idempotencyKeys.add(`${receipt.authority_id}\u0000${receipt.actor_key}\u0000${receipt.idempotency_key}`);
  }
  return snapshot.auditEvents.length === receiptIds.size && snapshot.outboxEvents.length === acceptedReceiptIds.size;
}
function sourceTable(collection) { return `legacy_source_${collection}`; }
function readSnapshot(database) {
  const snapshot = {};
  for (const collection of COLLECTIONS) {
    snapshot[collection] = database.prepare(`SELECT row_json FROM ${sourceTable(collection)} ORDER BY ordinal`).all().map(row => JSON.parse(row.row_json));
  }
  return clone(snapshot);
}

function createVNextPg17SyntheticControlPlaneSource(snapshot) {
  const copy = clone(snapshot);
  if (Reflect.ownKeys(copy).length !== COLLECTIONS.length
    || COLLECTIONS.some(key => !Array.isArray(copy[key]))
    || copy.authorities.length !== 1 || copy.authorities[0].status !== 'active'
    || DEFERRED_MAPPED_COLLECTIONS.some(key => copy[key].length !== 0)
    || !validIdentityTopology(copy) || !validHistoricalAuthorization(copy) || !validProfileMetadata(copy) || !validVerifiedContactMetadata(copy) || !validLinkRevocationEvidence(copy)) {
    throw fail('VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID');
  }
  const database = new Database(':memory:');
  database.exec(`${COLLECTIONS.map(collection => `CREATE TABLE ${sourceTable(collection)} (ordinal INTEGER PRIMARY KEY, row_json TEXT NOT NULL)`).join(';')}; CREATE TABLE legacy_control_plane_fingerprint (value TEXT NOT NULL)`);
  for (const collection of COLLECTIONS) for (const [ordinal, row] of canonicalCollectionRows(copy[collection]).entries()) database.prepare(`INSERT INTO ${sourceTable(collection)}(ordinal,row_json) VALUES(?,?)`).run(ordinal, canonical(row));
  database.prepare('INSERT INTO legacy_control_plane_fingerprint(value) VALUES(?)').run(fingerprint(copy));
  const source = Object.freeze({});
  sources.set(source, { database });
  return source;
}

async function rehearseVNextPg17ControlPlaneCopy({ source, target, faultPlan } = {}) {
  const state = sources.get(source);
  if (!state || !target) throw fail('VNEXT_PG17_COPY_REHEARSAL_INPUT_INVALID');
  const before = state.database.prepare('SELECT value FROM legacy_control_plane_fingerprint').get().value;
  const snapshot = readSnapshot(state.database);
  if (before !== fingerprint(snapshot)) throw fail('VNEXT_PG17_COPY_REHEARSAL_SOURCE_CHANGED');
  const sourceIdentityLogicalSha256 = sha256(identityLogicalRows(snapshot));
  const sourceHistoricalLogicalSha256 = sha256(historicalAuthorizationLogicalRows(snapshot));
  const sourceProfileBindingLogicalSha256 = sha256(profileMetadataLogicalRows(snapshot));
  const sourceVerifiedContactLogicalSha256 = sha256(verifiedContactLogicalRows(snapshot));
  const sourceLinkRevocationEvidenceLogicalSha256 = sha256(linkRevocationEvidenceLogicalRows(snapshot));
  try {
  const report = await withVNextPg17CopyOnlyRehearsalTarget(target, async facade => {
    if ((await facade.countTargetDataRows()).some(row => row.count !== 0)) throw fail('VNEXT_PG17_COPY_REHEARSAL_TARGET_NOT_EMPTY');
    const row = snapshot.authorities[0];
    await facade.insertAuthority(row);
    for (const collection of ['accounts', 'trustedDevices', 'installations', 'links']) for (const item of snapshot[collection]) await facade.insertFoundation(collection, item);
    for (const collection of HISTORICAL_AUTHORIZATION_COLLECTIONS) for (const item of snapshot[collection]) await facade.insertHistoricalAuthorization(collection, item);
    for (const collection of PROFILE_METADATA_COLLECTIONS) for (const item of snapshot[collection]) await facade.insertProfileMetadata(collection, item);
    for (const collection of VERIFIED_CONTACT_COLLECTIONS) for (const item of snapshot[collection]) await facade.insertVerifiedContact(collection, item);
    for (const collection of LINK_REVOCATION_EVIDENCE_COLLECTIONS) {
      for (const item of snapshot[collection]) {
        const targetRow = Object.fromEntries(LINK_REVOCATION_TARGET_FIELDS[collection].map(field => [field, item[field]]));
        await facade.insertLinkRevocationEvidence(collection, targetRow);
      }
    }
    const targetIdentity = await facade.readIdentityTopology();
    const targetHistorical = await facade.readHistoricalAuthorization();
    const targetProfile = await facade.readProfileMetadata();
    const targetContacts = await facade.readVerifiedContacts();
    const targetEvidence = await facade.readLinkRevocationEvidence();
    const targetSnapshot = Object.fromEntries(IDENTITY_COLLECTIONS.map(collection => [collection, targetIdentity[collection]]));
    const targetIdentityLogicalSha256 = sha256(identityLogicalRows(targetSnapshot));
    if (targetIdentityLogicalSha256 !== sourceIdentityLogicalSha256) throw fail('VNEXT_PG17_COPY_REHEARSAL_LOGICAL_MISMATCH');
    const targetHistoricalSnapshot = Object.fromEntries(HISTORICAL_AUTHORIZATION_COLLECTIONS.map(collection => [collection, targetHistorical[collection]]));
    const targetHistoricalLogicalSha256 = sha256(historicalAuthorizationLogicalRows(targetHistoricalSnapshot));
    if (targetHistoricalLogicalSha256 !== sourceHistoricalLogicalSha256) throw fail('VNEXT_PG17_COPY_REHEARSAL_LOGICAL_MISMATCH');
    const targetProfileSnapshot = Object.fromEntries(PROFILE_METADATA_COLLECTIONS.map(collection => [collection, targetProfile[collection]]));
    const targetProfileBindingLogicalSha256 = sha256(profileMetadataLogicalRows(targetProfileSnapshot));
    if (targetProfileBindingLogicalSha256 !== sourceProfileBindingLogicalSha256) throw fail('VNEXT_PG17_COPY_REHEARSAL_LOGICAL_MISMATCH');
    const targetVerifiedContactSnapshot = Object.fromEntries(VERIFIED_CONTACT_COLLECTIONS.map(collection => [collection, targetContacts[collection]]));
    const targetVerifiedContactLogicalSha256 = sha256(verifiedContactLogicalRows(targetVerifiedContactSnapshot));
    if (targetVerifiedContactLogicalSha256 !== sourceVerifiedContactLogicalSha256) throw fail('VNEXT_PG17_COPY_REHEARSAL_LOGICAL_MISMATCH');
    const targetLinkRevocationEvidenceLogicalSha256 = sha256(linkRevocationEvidenceLogicalRows(targetEvidence));
    if (targetLinkRevocationEvidenceLogicalSha256 !== sourceLinkRevocationEvidenceLogicalSha256) throw fail('VNEXT_PG17_COPY_REHEARSAL_LOGICAL_MISMATCH');
    return Object.freeze({ status: 'boundary-verified', schemaVersion: 5, migrationVersion: 15, authorityCount: targetSnapshot.authorities.length, accountCount: targetSnapshot.accounts.length, deviceCount: targetSnapshot.trustedDevices.length, installationCount: targetSnapshot.installations.length, linkCount: targetSnapshot.links.length, capabilityCount: targetHistoricalSnapshot.capabilityCatalog.length, roleGrantCount: targetHistoricalSnapshot.roleGrants.length, capabilityOverrideCount: targetHistoricalSnapshot.capabilityOverrides.length, scopeGrantCount: targetHistoricalSnapshot.dataScopeGrants.length, profileBindingCount: targetProfileSnapshot.profileBindings.length, verifiedContactCount: targetVerifiedContactSnapshot.verifiedContacts.length, receiptCount: targetEvidence.receipts.length, auditEventCount: targetEvidence.auditEvents.length, outboxEventCount: targetEvidence.outboxEvents.length, sourceIdentityLogicalSha256, targetIdentityLogicalSha256, sourceHistoricalLogicalSha256, targetHistoricalLogicalSha256, sourceProfileBindingLogicalSha256, targetProfileBindingLogicalSha256, sourceVerifiedContactLogicalSha256, targetVerifiedContactLogicalSha256, sourceLinkRevocationEvidenceLogicalSha256, targetLinkRevocationEvidenceLogicalSha256, activeRoleGrantCount: targetHistoricalSnapshot.roleGrants.filter(row => row.status === 'active').length, activeCapabilityOverrideCount: targetHistoricalSnapshot.capabilityOverrides.filter(row => row.status === 'active').length, activeScopeGrantCount: targetHistoricalSnapshot.dataScopeGrants.filter(row => row.status === 'active').length, activeProfileBindingCount: targetProfileSnapshot.profileBindings.filter(row => row.status === 'active').length, activeSessionCount: 0, activeReauthenticationCount: 0, outboxDispatchedCount: 0, inertInventory: inventory(snapshot), rollback: Object.freeze({ attempted: false, restoredEmpty: false }) });
  }, faultPlan);
  const after = fingerprint(readSnapshot(state.database));
  if (before !== after) throw fail('VNEXT_PG17_COPY_REHEARSAL_SOURCE_CHANGED');
  return Object.freeze({ ...report, sourceFingerprintBefore: before, sourceFingerprintAfter: after });
  } catch (caught) {
    if (caught && caught.code) throw caught;
    throw fail('VNEXT_PG17_COPY_REHEARSAL_ROLLED_BACK');
  }
}

module.exports = { createVNextPg17SyntheticControlPlaneSource, rehearseVNextPg17ControlPlaneCopy };
