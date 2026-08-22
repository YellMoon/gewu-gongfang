const ACTIVE_DEVICE_STATUS = 'active';
const REVOCATION_REASONS = new Set(['lost', 'replaced', 'user_request', 'security']);

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

function apiBase(value) {
  const base = text(value).replace(/\/+$/, '');
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

export function identityDeviceCenterAccess({ session = {} } = {}) {
  const context = session.authContext || {};
  const activeRole = text(context.activeRole);
  const eligibleRoles = uniqueRoles(context.eligibleRoles);
  const userId = text(context.userId);
  const deviceId = text(context.deviceId);
  const canReview = Boolean(userId && deviceId && activeRole === 'super_admin' && eligibleRoles.includes('super_admin'));
  return Object.freeze({
    visible: Boolean(userId && deviceId && activeRole),
    canReview,
    canViewAllDevices: canReview,
    canRevoke: canReview,
    activeRole,
    eligibleRoles,
    userId,
    deviceId,
    teacherId: context.teacherId ?? null,
  });
}

function projectDevice(device, access) {
  const deviceId = text(device.deviceId || device.device_id);
  if (!deviceId) throw policyError('DESKTOP_DEVICE_ID_REQUIRED');
  const status = text(device.status);
  return Object.freeze({
    id: text(device.id) || deviceId,
    deviceId,
    deviceName: text(device.deviceName || device.device_name) || '\u672a\u547d\u540d\u8bbe\u5907',
    status,
    approvedAt: text(device.approvedAt || device.approved_at) || null,
    rowVersion: safeVersion(device.rowVersion ?? device.row_version),
    createdAt: text(device.createdAt || device.created_at) || null,
    updatedAt: text(device.updatedAt || device.updated_at) || null,
    lastSeenAt: text(device.lastSeenAt || device.last_seen_at) || null,
    revokedAt: text(device.revokedAt || device.revoked_at) || null,
    isCurrent: deviceId === access.deviceId,
    canRevoke: access.canRevoke && status === ACTIVE_DEVICE_STATUS && deviceId !== access.deviceId,
  });
}

export async function loadIdentityDeviceCenter({ baseUrl, session, runtimeConfig: _runtimeConfig, fetchImpl = globalThis.fetch } = {}) {
  const access = identityDeviceCenterAccess({ session });
  if (!access.visible) throw policyError('AUTHORIZATION_CONTEXT_REQUIRED');
  const data = await identityRequest({ baseUrl, session, fetchImpl }, '/api/desktop-identity/devices');
  const mine = Array.isArray(data.items) ? data.items.map(device => projectDevice(device, access)) : [];
  return Object.freeze({
    mine: Object.freeze(mine),
    all: Object.freeze([]),
    pending: Object.freeze([]),
    access,
  });
}

export function buildRevocationBody(device = {}, options = {}) {
  const deviceId = text(device.deviceId || device.device_id);
  const reason = text(options.reason || 'user_request');
  if (!deviceId || !REVOCATION_REASONS.has(reason)) throw policyError('DESKTOP_DEVICE_REVOCATION_INPUT_INVALID');
  return Object.freeze({
    deviceId,
    expectedRowVersion: safeVersion(device.expectedRowVersion ?? device.rowVersion ?? device.row_version),
    reason,
  });
}

export async function revokeDesktopDevice({ baseUrl, session, request, fetchImpl = globalThis.fetch } = {}) {
  const body = buildRevocationBody(request, request);
  return identityRequest(
    { baseUrl, session, fetchImpl },
    `/api/desktop-identity/devices/${encodeURIComponent(body.deviceId)}/revoke`,
    { method: 'POST', body: { expectedRowVersion: body.expectedRowVersion, reason: body.reason } }
  );
}

export async function loadIdentityDevicePendingCount(_input = {}) {
  return 0;
}

export function identityDeviceCenterErrorMessage(code) {
  return ({
    AUTHORIZATION_CONTEXT_REQUIRED: '\u684c\u9762\u8eab\u4efd\u4f1a\u8bdd\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u89e3\u9501\u3002',
    DESKTOP_DEVICE_ROW_VERSION_INVALID: '\u8bbe\u5907\u8bb0\u5f55\u5df2\u88ab\u66f4\u65b0\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5\u3002',
    DESKTOP_DEVICE_REVOCATION_INPUT_INVALID: '\u8bbe\u5907\u64a4\u9500\u53c2\u6570\u65e0\u6548\u3002',
    DESKTOP_DEVICE_VERSION_STALE: '\u8bbe\u5907\u72b6\u6001\u5df2\u88ab\u5176\u4ed6\u64cd\u4f5c\u66f4\u65b0\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5\u3002',
  })[text(code)] || '\u8eab\u4efd\u4e0e\u8bbe\u5907\u4e91\u7aef\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002';
}
