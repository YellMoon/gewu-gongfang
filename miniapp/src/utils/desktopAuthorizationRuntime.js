const CHALLENGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/;
const WECHAT_CODE_MAX_LENGTH = 256;
const ACTIVE_STATUSES = new Set([
  'pending_phone',
  'identity_verified_pending_approval',
  'approved_pending_exchange',
]);
const KNOWN_STATUSES = new Set([
  ...ACTIVE_STATUSES,
  'rejected',
  'expired',
  'exchanged',
]);

function runtimeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizedChallengeId(value) {
  const challengeId = String(value || '').trim();
  if (!CHALLENGE_ID_PATTERN.test(challengeId)) {
    throw runtimeError('DESKTOP_CHALLENGE_ID_INVALID');
  }
  return challengeId;
}

function decodedScene(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 256) return '';
  try {
    return decodeURIComponent(raw);
  } catch (_error) {
    return '';
  }
}

function challengeIdFromScene(value) {
  const scene = decodedScene(value);
  if (!scene) return '';
  if (CHALLENGE_ID_PATTERN.test(scene)) return scene;
  for (const field of scene.split('&')) {
    const separator = field.indexOf('=');
    if (separator < 1) continue;
    const key = field.slice(0, separator);
    if (key !== 'challengeId' && key !== 'challenge') continue;
    try {
      return decodeURIComponent(field.slice(separator + 1));
    } catch (_error) {
      return '';
    }
  }
  return '';
}

function parseDesktopAuthorizationChallengeId(options = {}) {
  return normalizedChallengeId(
    options.challengeId
      || options.challenge
      || challengeIdFromScene(options.scene)
  );
}

function normalizedWechatCode(value, missingCode) {
  const code = String(value || '').trim();
  if (!code || code.length > WECHAT_CODE_MAX_LENGTH) throw runtimeError(missingCode);
  return code;
}

function phoneCodeFromAuthorizationEvent(event = {}) {
  return normalizedWechatCode(event?.detail?.code, 'WECHAT_PHONE_AUTH_CANCELLED');
}

function buildDesktopConfirmationPayload({ challengeId, loginCode, phoneCode } = {}) {
  return Object.freeze({
    challengeId: normalizedChallengeId(challengeId),
    code: normalizedWechatCode(loginCode, 'WECHAT_LOGIN_CODE_REQUIRED'),
    phoneCode: normalizedWechatCode(phoneCode, 'WECHAT_PHONE_CODE_REQUIRED'),
  });
}

function fingerprintSummary(value) {
  const fingerprint = String(value || '').trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(fingerprint)) {
    return `${fingerprint.slice(0, 8)}…${fingerprint.slice(-4)}`;
  }
  if (/^[a-f0-9]{8}…[a-f0-9]{4}$/.test(fingerprint)) return fingerprint;
  throw runtimeError('DESKTOP_CHALLENGE_FINGERPRINT_INVALID');
}

function validTimestamp(value) {
  const timestamp = String(value || '').trim();
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) {
    throw runtimeError('DESKTOP_CHALLENGE_TIME_INVALID');
  }
  return timestamp;
}

function projectDesktopAuthorizationChallenge(value = {}) {
  const deviceName = String(value.deviceName || '').trim();
  const purpose = String(value.purpose || '').trim();
  const status = String(value.status || '').trim();
  if (!deviceName || deviceName.length > 128) throw runtimeError('DESKTOP_CHALLENGE_DEVICE_INVALID');
  if (purpose !== 'register') throw runtimeError('DESKTOP_CHALLENGE_PURPOSE_INVALID');
  if (!KNOWN_STATUSES.has(status)) throw runtimeError('DESKTOP_CHALLENGE_STATUS_INVALID');
  return Object.freeze({
    id: normalizedChallengeId(value.id),
    deviceName,
    keyFingerprintSummary: fingerprintSummary(value.keyFingerprintSummary || value.keyFingerprint),
    purpose,
    status,
    createdAt: validTimestamp(value.createdAt),
    expiresAt: validTimestamp(value.expiresAt),
  });
}

function desktopAuthorizationView(challenge, now = new Date()) {
  const projected = projectDesktopAuthorizationChallenge(challenge);
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(current)) throw runtimeError('DESKTOP_AUTHORIZATION_CLOCK_INVALID');
  const status = ACTIVE_STATUSES.has(projected.status) && Date.parse(projected.expiresAt) <= current
    ? 'expired'
    : projected.status;
  return ({
    pending_phone: 'phone-required',
    identity_verified_pending_approval: 'approval-pending',
    approved_pending_exchange: 'approved',
    exchanged: 'approved',
    rejected: 'rejected',
    expired: 'expired',
  })[status] || 'error';
}

function desktopAuthorizationErrorMessage(code, fallback = '') {
  return ({
    DESKTOP_CHALLENGE_ID_INVALID: '\u65e0\u6cd5\u8bc6\u522b\u8fd9\u6b21\u8bbe\u5907\u7533\u8bf7\uff0c\u8bf7\u5728\u7535\u8111\u4e0a\u91cd\u65b0\u53d1\u8d77\u3002',
    DESKTOP_CHALLENGE_NOT_FOUND: '\u8fd9\u6b21\u8bbe\u5907\u7533\u8bf7\u4e0d\u5b58\u5728\u6216\u5df2\u5931\u6548\u3002',
    DESKTOP_CHALLENGE_EXPIRED: '\u8fd9\u6b21\u8bbe\u5907\u7533\u8bf7\u5df2\u8fc7\u671f\uff0c\u8bf7\u5728\u7535\u8111\u4e0a\u91cd\u65b0\u53d1\u8d77\u3002',
    DESKTOP_CHALLENGE_CLAIMANT_CONFLICT: '\u8fd9\u6b21\u7533\u8bf7\u5df2\u7531\u53e6\u4e00\u4e2a\u5df2\u9a8c\u8bc1\u8eab\u4efd\u786e\u8ba4\uff0c\u4e0d\u80fd\u6539\u7ed1\u3002',
    PHONE_IDENTITY_CONFLICT: '\u5fae\u4fe1\u6216\u624b\u673a\u53f7\u4e0e\u5df2\u6709\u8eab\u4efd\u51b2\u7a81\uff0c\u672c\u6b21\u7533\u8bf7\u672a\u786e\u8ba4\u3002',
    DESKTOP_DEVICE_OWNER_CONFLICT: '\u8fd9\u53f0\u8bbe\u5907\u5df2\u5f52\u5c5e\u5176\u4ed6\u8eab\u4efd\uff0c\u4e0d\u80fd\u7ee7\u7eed\u3002',
    DESKTOP_DEVICE_ALREADY_REGISTERED: '\u8fd9\u53f0\u8bbe\u5907\u5df2\u5b8c\u6210\u6ce8\u518c\uff0c\u8bf7\u56de\u5230\u7535\u8111\u4f7f\u7528\u3002',
    DESKTOP_IDENTITY_NOT_ELIGIBLE: '\u5f53\u524d\u624b\u673a\u53f7\u8fd8\u6ca1\u6709\u53ef\u7528\u7684\u6b63\u5f0f\u8eab\u4efd\uff0c\u4e0d\u80fd\u6ce8\u518c\u7535\u8111\u3002',
    WECHAT_PHONE_AUTH_CANCELLED: '\u4f60\u5df2\u53d6\u6d88\u624b\u673a\u53f7\u6388\u6743\uff0c\u672c\u6b21\u6ca1\u6709\u5411\u670d\u52a1\u5668\u63d0\u4ea4\u3002',
    WECHAT_PHONE_EXCHANGE_FAILED: '\u5fae\u4fe1\u624b\u673a\u53f7\u6838\u9a8c\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u70b9\u51fb\u9a8c\u8bc1\u3002',
  })[String(code || '')] || fallback || '\u7f51\u7edc\u8bf7\u6c42\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5\u3002';
}

module.exports = {
  buildDesktopConfirmationPayload,
  desktopAuthorizationErrorMessage,
  desktopAuthorizationView,
  parseDesktopAuthorizationChallengeId,
  phoneCodeFromAuthorizationEvent,
  projectDesktopAuthorizationChallenge,
};
