const ACTIVE_DEVICE_STATUS = 'active';
const PENDING_CHALLENGE_STATUS = 'identity_verified_pending_approval';
const REVOCATION_REASONS = new Set(['lost', 'replaced', 'user_request', 'security']);
const PRIMARY_HOST_OPERATIONS = new Set(['bootstrap', 'transfer', 'recovery']);

function policyError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function text(value) {
  return String(value || '').trim();
}

function safeVersion(value) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) throw policyError('DESKTOP_DEVICE_ROW_VERSION_INVALID');
  return version;
}

function uniqueRoles(value) {
  return Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : [];
}

function challengeFrom(row) {
  const challenge = row?.challenge || row || {};
  const challengeId = text(challenge.id || challenge.challengeId);
  if (!challengeId) throw policyError('DESKTOP_CHALLENGE_ID_REQUIRED');
  return { challenge, challengeId };
}

export function identityDeviceCenterAccess({ runtimeConfig = {}, session = {} } = {}) {
  const context = session.authContext || {};
  const userId = text(context.userId);
  const deviceId = text(context.deviceId);
  const activeRole = text(context.activeRole);
  const eligibleRoles = uniqueRoles(context.eligibleRoles);
  const isPrimaryHost = runtimeConfig.nodeRole === 'primary-host';
  const primaryHostCapable = runtimeConfig.primaryHostCapable === true;
  const canReview = Boolean(
    userId && deviceId && isPrimaryHost && activeRole === 'super_admin' && eligibleRoles.includes('super_admin')
  );
  const canManageHost = Boolean(
    primaryHostCapable && userId && deviceId && activeRole === 'super_admin' && eligibleRoles.includes('super_admin')
  );
  return Object.freeze({
    visible: Boolean(userId && deviceId && activeRole),
    canReview,
    canViewAllDevices: canReview,
    canRevoke: canReview,
    canManageHost,
    activeRole,
    eligibleRoles,
    userId,
    deviceId,
    teacherId: context.teacherId ?? null,
    isPrimaryHost,
    primaryHostCapable,
  });
}

export function buildApprovalBody(row = {}) {
  const { challenge, challengeId } = challengeFrom(row);
  return Object.freeze({
    challengeId,
    expectedRowVersion: safeVersion(challenge.rowVersion ?? challenge.row_version),
  });
}

export function buildRejectionBody(row = {}, reason = '') {
  const base = buildApprovalBody(row);
  const normalizedReason = text(reason);
  if (!normalizedReason || normalizedReason.length > 200) throw policyError('DESKTOP_REJECTION_REASON_INVALID');
  return Object.freeze({ ...base, reason: normalizedReason });
}

export function buildRevocationBody(device = {}, options = {}) {
  const deviceId = text(device.deviceId || device.device_id);
  const reason = text(options.reason || 'user_request');
  if (!deviceId) throw policyError('DESKTOP_DEVICE_ID_REQUIRED');
  if (!REVOCATION_REASONS.has(reason)) throw policyError('DESKTOP_DEVICE_REVOCATION_REASON_INVALID');
  const request = {
    deviceId,
    expectedRowVersion: safeVersion(device.rowVersion ?? device.row_version),
    reason,
  };
  if (reason === 'replaced') {
    const replacementDeviceId = text(options.replacementDeviceId);
    if (!replacementDeviceId || replacementDeviceId === deviceId) {
      throw policyError('DESKTOP_REPLACEMENT_DEVICE_REQUIRED');
    }
    request.replacementDeviceId = replacementDeviceId;
  }
  return Object.freeze(request);
}

function fingerprintSummary(value) {
  const fingerprint = text(value).toLowerCase();
  if (/^[a-f0-9]{64}$/.test(fingerprint)) return `${fingerprint.slice(0, 8)}...${fingerprint.slice(-4)}`;
  if (/^[a-f0-9]{8}(?:\.{3}|\u2026)[a-f0-9]{4}$/.test(fingerprint)) return fingerprint;
  return '\u672a\u63d0\u4f9b';
}

function projectPending(row, access) {
  const { challenge, challengeId } = challengeFrom(row);
  if (text(challenge.status) !== PENDING_CHALLENGE_STATUS) {
    throw policyError('DESKTOP_PENDING_CHALLENGE_STATE_INVALID');
  }
  const claimant = row?.claimant || {};
  const claimantId = text(claimant.id);
  if (!claimantId) throw policyError('DESKTOP_PENDING_CLAIMANT_REQUIRED');
  return Object.freeze({
    id: challengeId,
    deviceId: text(challenge.deviceId),
    deviceName: text(challenge.deviceName) || '\u672a\u547d\u540d\u7535\u8111',
    keyFingerprintSummary: fingerprintSummary(challenge.keyFingerprint),
    purpose: text(challenge.purpose) || 'register',
    status: text(challenge.status),
    rowVersion: safeVersion(challenge.rowVersion ?? challenge.row_version),
    createdAt: text(challenge.createdAt),
    expiresAt: text(challenge.expiresAt),
    claimant: Object.freeze({
      id: claimantId,
      name: text(claimant.name) || '\u672a\u586b\u5199\u59d3\u540d',
      maskedPhone: text(claimant.maskedPhone),
      eligibleRoles: uniqueRoles(claimant.eligibleRoles),
      teacherId: claimant.teacherId ?? null,
      studentId: claimant.studentId ?? null,
    }),
    sameClaimantAndReviewer: claimantId === access.userId,
    isRequestingDevice: text(challenge.deviceId) === access.deviceId,
  });
}

function projectDevice(device, { access, runtimeConfig, replacementNames, replacedSources }) {
  const deviceId = text(device.deviceId || device.device_id);
  if (!deviceId) throw policyError('DESKTOP_DEVICE_ID_REQUIRED');
  const status = text(device.status);
  const replacedByDeviceId = text(device.replacedByDeviceId || device.replaced_by_device_id) || null;
  const isCurrent = deviceId === access.deviceId;
  const isHost = text(device.deviceKind || device.device_kind) === 'primary-host'
    || (runtimeConfig.nodeRole === 'primary-host' && deviceId === text(runtimeConfig.deviceId));
  return Object.freeze({
    id: text(device.id) || deviceId,
    deviceId,
    deviceName: text(device.deviceName || device.device_name) || '\u672a\u547d\u540d\u7535\u8111',
    deviceKind: text(device.deviceKind || device.device_kind) || 'desktop-client',
    ownerId: text(device.userId || device.user_id),
    keyFingerprintSummary: fingerprintSummary(device.keyFingerprint || device.key_fingerprint),
    status,
    rowVersion: safeVersion(device.rowVersion ?? device.row_version),
    createdAt: text(device.createdAt || device.created_at),
    updatedAt: text(device.updatedAt || device.updated_at),
    lastSeenAt: text(device.lastSeenAt || device.last_seen_at) || null,
    revokedAt: text(device.revokedAt || device.revoked_at) || null,
    replacedByDeviceId,
    replacedByName: replacedByDeviceId ? (replacementNames.get(replacedByDeviceId) || replacedByDeviceId) : null,
    replacesDeviceIds: Object.freeze([...(replacedSources.get(deviceId) || [])]),
    isCurrent,
    isHost,
    canRevoke: access.canRevoke && status === ACTIVE_DEVICE_STATUS && !isCurrent,
  });
}

export function projectIdentityDeviceCenterSnapshot({
  pending = [], mine = [], all = [], hostControl = null, hostRuntimeStatus = null,
  runtimeConfig = {}, session = {},
} = {}) {
  if (![pending, mine, all].every(Array.isArray)) throw policyError('DESKTOP_DEVICE_CENTER_RESPONSE_INVALID');
  const access = identityDeviceCenterAccess({ runtimeConfig, session });
  const sourceDevices = access.canViewAllDevices ? all : mine;
  const replacementNames = new Map(sourceDevices.map(device => [
    text(device.deviceId || device.device_id), text(device.deviceName || device.device_name) || '\u672a\u547d\u540d\u7535\u8111',
  ]));
  const replacedSources = new Map();
  for (const device of sourceDevices) {
    const replacementId = text(device.replacedByDeviceId || device.replaced_by_device_id);
    const sourceId = text(device.deviceId || device.device_id);
    if (!replacementId || !sourceId) continue;
    replacedSources.set(replacementId, [...(replacedSources.get(replacementId) || []), sourceId]);
  }
  const project = device => projectDevice(device, { access, runtimeConfig, replacementNames, replacedSources });
  const controlAvailable = Boolean(hostControl && typeof hostControl === 'object' && !hostControl.errorCode);
  const activeEpoch = controlAvailable && hostControl.activeEpoch ? Object.freeze({ ...hostControl.activeEpoch }) : null;
  const transfers = controlAvailable && Array.isArray(hostControl.transfers)
    ? Object.freeze(hostControl.transfers.map(transfer => Object.freeze({ ...transfer })))
    : Object.freeze([]);
  const history = controlAvailable && Array.isArray(hostControl.history)
    ? Object.freeze(hostControl.history.map(epoch => Object.freeze({ ...epoch })))
    : Object.freeze([]);
  const incomingTransfer = transfers.find(transfer => transfer.status === 'pending_validation'
    && text(transfer.targetDeviceId) === access.deviceId) || null;
  const isActiveHostDevice = Boolean(activeEpoch && text(activeEpoch.deviceId) === access.deviceId);
  const runtimeEpochId = text(runtimeConfig.primaryHostEpochId);
  const runtimeGeneration = Number(runtimeConfig.primaryHostGeneration) || null;
  const runtimeMatchesActiveEpoch = Boolean(isActiveHostDevice
    && runtimeConfig.nodeRole === 'primary-host'
    && runtimeEpochId === text(activeEpoch.id)
    && runtimeGeneration === Number(activeEpoch.generation));
  const runtimeCredential = hostRuntimeStatus?.credential && typeof hostRuntimeStatus.credential === 'object'
    ? hostRuntimeStatus.credential
    : null;
  const pendingCredentialStage = runtimeCredential?.state === 'staged'
    ? Object.freeze({
      state: 'staged',
      stageId: text(runtimeCredential.stageId),
      operation: text(runtimeCredential.operation),
      deviceId: text(runtimeCredential.deviceId),
      generation: Number(runtimeCredential.generation) || null,
    })
    : null;
  const canResumeRuntimeAdoption = Boolean(isActiveHostDevice
    && !runtimeMatchesActiveEpoch
    && pendingCredentialStage?.stageId
    && pendingCredentialStage.deviceId === access.deviceId
    && pendingCredentialStage.generation === Number(activeEpoch.generation));
  const requiresRuntimeDemotion = Boolean(runtimeEpochId && activeEpoch
    && (runtimeEpochId !== text(activeEpoch.id) || !isActiveHostDevice));
  const recoveryDeliveryPending = Boolean(controlAvailable && hostControl.recoveryDeliveryPending);
  const recoveryDelivery = controlAvailable && hostControl.pendingRecoveryDelivery
    && typeof hostControl.pendingRecoveryDelivery === 'object'
    ? Object.freeze({ ...hostControl.pendingRecoveryDelivery })
    : null;
  const hasLocalRecoveryDelivery = Boolean(runtimeCredential?.recoveryDelivery?.pending);
  const blocksHighRiskOperations = recoveryDeliveryPending || hasLocalRecoveryDelivery;
  return Object.freeze({
    access,
    identity: Object.freeze({
      userId: access.userId,
      activeRole: access.activeRole,
      eligibleRoles: access.eligibleRoles,
      teacherId: access.teacherId,
    }),
    pending: Object.freeze(access.canReview ? pending.map(row => projectPending(row, access)) : []),
    mine: Object.freeze(mine.map(project)),
    all: Object.freeze(access.canViewAllDevices ? all.map(project) : []),
    host: Object.freeze({
      nodeRole: runtimeConfig.nodeRole || 'desktop-client',
      deviceId: text(runtimeConfig.deviceId),
      hostBaseUrl: text(runtimeConfig.hostBaseUrl),
      isPrimaryHost: access.isPrimaryHost,
      runtimeEpochId,
      runtimeGeneration,
      controlAvailable,
      controlErrorCode: hostControl?.errorCode || null,
      activeEpoch,
      transfers,
      history,
      incomingTransfer,
      isActiveHostDevice,
      runtimeMatchesActiveEpoch,
      recoveryDeliveryPending,
      recoveryDelivery,
      hasLocalRecoveryDelivery,
      blocksHighRiskOperations,
      canBootstrap: access.canManageHost && controlAvailable && !activeEpoch && access.isPrimaryHost
        && !blocksHighRiskOperations,
      canStartTransfer: access.canManageHost && isActiveHostDevice && !blocksHighRiskOperations,
      canActivateTransfer: access.canManageHost && Boolean(incomingTransfer) && !blocksHighRiskOperations,
      canRecover: access.canManageHost && Boolean(activeEpoch) && !isActiveHostDevice
        && !requiresRuntimeDemotion && !blocksHighRiskOperations,
      requiresRuntimeAdoption: isActiveHostDevice && !runtimeMatchesActiveEpoch,
      pendingCredentialStage,
      canResumeRuntimeAdoption,
      requiresRuntimeDemotion,
    }),
  });
}

function apiBase(value) {
  const base = text(value).replace(/\/+$/, '').replace(/\/api$/, '');
  if (!/^https?:\/\//i.test(base)) throw policyError('DESKTOP_IDENTITY_BASE_URL_REQUIRED');
  return base;
}

async function responsePayload(response) {
  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    throw policyError('DESKTOP_DEVICE_CENTER_RESPONSE_INVALID', cause);
  }
  if (!response.ok || payload?.success !== true) {
    throw policyError(payload?.code || 'DESKTOP_DEVICE_CENTER_REQUEST_FAILED');
  }
  return payload.data || {};
}

async function identityRequest({ baseUrl, session, fetchImpl = globalThis.fetch }, pathname, options = {}) {
  if (typeof fetchImpl !== 'function') throw policyError('DESKTOP_IDENTITY_FETCH_REQUIRED');
  const authorization = text(session?.authorization);
  if (!authorization.startsWith('Bearer ')) throw policyError('AUTHORIZATION_CONTEXT_REQUIRED');
  const body = options.body;
  const response = await fetchImpl(`${apiBase(baseUrl)}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: authorization,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return responsePayload(response);
}

async function publicIdentityRequest({ baseUrl, fetchImpl = globalThis.fetch }, pathname) {
  if (typeof fetchImpl !== 'function') throw policyError('DESKTOP_IDENTITY_FETCH_REQUIRED');
  const response = await fetchImpl(`${apiBase(baseUrl)}${pathname}`, {
    method: 'GET', headers: { Accept: 'application/json' },
  });
  return responsePayload(response);
}

export async function loadIdentityDeviceCenter({
  baseUrl, runtimeConfig, session, hostRuntimeStatus = null, fetchImpl = globalThis.fetch,
} = {}) {
  const access = identityDeviceCenterAccess({ runtimeConfig, session });
  if (!access.visible) throw policyError('AUTHORIZATION_CONTEXT_REQUIRED');
  const ownPromise = identityRequest({ baseUrl, session, fetchImpl }, '/api/desktop-identity/devices');
  const pendingPromise = access.canReview
    ? identityRequest({ baseUrl, session, fetchImpl }, '/api/desktop-identity/authorizations/pending')
    : Promise.resolve({ items: [] });
  const allPromise = access.canViewAllDevices
    ? identityRequest({ baseUrl, session, fetchImpl }, '/api/desktop-identity/devices/all')
    : Promise.resolve({ items: [] });
  const hostPromise = access.canManageHost
    ? identityRequest({ baseUrl, session, fetchImpl }, '/api/desktop-identity/primary-host/status')
      .catch(error => ({ errorCode: error.code || 'PRIMARY_HOST_STATUS_UNAVAILABLE' }))
    : Promise.resolve(null);
  const [ownData, pendingData, allData, hostControl] = await Promise.all([
    ownPromise, pendingPromise, allPromise, hostPromise,
  ]);
  return projectIdentityDeviceCenterSnapshot({
    mine: ownData.items || [],
    pending: pendingData.items || [],
    all: allData.items || [],
    hostControl,
    hostRuntimeStatus,
    runtimeConfig,
    session,
  });
}

export async function startPrimaryHostOperation({ baseUrl, session, request, fetchImpl = globalThis.fetch } = {}) {
  const operation = text(request?.operation);
  const targetDeviceId = text(request?.targetDeviceId);
  if (!PRIMARY_HOST_OPERATIONS.has(operation) || !targetDeviceId) {
    throw policyError('PRIMARY_HOST_OPERATION_INPUT_INVALID');
  }
  return identityRequest(
    { baseUrl, session, fetchImpl },
    '/api/desktop-identity/primary-host/challenges/start',
    { method: 'POST', body: { operation, targetDeviceId } }
  );
}

export async function readPrimaryHostOperationChallenge({ baseUrl, challengeId, fetchImpl = globalThis.fetch } = {}) {
  const id = text(challengeId);
  if (!id) throw policyError('PRIMARY_HOST_CHALLENGE_REQUIRED');
  return publicIdentityRequest(
    { baseUrl, fetchImpl },
    `/api/desktop-identity/primary-host/challenges/${encodeURIComponent(id)}/public`
  );
}

export async function bootstrapPrimaryHost({ baseUrl, session, request, fetchImpl = globalThis.fetch } = {}) {
  const challengeId = text(request?.challengeId);
  if (!challengeId || !request?.localReceipt || !request?.operationManifest) {
    throw policyError('PRIMARY_HOST_BOOTSTRAP_INPUT_INVALID');
  }
  return identityRequest(
    { baseUrl, session, fetchImpl }, '/api/desktop-identity/primary-host/bootstrap',
    { method: 'POST', body: {
      challengeId,
      expectedChallengeRowVersion: safeVersion(request.expectedChallengeRowVersion),
      localReceipt: request.localReceipt,
      operationManifest: request.operationManifest,
    } }
  );
}

export async function beginPrimaryHostTransfer({ baseUrl, session, request, fetchImpl = globalThis.fetch } = {}) {
  const challengeId = text(request?.challengeId);
  if (!challengeId) throw policyError('PRIMARY_HOST_TRANSFER_INPUT_INVALID');
  return identityRequest(
    { baseUrl, session, fetchImpl }, '/api/desktop-identity/primary-host/transfers',
    { method: 'POST', body: {
      challengeId,
      expectedChallengeRowVersion: safeVersion(request.expectedChallengeRowVersion),
      expectedActiveEpochRowVersion: safeVersion(request.expectedActiveEpochRowVersion),
    } }
  );
}

export async function activatePrimaryHostTransfer({
  baseUrl, session, transferId, request, fetchImpl = globalThis.fetch,
} = {}) {
  const id = text(transferId);
  if (!id || !request?.localReceipt || !request?.validationManifest || !request?.preflightProof) {
    throw policyError('PRIMARY_HOST_TRANSFER_ACTIVATION_INPUT_INVALID');
  }
  return identityRequest(
    { baseUrl, session, fetchImpl },
    `/api/desktop-identity/primary-host/transfers/${encodeURIComponent(id)}/activate`,
    { method: 'POST', body: {
      expectedTransferRowVersion: safeVersion(request.expectedTransferRowVersion),
      localReceipt: request.localReceipt,
      validationManifest: request.validationManifest,
      preflightProof: request.preflightProof,
    } }
  );
}

export async function recoverPrimaryHost({ baseUrl, session, request, fetchImpl = globalThis.fetch } = {}) {
  const challengeId = text(request?.challengeId);
  const factorId = text(request?.factorId);
  const recoveryCode = text(request?.recoveryCode);
  if (!challengeId || !factorId || !recoveryCode || !request?.localReceipt
    || !request?.evidence || !request?.preflightProof) {
    throw policyError('PRIMARY_HOST_RECOVERY_INPUT_INVALID');
  }
  return identityRequest(
    { baseUrl, session, fetchImpl }, '/api/desktop-identity/primary-host/recover',
    { method: 'POST', body: {
      challengeId,
      expectedChallengeRowVersion: safeVersion(request.expectedChallengeRowVersion),
      factorId,
      recoveryCode,
      localReceipt: request.localReceipt,
      evidence: request.evidence,
      preflightProof: request.preflightProof,
    } }
  );
}

export async function loadIdentityDevicePendingCount({ baseUrl, runtimeConfig, session, fetchImpl = globalThis.fetch } = {}) {
  const access = identityDeviceCenterAccess({ runtimeConfig, session });
  if (!access.canReview) return 0;
  const data = await identityRequest(
    { baseUrl, session, fetchImpl }, '/api/desktop-identity/authorizations/pending'
  );
  return Array.isArray(data.items) ? data.items.length : 0;
}

export async function approveDesktopChallenge({ baseUrl, session, request, fetchImpl = globalThis.fetch } = {}) {
  const challengeId = text(request?.challengeId);
  const expectedRowVersion = safeVersion(request?.expectedRowVersion);
  if (!challengeId) throw policyError('DESKTOP_CHALLENGE_ID_REQUIRED');
  return identityRequest(
    { baseUrl, session, fetchImpl },
    `/api/desktop-identity/challenges/${encodeURIComponent(challengeId)}/approve`,
    { method: 'POST', body: { expectedRowVersion } }
  );
}

export async function rejectDesktopChallenge({ baseUrl, session, request, fetchImpl = globalThis.fetch } = {}) {
  const challengeId = text(request?.challengeId);
  const expectedRowVersion = safeVersion(request?.expectedRowVersion);
  const reason = text(request?.reason);
  if (!challengeId || !reason) throw policyError('DESKTOP_REJECTION_REASON_INVALID');
  return identityRequest(
    { baseUrl, session, fetchImpl },
    `/api/desktop-identity/challenges/${encodeURIComponent(challengeId)}/reject`,
    { method: 'POST', body: { expectedRowVersion, reason } }
  );
}

export async function revokeDesktopDevice({ baseUrl, session, request, fetchImpl = globalThis.fetch } = {}) {
  const deviceId = text(request?.deviceId);
  const expectedRowVersion = safeVersion(request?.expectedRowVersion);
  const reason = text(request?.reason);
  if (!deviceId || !REVOCATION_REASONS.has(reason)) throw policyError('DESKTOP_DEVICE_REVOCATION_INPUT_INVALID');
  const body = {
    expectedRowVersion,
    reason,
    ...(request?.replacementDeviceId ? { replacementDeviceId: text(request.replacementDeviceId) } : {}),
  };
  return identityRequest(
    { baseUrl, session, fetchImpl },
    `/api/desktop-identity/devices/${encodeURIComponent(deviceId)}/revoke`,
    { method: 'POST', body }
  );
}

export function identityDeviceCenterErrorMessage(code) {
  return ({
    AUTHORIZATION_CONTEXT_REQUIRED: '\u684c\u9762\u8eab\u4efd\u4f1a\u8bdd\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u89e3\u9501\u3002',
    DESKTOP_SUPER_ADMIN_ROLE_REQUIRED: '\u8bf7\u5148\u5207\u6362\u5230\u8d85\u7ea7\u7ba1\u7406\u5458\u8eab\u4efd\u3002',
    DESKTOP_RECENT_ELEVATION_REQUIRED: '\u7ba1\u7406\u5458\u9a8c\u8bc1\u5df2\u8d85\u65f6\uff0c\u8bf7\u70b9\u51fb\u9876\u90e8\u201c\u9501\u5b9a\u201d\uff0c\u518d\u7528\u672c\u673a\u5bc6\u7801\u91cd\u65b0\u8fdb\u5165\u8d85\u7ea7\u7ba1\u7406\u5458\u8eab\u4efd\u3002',
    DESKTOP_DEVICE_SELF_APPROVAL_FORBIDDEN: '\u7533\u8bf7\u8bbe\u5907\u4e0d\u80fd\u5ba1\u6279\u81ea\u5df1\uff0c\u8bf7\u4f7f\u7528\u53e6\u4e00\u53f0\u53ef\u4fe1\u8bbe\u5907\u3002',
    DESKTOP_CHALLENGE_EXPIRED: '\u8bbe\u5907\u7533\u8bf7\u5df2\u8fc7\u671f\uff0c\u8bf7\u5728\u7533\u8bf7\u7535\u8111\u4e0a\u91cd\u65b0\u53d1\u8d77\u3002',
    DESKTOP_CHALLENGE_STATE_INVALID: '\u8bbe\u5907\u7533\u8bf7\u72b6\u6001\u5df2\u53d8\u5316\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5\u3002',
    DESKTOP_CHALLENGE_VERSION_STALE: '\u7533\u8bf7\u5df2\u88ab\u5176\u4ed6\u64cd\u4f5c\u66f4\u65b0\uff0c\u8bf7\u5237\u65b0\u5217\u8868\u3002',
    DESKTOP_DEVICE_VERSION_STALE: '\u8bbe\u5907\u72b6\u6001\u5df2\u88ab\u5176\u4ed6\u64cd\u4f5c\u66f4\u65b0\uff0c\u8bf7\u5237\u65b0\u5217\u8868\u3002',
    DESKTOP_DEVICE_REPLACEMENT_INVALID: '\u66ff\u6362\u5173\u7cfb\u65e0\u6548\uff0c\u8bf7\u9009\u62e9\u540c\u4e00\u7528\u6237\u7684\u53e6\u4e00\u53f0\u6709\u6548\u8bbe\u5907\u3002',
  })[text(code)] || '\u8eab\u4efd\u4e0e\u8bbe\u5907\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u68c0\u67e5\u4e3b\u673a\u8fde\u63a5\u540e\u91cd\u8bd5\u3002';
}
