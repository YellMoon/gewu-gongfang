'use strict';

const assert = require('assert');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery, inspectVNextPg17CopyOnlyRehearsalTarget } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { stablePlainObjectJson: linkRevokeStableJson } = require('../vNextCanonicalJsonReference');
const {
  createVNextPg17SyntheticControlPlaneSource,
  rehearseVNextPg17ControlPlaneCopy,
} = require('./controlPlaneCopyOnlyRehearsal');

const TARGET_DATA_TABLES = Object.freeze([
  'vnext_authorities', 'vnext_accounts', 'vnext_trusted_devices', 'vnext_device_installations', 'vnext_account_device_links',
  'vnext_role_grants', 'vnext_capability_catalog', 'vnext_capability_overrides', 'vnext_data_scope_grants', 'vnext_profile_bindings',
  'vnext_verified_contacts', 'vnext_authorization_command_receipts', 'vnext_authorization_audit_events', 'vnext_authorization_outbox_events',
  'vnext_bootstrap_consumptions', 'vnext_authorization_policy_publications', 'vnext_trust_root_evidence', 'vnext_sessions', 'vnext_recent_reauthentication_events',
]);

function sha256Text(value) {
  return require('crypto').createHash('sha256').update(value, 'utf8').digest('hex');
}

function snapshot() {
  return {
    authorities: [{ authority_id: 'authority-1', status: 'active', created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z' }],
    accounts: [{ account_id: 'account-1', authority_id: 'authority-1', status: 'active', auth_version: 1, access_version: 1, revocation_version: 1, row_version: 1, created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z' }],
    trustedDevices: [{ device_id: 'device-1', authority_id: 'authority-1', status: 'active', hardware_evidence_hash: null, risk_code: null, credential_version: 1, risk_version: 1, row_version: 1, created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z', revoked_at: null }],
    installations: [{ installation_id: 'installation-1', authority_id: 'authority-1', device_id: 'device-1', installation_public_key: 'test-key', key_fingerprint: 'a'.repeat(64), status: 'active', credential_version: 1, row_version: 1, created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z', revoked_at: null }],
    links: [{ link_id: 'link-1', authority_id: 'authority-1', account_id: 'account-1', device_id: 'device-1', installation_id: 'installation-1', status: 'active', auth_version: 1, access_version: 1, row_version: 1, created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z', revoked_at: null }], roleGrants: [], capabilityCatalog: [],
    capabilityOverrides: [], dataScopeGrants: [], profileBindings: [], verifiedContacts: [],
    receipts: [], auditEvents: [], outboxEvents: [],
    legacySessions: [], legacyDeviceGrants: [], legacyOfflineLicenses: [], legacyCredentials: [],
    legacyTokens: [], legacyPasswords: [], legacyPrivateKeys: [], legacyBackups: [],
  };
}

function historicalAuthorizationSnapshot() {
  const value = snapshot();
  const startedAt = '2026-08-20T00:00:00.000Z';
  const endedAt = '2026-08-20T00:01:00.000Z';
  const revokedAt = '2026-08-20T00:02:00.000Z';
  value.capabilityCatalog.push(
    { capability_id: 'capability-active', status: 'active', surface_mask: 'desktop', created_at: startedAt },
    { capability_id: 'capability-retired', status: 'retired', surface_mask: 'miniapp', created_at: startedAt },
  );
  value.roleGrants.push(
    { grant_id: 'grant-revoked', authority_id: 'authority-1', account_id: 'account-1', role: 'teacher', status: 'revoked', grant_version: 1, row_version: 1, starts_at: startedAt, ends_at: null, revoked_at: revokedAt, granted_by_account_id: null, created_at: startedAt, updated_at: revokedAt },
    { grant_id: 'grant-expired', authority_id: 'authority-1', account_id: 'account-1', role: 'student', status: 'expired', grant_version: 1, row_version: 1, starts_at: startedAt, ends_at: endedAt, revoked_at: null, granted_by_account_id: null, created_at: startedAt, updated_at: endedAt },
  );
  value.capabilityOverrides.push(
    { override_id: 'override-revoked', authority_id: 'authority-1', account_id: 'account-1', capability_id: 'capability-active', effect: 'deny', status: 'revoked', starts_at: startedAt, ends_at: null, row_version: 1, created_at: startedAt, updated_at: revokedAt, revoked_at: revokedAt },
    { override_id: 'override-expired', authority_id: 'authority-1', account_id: 'account-1', capability_id: 'capability-retired', effect: 'allow', status: 'expired', starts_at: startedAt, ends_at: endedAt, row_version: 1, created_at: startedAt, updated_at: endedAt, revoked_at: null },
  );
  value.dataScopeGrants.push(
    { scope_grant_id: 'scope-revoked', authority_id: 'authority-1', account_id: 'account-1', scope_type: 'teacher_profile', scope_value_hash: 'opaque-scope-a', effect: 'deny', status: 'revoked', starts_at: startedAt, ends_at: null, row_version: 1, created_at: startedAt, updated_at: revokedAt, revoked_at: revokedAt },
    { scope_grant_id: 'scope-expired', authority_id: 'authority-1', account_id: 'account-1', scope_type: 'student_profile', scope_value_hash: 'opaque-scope-b', effect: 'allow', status: 'expired', starts_at: startedAt, ends_at: endedAt, row_version: 1, created_at: startedAt, updated_at: endedAt, revoked_at: null },
  );
  return value;
}

function profileBindingSnapshot() {
  const value = historicalAuthorizationSnapshot();
  const createdAt = '2026-08-20T00:00:00.000Z';
  const revokedAt = '2026-08-20T00:02:00.000Z';
  value.profileBindings.push(
    { binding_id: 'binding-active', authority_id: 'authority-1', account_id: 'account-1', profile_type: 'teacher', profile_id: 'opaque-teacher-profile', status: 'active', evidence_hash: 'opaque-evidence-a', row_version: 1, created_at: createdAt, updated_at: createdAt, revoked_at: null },
    { binding_id: 'binding-pending', authority_id: 'authority-1', account_id: 'account-1', profile_type: 'student', profile_id: 'opaque-student-profile', status: 'pending', evidence_hash: 'opaque-evidence-b', row_version: 1, created_at: createdAt, updated_at: createdAt, revoked_at: null },
    { binding_id: 'binding-revoked', authority_id: 'authority-1', account_id: 'account-1', profile_type: 'teacher', profile_id: 'opaque-revoked-profile', status: 'revoked', evidence_hash: 'opaque-evidence-c', row_version: 1, created_at: createdAt, updated_at: revokedAt, revoked_at: revokedAt },
  );
  return value;
}

function identityLifecycleSnapshot() {
  const value = historicalAuthorizationSnapshot();
  const createdAt = '2026-08-20T00:00:00.000Z';
  const retiredAt = '2026-08-20T00:01:00.000Z';
  const revokedAt = '2026-08-20T00:02:00.000Z';
  value.accounts[0] = { ...value.accounts[0], status: 'disabled', updated_at: retiredAt };
  value.accounts.push({ account_id: 'account-2', authority_id: 'authority-1', status: 'revoked', auth_version: 1, access_version: 1, revocation_version: 1, row_version: 1, created_at: createdAt, updated_at: revokedAt });
  value.trustedDevices[0] = { ...value.trustedDevices[0], status: 'risk_limited', updated_at: retiredAt };
  value.trustedDevices.push(
    { device_id: 'device-2', authority_id: 'authority-1', status: 'revoked', hardware_evidence_hash: null, risk_code: null, credential_version: 1, risk_version: 1, row_version: 1, created_at: createdAt, updated_at: revokedAt, revoked_at: revokedAt },
    { device_id: 'device-3', authority_id: 'authority-1', status: 'retired', hardware_evidence_hash: null, risk_code: null, credential_version: 1, risk_version: 1, row_version: 1, created_at: createdAt, updated_at: retiredAt, revoked_at: null },
  );
  value.installations[0] = { ...value.installations[0], status: 'retired', updated_at: retiredAt };
  value.installations.push({ installation_id: 'installation-2', authority_id: 'authority-1', device_id: 'device-2', installation_public_key: 'test-key-2', key_fingerprint: 'b'.repeat(64), status: 'revoked', credential_version: 1, row_version: 1, created_at: createdAt, updated_at: revokedAt, revoked_at: revokedAt });
  value.links[0] = { ...value.links[0], status: 'expired', updated_at: retiredAt };
  value.links.push({ link_id: 'link-2', authority_id: 'authority-1', account_id: 'account-2', device_id: 'device-2', installation_id: 'installation-2', status: 'revoked', auth_version: 1, access_version: 1, row_version: 1, created_at: createdAt, updated_at: revokedAt, revoked_at: revokedAt });
  return value;
}

function acceptedLinkRevokeEvidenceSnapshot() {
  const value = snapshot();
  const at = '2026-08-20T00:02:00.000Z';
  value.accounts.push({ account_id: 'account-2', authority_id: 'authority-1', status: 'active', auth_version: 1, access_version: 1, revocation_version: 1, row_version: 1, created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z' });
  value.trustedDevices.push({ device_id: 'device-2', authority_id: 'authority-1', status: 'active', hardware_evidence_hash: null, risk_code: null, credential_version: 1, risk_version: 1, row_version: 1, created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z', revoked_at: null });
  value.installations.push({ installation_id: 'installation-2', authority_id: 'authority-1', device_id: 'device-2', installation_public_key: 'test-key-2', key_fingerprint: 'b'.repeat(64), status: 'active', credential_version: 1, row_version: 1, created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z', revoked_at: null });
  value.links[0] = { ...value.links[0], account_id: 'account-2', device_id: 'device-2', installation_id: 'installation-2', status: 'revoked', auth_version: 2, access_version: 2, row_version: 2, updated_at: at, revoked_at: at };
  value.links.push({ link_id: 'link-2', authority_id: 'authority-1', account_id: 'account-1', device_id: 'device-1', installation_id: 'installation-1', status: 'active', auth_version: 1, access_version: 1, row_version: 1, created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z', revoked_at: null });
  const canonicalRequest = { type: 'account_device_link.revoke', targetLinkId: 'link-1', expectedTargetRowVersion: 1, idempotencyKey: 'revoke-1', reasonCode: 'owner-request' };
  const requestJson = linkRevokeStableJson({ expectedTargetRowVersion: 1, reasonCode: 'owner-request', targetLinkId: 'link-1', type: 'account_device_link.revoke' });
  const resultJson = linkRevokeStableJson({ code: 'ACCOUNT_DEVICE_LINK_REVOKED', linkId: 'link-1', linkRowVersion: 2, policyRevision: 1, revokedAt: at, status: 'accepted', targetStatus: 'revoked' });
  const auditContext = { accountId: 'account-1', linkId: 'link-2', policyRevision: 1 };
  const payloadJson = linkRevokeStableJson({ accountId: 'account-2', linkAccessVersion: 2, linkAuthVersion: 2, linkId: 'link-1', linkRowVersion: 2 });
  value.receipts.push({ receipt_id: 'receipt-link-revoke', authority_id: 'authority-1', actor_key: 'account:account-1', actor_account_id: 'account-1', idempotency_key: 'revoke-1', command_type: 'account_device_link.revoke', target_kind: 'account_device_link', target_id: 'link-1', canonical_request_sha256: sha256Text(requestJson), expected_row_version: 1, outcome: 'accepted', result_code: 'ACCOUNT_DEVICE_LINK_REVOKED', canonical_result_json: resultJson, canonical_result_sha256: sha256Text(resultJson), committed_auth_version: 2, committed_access_version: 2, committed_revocation_version: null, committed_target_row_version: 2, created_at: at, canonicalRequest });
  value.auditEvents.push({ event_id: 'audit-link-revoke', authority_id: 'authority-1', receipt_id: 'receipt-link-revoke', reason_code: 'owner-request', context_sha256: sha256Text(linkRevokeStableJson(auditContext)), created_at: at, context: auditContext });
  value.outboxEvents.push({ event_id: 'outbox-link-revoke', authority_id: 'authority-1', receipt_id: 'receipt-link-revoke', event_type: 'authorization.account_device_link_revoked', aggregate_kind: 'account_device_link', aggregate_id: 'link-1', aggregate_version: 2, canonical_payload_json: payloadJson, payload_sha256: sha256Text(payloadJson), occurred_at: at });
  return value;
}

function noopLinkRevokeEvidenceSnapshot() {
  const value = acceptedLinkRevokeEvidenceSnapshot();
  const receipt = value.receipts[0];
  const resultJson = linkRevokeStableJson({ code: 'ACCOUNT_DEVICE_LINK_ALREADY_REVOKED', linkId: 'link-1', linkRowVersion: 2, policyRevision: 1, revokedAt: receipt.created_at, status: 'noop', targetStatus: 'revoked' });
  value.receipts[0] = { ...receipt, outcome: 'noop', result_code: 'ACCOUNT_DEVICE_LINK_ALREADY_REVOKED', canonical_result_json: resultJson, canonical_result_sha256: sha256Text(resultJson), committed_auth_version: null, committed_access_version: null, committed_revocation_version: null, committed_target_row_version: null };
  value.outboxEvents = [];
  return value;
}

function rejectedLinkRevokeEvidenceSnapshot() {
  const value = acceptedLinkRevokeEvidenceSnapshot();
  const receipt = value.receipts[0];
  value.links[0] = { ...value.links[0], status: 'active', auth_version: 1, access_version: 1, row_version: 2, updated_at: '2026-08-20T00:01:00.000Z', revoked_at: null };
  const resultJson = linkRevokeStableJson({ code: 'ACCOUNT_DEVICE_LINK_VERSION_CONFLICT', linkId: 'link-1', linkRowVersion: 2, policyRevision: 1, revokedAt: null, status: 'rejected', targetStatus: 'active' });
  value.receipts[0] = { ...receipt, outcome: 'rejected', result_code: 'ACCOUNT_DEVICE_LINK_VERSION_CONFLICT', canonical_result_json: resultJson, canonical_result_sha256: sha256Text(resultJson), committed_auth_version: null, committed_access_version: null, committed_revocation_version: null, committed_target_row_version: null };
  value.outboxEvents = [];
  return value;
}

function missingLinkRevokeEvidenceSnapshot() {
  const value = acceptedLinkRevokeEvidenceSnapshot();
  const receipt = value.receipts[0];
  const canonicalRequest = { ...receipt.canonicalRequest, targetLinkId: 'missing-link' };
  const requestJson = linkRevokeStableJson({ expectedTargetRowVersion: canonicalRequest.expectedTargetRowVersion, reasonCode: canonicalRequest.reasonCode, targetLinkId: canonicalRequest.targetLinkId, type: canonicalRequest.type });
  const resultJson = linkRevokeStableJson({ code: 'ACCOUNT_DEVICE_LINK_NOT_ACTIVE', linkId: 'missing-link', linkRowVersion: null, policyRevision: 1, revokedAt: null, status: 'rejected', targetStatus: 'missing' });
  value.receipts[0] = { ...receipt, target_id: 'missing-link', canonical_request_sha256: sha256Text(requestJson), canonicalRequest, outcome: 'rejected', result_code: 'ACCOUNT_DEVICE_LINK_NOT_ACTIVE', canonical_result_json: resultJson, canonical_result_sha256: sha256Text(resultJson), committed_auth_version: null, committed_access_version: null, committed_revocation_version: null, committed_target_row_version: null };
  value.outboxEvents = [];
  return value;
}

function selfLinkRevokeEvidenceSnapshot() {
  const value = acceptedLinkRevokeEvidenceSnapshot();
  const receipt = value.receipts[0];
  const canonicalRequest = { ...receipt.canonicalRequest, targetLinkId: 'link-2' };
  const requestJson = linkRevokeStableJson({ expectedTargetRowVersion: canonicalRequest.expectedTargetRowVersion, reasonCode: canonicalRequest.reasonCode, targetLinkId: canonicalRequest.targetLinkId, type: canonicalRequest.type });
  const resultJson = linkRevokeStableJson({ code: 'ACCOUNT_DEVICE_LINK_SELF_REVOKE_FORBIDDEN', linkId: 'link-2', linkRowVersion: null, policyRevision: 1, revokedAt: null, status: 'rejected', targetStatus: 'self' });
  value.receipts[0] = { ...receipt, target_id: 'link-2', canonical_request_sha256: sha256Text(requestJson), canonicalRequest, outcome: 'rejected', result_code: 'ACCOUNT_DEVICE_LINK_SELF_REVOKE_FORBIDDEN', canonical_result_json: resultJson, canonical_result_sha256: sha256Text(resultJson), committed_auth_version: null, committed_access_version: null, committed_revocation_version: null, committed_target_row_version: null };
  value.outboxEvents = [];
  return value;
}

function appendNoopEvidence(value, { receiptId, idempotencyKey, auditEventId }) {
  const extra = noopLinkRevokeEvidenceSnapshot();
  const receipt = extra.receipts[0];
  const canonicalRequest = { ...receipt.canonicalRequest, idempotencyKey };
  extra.receipts[0] = { ...receipt, receipt_id: receiptId, idempotency_key: idempotencyKey, canonicalRequest };
  extra.auditEvents[0] = { ...extra.auditEvents[0], event_id: auditEventId, receipt_id: receiptId };
  value.receipts.push(extra.receipts[0]);
  value.auditEvents.push(extra.auditEvents[0]);
}

function appendAcceptedEvidence(value, { receiptId, idempotencyKey, auditEventId, outboxEventId }) {
  const extra = acceptedLinkRevokeEvidenceSnapshot();
  const receipt = extra.receipts[0];
  const canonicalRequest = { ...receipt.canonicalRequest, idempotencyKey };
  extra.receipts[0] = { ...receipt, receipt_id: receiptId, idempotency_key: idempotencyKey, canonicalRequest };
  extra.auditEvents[0] = { ...extra.auditEvents[0], event_id: auditEventId, receipt_id: receiptId };
  extra.outboxEvents[0] = { ...extra.outboxEvents[0], event_id: outboxEventId, receipt_id: receiptId };
  value.receipts.push(extra.receipts[0]);
  value.auditEvents.push(extra.auditEvents[0]);
  value.outboxEvents.push(extra.outboxEvents[0]);
}

async function runControlPlaneCopyOnlyRehearsalCases(runtime = createDisposablePg17Runtime()) {
  const ownsRuntime = arguments.length === 0;
  if (ownsRuntime) await runtime.start();
  try {
    for (const collection of ['roleGrants', 'capabilityOverrides', 'dataScopeGrants']) {
      const unsafe = snapshot();
      unsafe[collection].push({ status: 'active' });
      assert.throws(
        () => createVNextPg17SyntheticControlPlaneSource(unsafe),
        error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
      );
    }
    for (const [collection, index] of [['roleGrants', 0], ['capabilityOverrides', 0], ['dataScopeGrants', 0]]) {
      const unsafe = historicalAuthorizationSnapshot();
      unsafe[collection][index].status = 'active';
      assert.throws(
        () => createVNextPg17SyntheticControlPlaneSource(unsafe),
        error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
      );
    }
    const missingCapability = historicalAuthorizationSnapshot();
    missingCapability.capabilityOverrides[0].capability_id = 'not-present';
    assert.throws(
      () => createVNextPg17SyntheticControlPlaneSource(missingCapability),
      error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
    );
    const invalidHistoricalLifecycle = historicalAuthorizationSnapshot();
    invalidHistoricalLifecycle.dataScopeGrants[0].revoked_at = null;
    assert.throws(
      () => createVNextPg17SyntheticControlPlaneSource(invalidHistoricalLifecycle),
      error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
    );
    const invalidProfileLifecycle = profileBindingSnapshot();
    invalidProfileLifecycle.profileBindings[1].revoked_at = '2026-08-20T00:02:00.000Z';
    assert.throws(
      () => createVNextPg17SyntheticControlPlaneSource(invalidProfileLifecycle),
      error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
    );
    const duplicateActiveAccountType = profileBindingSnapshot();
    duplicateActiveAccountType.profileBindings[1] = { ...duplicateActiveAccountType.profileBindings[1], profile_type: 'teacher', profile_id: 'opaque-second-teacher', status: 'active' };
    assert.throws(
      () => createVNextPg17SyntheticControlPlaneSource(duplicateActiveAccountType),
      error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
    );
    const duplicateActiveProfile = profileBindingSnapshot();
    duplicateActiveProfile.accounts.push({ account_id: 'account-2', authority_id: 'authority-1', status: 'active', auth_version: 1, access_version: 1, revocation_version: 1, row_version: 1, created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z' });
    duplicateActiveProfile.profileBindings[1] = { ...duplicateActiveProfile.profileBindings[1], account_id: 'account-2', profile_type: 'teacher', profile_id: 'opaque-teacher-profile', status: 'active' };
    assert.throws(
      () => createVNextPg17SyntheticControlPlaneSource(duplicateActiveProfile),
      error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
    );
    const invalidAccountState = snapshot();
    invalidAccountState.accounts[0].status = 'pending';
    assert.throws(
      () => createVNextPg17SyntheticControlPlaneSource(invalidAccountState),
      error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
    );
    const invalidDeviceRevocation = snapshot();
    invalidDeviceRevocation.trustedDevices[0] = { ...invalidDeviceRevocation.trustedDevices[0], status: 'retired', revoked_at: '2026-08-20T00:02:00.000Z' };
    assert.throws(
      () => createVNextPg17SyntheticControlPlaneSource(invalidDeviceRevocation),
      error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
    );
    const invalidExpiredLink = snapshot();
    invalidExpiredLink.links[0] = { ...invalidExpiredLink.links[0], status: 'expired', revoked_at: '2026-08-20T00:02:00.000Z' };
    assert.throws(
      () => createVNextPg17SyntheticControlPlaneSource(invalidExpiredLink),
      error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
    );
    for (const collection of ['trustedDevices', 'installations', 'links']) {
      const revokedWithoutTime = snapshot();
      revokedWithoutTime[collection][0] = { ...revokedWithoutTime[collection][0], status: 'revoked', revoked_at: null };
      assert.throws(
        () => createVNextPg17SyntheticControlPlaneSource(revokedWithoutTime),
        error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
      );
    }
    for (const [collection, status] of [['trustedDevices', 'active'], ['trustedDevices', 'risk_limited'], ['trustedDevices', 'retired'], ['installations', 'active'], ['installations', 'retired'], ['links', 'active'], ['links', 'expired']]) {
      const nonRevokedWithTime = snapshot();
      nonRevokedWithTime[collection][0] = { ...nonRevokedWithTime[collection][0], status, revoked_at: '2026-08-20T00:02:00.000Z' };
      assert.throws(
        () => createVNextPg17SyntheticControlPlaneSource(nonRevokedWithTime),
        error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
      );
    }
    for (const collection of ['trustedDevices', 'installations', 'links']) {
      const invalidStatus = snapshot();
      invalidStatus[collection][0].status = 'invalid';
      assert.throws(
        () => createVNextPg17SyntheticControlPlaneSource(invalidStatus),
        error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
      );
    }
    const activeProfileOnDisabledAccount = profileBindingSnapshot();
    activeProfileOnDisabledAccount.accounts[0].status = 'disabled';
    assert.throws(
      () => createVNextPg17SyntheticControlPlaneSource(activeProfileOnDisabledAccount),
      error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
    );
    const activeProfileOnRevokedAccount = profileBindingSnapshot();
    activeProfileOnRevokedAccount.accounts[0].status = 'revoked';
    assert.throws(
      () => createVNextPg17SyntheticControlPlaneSource(activeProfileOnRevokedAccount),
      error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
    );
    const accessorHistorical = historicalAuthorizationSnapshot();
    const originalRoleGrant = accessorHistorical.roleGrants[0];
    let accessorReads = 0;
    Object.defineProperty(accessorHistorical.roleGrants, '0', { enumerable: true, get() { accessorReads += 1; return originalRoleGrant; } });
    assert.throws(
      () => createVNextPg17SyntheticControlPlaneSource(accessorHistorical),
      error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
    );
    assert.strictEqual(accessorReads, 0);
    const proxiedHistorical = historicalAuthorizationSnapshot();
    proxiedHistorical.capabilityCatalog = new Proxy(proxiedHistorical.capabilityCatalog, {});
    assert.throws(
      () => createVNextPg17SyntheticControlPlaneSource(proxiedHistorical),
      error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
    );
    const authorityExtra = snapshot();
    authorityExtra.authorities[0].unexpected = 'must-not-be-dropped';
    assert.throws(
      () => createVNextPg17SyntheticControlPlaneSource(authorityExtra),
      error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
    );
    assert.doesNotThrow(() => createVNextPg17SyntheticControlPlaneSource(acceptedLinkRevokeEvidenceSnapshot()));
    assert.doesNotThrow(() => createVNextPg17SyntheticControlPlaneSource(noopLinkRevokeEvidenceSnapshot()));
    assert.doesNotThrow(() => createVNextPg17SyntheticControlPlaneSource(rejectedLinkRevokeEvidenceSnapshot()));
    assert.doesNotThrow(() => createVNextPg17SyntheticControlPlaneSource(missingLinkRevokeEvidenceSnapshot()));
    assert.doesNotThrow(() => createVNextPg17SyntheticControlPlaneSource(selfLinkRevokeEvidenceSnapshot()));
    for (const mutate of [
      value => { value.receipts[0].command_type = 'unknown.command'; },
      value => { value.receipts[0].canonical_request_sha256 = '0'.repeat(64); },
      value => { value.links[0] = { ...value.links[0], status: 'active', revoked_at: null }; },
      value => { value.auditEvents = []; },
    ]) {
      const malformed = acceptedLinkRevokeEvidenceSnapshot();
      mutate(malformed);
      assert.throws(
        () => createVNextPg17SyntheticControlPlaneSource(malformed),
        error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
      );
    }
    const duplicateReceiptIdempotency = acceptedLinkRevokeEvidenceSnapshot();
    appendNoopEvidence(duplicateReceiptIdempotency, { receiptId: 'receipt-link-revoke-2', idempotencyKey: 'revoke-1', auditEventId: 'audit-link-revoke-2' });
    const duplicateAuditEvent = acceptedLinkRevokeEvidenceSnapshot();
    appendNoopEvidence(duplicateAuditEvent, { receiptId: 'receipt-link-revoke-2', idempotencyKey: 'revoke-2', auditEventId: 'audit-link-revoke' });
    const duplicateOutboxEvent = acceptedLinkRevokeEvidenceSnapshot();
    appendAcceptedEvidence(duplicateOutboxEvent, { receiptId: 'receipt-link-revoke-2', idempotencyKey: 'revoke-2', auditEventId: 'audit-link-revoke-2', outboxEventId: 'outbox-link-revoke' });
    for (const duplicate of [duplicateReceiptIdempotency, duplicateAuditEvent, duplicateOutboxEvent]) {
      assert.throws(
        () => createVNextPg17SyntheticControlPlaneSource(duplicate),
        error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
      );
    }
    for (const createSnapshot of [noopLinkRevokeEvidenceSnapshot, rejectedLinkRevokeEvidenceSnapshot]) {
      const malformed = createSnapshot();
      malformed.outboxEvents = acceptedLinkRevokeEvidenceSnapshot().outboxEvents;
      assert.throws(
        () => createVNextPg17SyntheticControlPlaneSource(malformed),
        error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
      );
    }
    for (const mutate of [
      value => {
        value.receipts[0].idempotency_key = ' revoke-1 ';
        value.receipts[0].canonicalRequest = { ...value.receipts[0].canonicalRequest, idempotencyKey: ' revoke-1 ' };
      },
      value => {
        const canonicalRequest = { ...value.receipts[0].canonicalRequest, reasonCode: ' owner-request ' };
        const requestJson = linkRevokeStableJson({ expectedTargetRowVersion: canonicalRequest.expectedTargetRowVersion, reasonCode: canonicalRequest.reasonCode, targetLinkId: canonicalRequest.targetLinkId, type: canonicalRequest.type });
        value.receipts[0].canonicalRequest = canonicalRequest;
        value.receipts[0].canonical_request_sha256 = sha256Text(requestJson);
        value.auditEvents[0].reason_code = canonicalRequest.reasonCode;
      },
    ]) {
      const nonCanonical = acceptedLinkRevokeEvidenceSnapshot();
      mutate(nonCanonical);
      assert.throws(
        () => createVNextPg17SyntheticControlPlaneSource(nonCanonical),
        error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
      );
    }
    const crossAuthorityAccount = snapshot();
    crossAuthorityAccount.accounts[0].authority_id = 'authority-2';
    assert.throws(
      () => createVNextPg17SyntheticControlPlaneSource(crossAuthorityAccount),
      error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
    );
    for (const collection of ['profileBindings', 'verifiedContacts', 'receipts', 'auditEvents', 'outboxEvents']) {
      const unsupported = snapshot();
      unsupported[collection].push({ opaque: collection });
      assert.throws(
        () => createVNextPg17SyntheticControlPlaneSource(unsupported),
        error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID',
      );
    }
    const handle = await runtime.createIsolatedHandle();
    try {
      await createVNextPg17CatalogBoundary(runtime).apply(handle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'copy-only-test' });
      const mutable = snapshot();
      mutable.legacySessions.push({ legacy_id: 'legacy-session-1' });
      const source = createVNextPg17SyntheticControlPlaneSource(mutable);
      mutable.authorities[0].authority_id = 'mutated-authority';
      const target = runtime.createVNextPg17CopyOnlyRehearsalTarget(handle);
      const result = await rehearseVNextPg17ControlPlaneCopy({ source, target });
      assert.strictEqual(result.status, 'boundary-verified');
      assert.deepStrictEqual(result.rollback, { attempted: false, restoredEmpty: false });
      assert.strictEqual(result.authorityCount, 1);
      assert.strictEqual(result.accountCount, 1);
      assert.strictEqual(result.deviceCount, 1);
      assert.strictEqual(result.installationCount, 1);
      assert.strictEqual(result.linkCount, 1);
      assert.strictEqual(result.activeRoleGrantCount, 0);
      assert.strictEqual(result.activeCapabilityOverrideCount, 0);
      assert.strictEqual(result.activeScopeGrantCount, 0);
      assert.strictEqual(result.activeSessionCount, 0);
      assert.strictEqual(result.activeReauthenticationCount, 0);
      assert.match(result.sourceFingerprintBefore, /^[0-9a-f]{64}$/);
      assert.strictEqual(result.sourceFingerprintAfter, result.sourceFingerprintBefore);
      assert.strictEqual(result.sourceIdentityLogicalSha256, result.targetIdentityLogicalSha256);
      assert.deepStrictEqual(result.inertInventory.legacySessions, {
        count: 1,
        sha256: require('crypto').createHash('sha256').update(JSON.stringify([{ legacy_id: 'legacy-session-1' }]), 'utf8').digest('hex'),
      });
      const trace = inspectVNextPg17CopyOnlyRehearsalTarget(target);
      assert.strictEqual(trace.queries[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ');
      assert.strictEqual(trace.queries.at(-1), 'COMMIT');
      assert.ok(trace.queries.every(text => /^(BEGIN ISOLATION LEVEL REPEATABLE READ|COMMIT|ROLLBACK|SELECT |INSERT INTO vnext_control_plane\.)/.test(text)));
      await assert.rejects(
        () => rehearseVNextPg17ControlPlaneCopy({ source, target }),
        error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_TARGET_NOT_EMPTY',
      );
      const ordered = snapshot();
      ordered.legacySessions.push({ legacy_id: 'legacy-a' }, { legacy_id: 'legacy-b' });
      const permuted = snapshot();
      permuted.legacySessions.push({ legacy_id: 'legacy-b' }, { legacy_id: 'legacy-a' });
      const orderedHandle = await runtime.createIsolatedHandle();
      const permutedHandle = await runtime.createIsolatedHandle();
      try {
        await createVNextPg17CatalogBoundary(runtime).apply(orderedHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'copy-only-canonical-test' });
        await createVNextPg17CatalogBoundary(runtime).apply(permutedHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'copy-only-canonical-test' });
        const orderedResult = await rehearseVNextPg17ControlPlaneCopy({ source: createVNextPg17SyntheticControlPlaneSource(ordered), target: runtime.createVNextPg17CopyOnlyRehearsalTarget(orderedHandle) });
        const permutedResult = await rehearseVNextPg17ControlPlaneCopy({ source: createVNextPg17SyntheticControlPlaneSource(permuted), target: runtime.createVNextPg17CopyOnlyRehearsalTarget(permutedHandle) });
        assert.strictEqual(orderedResult.sourceFingerprintBefore, permutedResult.sourceFingerprintBefore);
        assert.deepStrictEqual(orderedResult.inertInventory, permutedResult.inertInventory);
      } finally {
        await runtime.disposeHandle(orderedHandle);
        await runtime.disposeHandle(permutedHandle);
      }
      const nonEmptyHandle = await runtime.createIsolatedHandle();
      try {
        await createVNextPg17CatalogBoundary(runtime).apply(nonEmptyHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'copy-only-nonempty-test' });
        await withVNextPg17SyntheticQuery(nonEmptyHandle, 'fixture-provisioner', facade =>
          facade.query("INSERT INTO vnext_control_plane.vnext_capability_catalog(capability_id,status,surface_mask,created_at) VALUES('legacy-capability','retired','desktop','2026-08-20T00:00:00.000Z')"));
        await assert.rejects(
          () => rehearseVNextPg17ControlPlaneCopy({ source, target: runtime.createVNextPg17CopyOnlyRehearsalTarget(nonEmptyHandle) }),
          error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_TARGET_NOT_EMPTY',
        );
      } finally { await runtime.disposeHandle(nonEmptyHandle); }
      const driftHandle = await runtime.createIsolatedHandle();
      try {
        await createVNextPg17CatalogBoundary(runtime).apply(driftHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'copy-only-drift-test' });
        await withVNextPg17SyntheticQuery(driftHandle, 'fixture-provisioner', facade =>
          facade.query('ALTER TABLE vnext_control_plane.vnext_authorities ALTER COLUMN status SET DEFAULT \'active\''));
        await assert.rejects(
          () => rehearseVNextPg17ControlPlaneCopy({ source, target: runtime.createVNextPg17CopyOnlyRehearsalTarget(driftHandle) }),
          error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
        );
      } finally { await runtime.disposeHandle(driftHandle); }
      const historicalHandle = await runtime.createIsolatedHandle();
      try {
        await createVNextPg17CatalogBoundary(runtime).apply(historicalHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'historical-authorization-test' });
        const historicalResult = await rehearseVNextPg17ControlPlaneCopy({
          source: createVNextPg17SyntheticControlPlaneSource(historicalAuthorizationSnapshot()),
          target: runtime.createVNextPg17CopyOnlyRehearsalTarget(historicalHandle),
        });
        assert.strictEqual(historicalResult.capabilityCount, 2);
        assert.strictEqual(historicalResult.roleGrantCount, 2);
        assert.strictEqual(historicalResult.capabilityOverrideCount, 2);
        assert.strictEqual(historicalResult.scopeGrantCount, 2);
        assert.strictEqual(historicalResult.activeRoleGrantCount, 0);
        assert.strictEqual(historicalResult.activeCapabilityOverrideCount, 0);
        assert.strictEqual(historicalResult.activeScopeGrantCount, 0);
        assert.strictEqual(historicalResult.sourceHistoricalLogicalSha256, historicalResult.targetHistoricalLogicalSha256);
        assert.match(historicalResult.sourceHistoricalLogicalSha256, /^[0-9a-f]{64}$/);
      } finally { await runtime.disposeHandle(historicalHandle); }
      const profileHandle = await runtime.createIsolatedHandle();
      try {
        await createVNextPg17CatalogBoundary(runtime).apply(profileHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'profile-binding-test' });
        const profileTarget = runtime.createVNextPg17CopyOnlyRehearsalTarget(profileHandle);
        const profileResult = await rehearseVNextPg17ControlPlaneCopy({
          source: createVNextPg17SyntheticControlPlaneSource(profileBindingSnapshot()),
          target: profileTarget,
        });
        assert.strictEqual(profileResult.profileBindingCount, 3);
        assert.strictEqual(profileResult.activeProfileBindingCount, 1);
        assert.strictEqual(profileResult.sourceProfileBindingLogicalSha256, profileResult.targetProfileBindingLogicalSha256);
        const profileTrace = inspectVNextPg17CopyOnlyRehearsalTarget(profileTarget);
        assert.ok(profileTrace.queries.some(text => text.startsWith('INSERT INTO vnext_control_plane.vnext_profile_bindings(')));
        assert.ok(profileTrace.queries.some(text => text.includes('FROM vnext_control_plane.vnext_profile_bindings ORDER BY binding_id')));
        assert.ok(profileTrace.queries.every(text => /^(BEGIN ISOLATION LEVEL REPEATABLE READ|COMMIT|ROLLBACK|SELECT |INSERT INTO vnext_control_plane\.)/.test(text)));
      } finally { await runtime.disposeHandle(profileHandle); }
      const evidenceHandle = await runtime.createIsolatedHandle();
      try {
        await createVNextPg17CatalogBoundary(runtime).apply(evidenceHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'link-revoke-evidence-test' });
        const evidenceTarget = runtime.createVNextPg17CopyOnlyRehearsalTarget(evidenceHandle);
        const evidenceResult = await rehearseVNextPg17ControlPlaneCopy({
          source: createVNextPg17SyntheticControlPlaneSource(acceptedLinkRevokeEvidenceSnapshot()),
          target: evidenceTarget,
        });
        await withVNextPg17SyntheticQuery(evidenceHandle, 'fixture-provisioner', async facade => {
          for (const relation of ['vnext_authorization_command_receipts', 'vnext_authorization_audit_events', 'vnext_authorization_outbox_events']) {
            assert.strictEqual(Number((await facade.query(`SELECT COUNT(*)::int AS count FROM vnext_control_plane.${relation}`)).rows[0].count), 1);
          }
        });
        assert.strictEqual(evidenceResult.receiptCount, 1);
        assert.strictEqual(evidenceResult.auditEventCount, 1);
        assert.strictEqual(evidenceResult.outboxEventCount, 1);
        assert.strictEqual(evidenceResult.sourceLinkRevocationEvidenceLogicalSha256, evidenceResult.targetLinkRevocationEvidenceLogicalSha256);
        const evidenceTrace = inspectVNextPg17CopyOnlyRehearsalTarget(evidenceTarget);
        assert.ok(evidenceTrace.queries.some(text => text.startsWith('INSERT INTO vnext_control_plane.vnext_authorization_command_receipts(')));
        assert.ok(evidenceTrace.queries.some(text => text.startsWith('INSERT INTO vnext_control_plane.vnext_authorization_audit_events(')));
        assert.ok(evidenceTrace.queries.some(text => text.startsWith('INSERT INTO vnext_control_plane.vnext_authorization_outbox_events(')));
        assert.ok(evidenceTrace.queries.some(text => text.includes('FROM vnext_control_plane.vnext_authorization_command_receipts ORDER BY receipt_id')));
      } finally { await runtime.disposeHandle(evidenceHandle); }
      for (const [label, createSnapshot] of [['noop', noopLinkRevokeEvidenceSnapshot], ['version-conflict', rejectedLinkRevokeEvidenceSnapshot], ['missing', missingLinkRevokeEvidenceSnapshot], ['self', selfLinkRevokeEvidenceSnapshot]]) {
        const evidenceHandle = await runtime.createIsolatedHandle();
        try {
          await createVNextPg17CatalogBoundary(runtime).apply(evidenceHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: `link-revoke-${label}-test` });
          const evidenceTarget = runtime.createVNextPg17CopyOnlyRehearsalTarget(evidenceHandle);
          const evidenceResult = await rehearseVNextPg17ControlPlaneCopy({ source: createVNextPg17SyntheticControlPlaneSource(createSnapshot()), target: evidenceTarget });
          await withVNextPg17SyntheticQuery(evidenceHandle, 'fixture-provisioner', async facade => {
            assert.strictEqual(Number((await facade.query('SELECT COUNT(*)::int AS count FROM vnext_control_plane.vnext_authorization_command_receipts')).rows[0].count), 1);
            assert.strictEqual(Number((await facade.query('SELECT COUNT(*)::int AS count FROM vnext_control_plane.vnext_authorization_audit_events')).rows[0].count), 1);
            assert.strictEqual(Number((await facade.query('SELECT COUNT(*)::int AS count FROM vnext_control_plane.vnext_authorization_outbox_events')).rows[0].count), 0);
          });
          assert.strictEqual(evidenceResult.receiptCount, 1);
          assert.strictEqual(evidenceResult.auditEventCount, 1);
          assert.strictEqual(evidenceResult.outboxEventCount, 0);
        } finally { await runtime.disposeHandle(evidenceHandle); }
      }
      const lifecycleHandle = await runtime.createIsolatedHandle();
      try {
        await createVNextPg17CatalogBoundary(runtime).apply(lifecycleHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'identity-lifecycle-test' });
        const lifecycleResult = await rehearseVNextPg17ControlPlaneCopy({
          source: createVNextPg17SyntheticControlPlaneSource(identityLifecycleSnapshot()),
          target: runtime.createVNextPg17CopyOnlyRehearsalTarget(lifecycleHandle),
        });
        assert.strictEqual(lifecycleResult.accountCount, 2);
        assert.strictEqual(lifecycleResult.deviceCount, 3);
        assert.strictEqual(lifecycleResult.installationCount, 2);
        assert.strictEqual(lifecycleResult.linkCount, 2);
        assert.strictEqual(lifecycleResult.sourceIdentityLogicalSha256, lifecycleResult.targetIdentityLogicalSha256);
      } finally { await runtime.disposeHandle(lifecycleHandle); }
      for (const stages of [['commit'], ['accounts', 'rollback']]) {
        const uncertainHandle = await runtime.createIsolatedHandle();
        try {
          await createVNextPg17CatalogBoundary(runtime).apply(uncertainHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'copy-only-uncertain-test' });
          const uncertainTarget = runtime.createVNextPg17CopyOnlyRehearsalTarget(uncertainHandle);
          const faultPlan = runtime.createVNextPg17CopyOnlyRehearsalFaultPlan(uncertainHandle, stages);
          await assert.rejects(
            () => rehearseVNextPg17ControlPlaneCopy({ source, target: uncertainTarget, faultPlan }),
            error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_TARGET_UNAVAILABLE',
          );
          assert.strictEqual(inspectVNextPg17CopyOnlyRehearsalTarget(uncertainTarget).poisoned, true);
          await assert.rejects(
            () => rehearseVNextPg17ControlPlaneCopy({ source, target: uncertainTarget }),
            error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID',
          );
        } finally { await runtime.disposeHandle(uncertainHandle); }
      }
      const mismatchHandle = await runtime.createIsolatedHandle();
      try {
        await createVNextPg17CatalogBoundary(runtime).apply(mismatchHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'copy-only-mismatch-test' });
        const mismatchTarget = runtime.createVNextPg17CopyOnlyRehearsalTarget(mismatchHandle);
        const faultPlan = runtime.createVNextPg17CopyOnlyRehearsalFaultPlan(mismatchHandle, 'postReadMismatch');
        await assert.rejects(
          () => rehearseVNextPg17ControlPlaneCopy({ source, target: mismatchTarget, faultPlan }),
          error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_LOGICAL_MISMATCH',
        );
        await withVNextPg17SyntheticQuery(mismatchHandle, 'fixture-provisioner', async facade => {
          for (const table of TARGET_DATA_TABLES) {
            assert.strictEqual(Number((await facade.query(`SELECT COUNT(*)::int AS count FROM vnext_control_plane.${table}`)).rows[0].count), 0);
          }
        });
      } finally { await runtime.disposeHandle(mismatchHandle); }
      const historicalMismatchHandle = await runtime.createIsolatedHandle();
      try {
        await createVNextPg17CatalogBoundary(runtime).apply(historicalMismatchHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'historical-copy-only-mismatch-test' });
        const historicalMismatchTarget = runtime.createVNextPg17CopyOnlyRehearsalTarget(historicalMismatchHandle);
        const faultPlan = runtime.createVNextPg17CopyOnlyRehearsalFaultPlan(historicalMismatchHandle, 'postReadHistoricalMismatch');
        await assert.rejects(
          () => rehearseVNextPg17ControlPlaneCopy({ source: createVNextPg17SyntheticControlPlaneSource(historicalAuthorizationSnapshot()), target: historicalMismatchTarget, faultPlan }),
          error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_LOGICAL_MISMATCH',
        );
        await withVNextPg17SyntheticQuery(historicalMismatchHandle, 'fixture-provisioner', async facade => {
          for (const table of TARGET_DATA_TABLES) {
            assert.strictEqual(Number((await facade.query(`SELECT COUNT(*)::int AS count FROM vnext_control_plane.${table}`)).rows[0].count), 0);
          }
        });
      } finally { await runtime.disposeHandle(historicalMismatchHandle); }
      const profileMismatchHandle = await runtime.createIsolatedHandle();
      try {
        await createVNextPg17CatalogBoundary(runtime).apply(profileMismatchHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'profile-copy-only-mismatch-test' });
        const profileMismatchTarget = runtime.createVNextPg17CopyOnlyRehearsalTarget(profileMismatchHandle);
        const faultPlan = runtime.createVNextPg17CopyOnlyRehearsalFaultPlan(profileMismatchHandle, 'postReadProfileMismatch');
        await assert.rejects(
          () => rehearseVNextPg17ControlPlaneCopy({ source: createVNextPg17SyntheticControlPlaneSource(profileBindingSnapshot()), target: profileMismatchTarget, faultPlan }),
          error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_LOGICAL_MISMATCH',
        );
        await withVNextPg17SyntheticQuery(profileMismatchHandle, 'fixture-provisioner', async facade => {
          for (const table of TARGET_DATA_TABLES) {
            assert.strictEqual(Number((await facade.query(`SELECT COUNT(*)::int AS count FROM vnext_control_plane.${table}`)).rows[0].count), 0);
          }
        });
      } finally { await runtime.disposeHandle(profileMismatchHandle); }
      const evidenceMismatchHandle = await runtime.createIsolatedHandle();
      try {
        await createVNextPg17CatalogBoundary(runtime).apply(evidenceMismatchHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'link-revoke-copy-only-mismatch-test' });
        const evidenceMismatchTarget = runtime.createVNextPg17CopyOnlyRehearsalTarget(evidenceMismatchHandle);
        const faultPlan = runtime.createVNextPg17CopyOnlyRehearsalFaultPlan(evidenceMismatchHandle, 'postReadEvidenceMismatch');
        await assert.rejects(
          () => rehearseVNextPg17ControlPlaneCopy({ source: createVNextPg17SyntheticControlPlaneSource(acceptedLinkRevokeEvidenceSnapshot()), target: evidenceMismatchTarget, faultPlan }),
          error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_LOGICAL_MISMATCH',
        );
        await withVNextPg17SyntheticQuery(evidenceMismatchHandle, 'fixture-provisioner', async facade => {
          for (const table of TARGET_DATA_TABLES) {
            assert.strictEqual(Number((await facade.query(`SELECT COUNT(*)::int AS count FROM vnext_control_plane.${table}`)).rows[0].count), 0);
          }
        });
      } finally { await runtime.disposeHandle(evidenceMismatchHandle); }
      for (const stage of ['authorities', 'accounts', 'trustedDevices', 'installations', 'links', 'capabilityCatalog', 'roleGrants', 'capabilityOverrides', 'dataScopeGrants', 'profileBindings', 'receipts', 'auditEvents', 'outboxEvents']) {
        const rollbackHandle = await runtime.createIsolatedHandle();
        try {
          await createVNextPg17CatalogBoundary(runtime).apply(rollbackHandle, { appliedAt: '2026-08-20T00:00:00.000Z', appliedBy: 'copy-only-rollback-test' });
          const rollbackTarget = runtime.createVNextPg17CopyOnlyRehearsalTarget(rollbackHandle);
          const faultPlan = runtime.createVNextPg17CopyOnlyRehearsalFaultPlan(rollbackHandle, stage);
          const rollbackSource = ['receipts', 'auditEvents', 'outboxEvents'].includes(stage) ? createVNextPg17SyntheticControlPlaneSource(acceptedLinkRevokeEvidenceSnapshot())
            : stage === 'profileBindings' ? createVNextPg17SyntheticControlPlaneSource(profileBindingSnapshot())
            : ['capabilityCatalog', 'roleGrants', 'capabilityOverrides', 'dataScopeGrants'].includes(stage)
              ? createVNextPg17SyntheticControlPlaneSource(historicalAuthorizationSnapshot()) : source;
          await assert.rejects(
            () => rehearseVNextPg17ControlPlaneCopy({ source: rollbackSource, target: rollbackTarget, faultPlan }),
            error => error && error.code === 'VNEXT_PG17_COPY_REHEARSAL_ROLLED_BACK',
          );
          await withVNextPg17SyntheticQuery(rollbackHandle, 'fixture-provisioner', async facade => {
            for (const table of TARGET_DATA_TABLES) {
              assert.strictEqual(Number((await facade.query(`SELECT COUNT(*)::int AS count FROM vnext_control_plane.${table}`)).rows[0].count), 0);
            }
          });
        } finally { await runtime.disposeHandle(rollbackHandle); }
      }
    } finally {
      await runtime.disposeHandle(handle);
    }
  } finally {
    if (ownsRuntime) await runtime.stop();
  }
}

if (require.main === module) {
  runControlPlaneCopyOnlyRehearsalCases().then(() => {
    process.stdout.write('vNext PG17 control-plane copy-only rehearsal checks passed\n');
  });
}

module.exports = { runControlPlaneCopyOnlyRehearsalCases };
