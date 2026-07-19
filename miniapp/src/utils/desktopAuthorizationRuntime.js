const CHALLENGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/;
const WECHAT_CODE_MAX_LENGTH = 256;
const ACTIVE_STATUSES = new Set([
  'pending_phone',
  'identity_verified_pending_approval',
  'approved_pending_exchange',
  'identity_verified',
  'consumed',
]);
const PURPOSES = new Set([
  'register',
  'password_reset',
  'primary-host-bootstrap',
  'primary-host-transfer',
  'primary-host-recovery',
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

function safeRowVersion(value) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) throw runtimeError('DESKTOP_CHALLENGE_ROW_VERSION_INVALID');
  return version;
}

function phoneCodeFromAuthorizationEvent(event = {}) {
  return normalizedWechatCode(event?.detail?.code, 'WECHAT_PHONE_AUTH_CANCELLED');
}

function buildDesktopConfirmationPayload({ challengeId, loginCode, phoneCode, expectedRowVersion } = {}) {
  return Object.freeze({
    challengeId: normalizedChallengeId(challengeId),
    code: normalizedWechatCode(loginCode, 'WECHAT_LOGIN_CODE_REQUIRED'),
    phoneCode: normalizedWechatCode(phoneCode, 'WECHAT_PHONE_CODE_REQUIRED'),
    expectedRowVersion: safeRowVersion(expectedRowVersion),
  });
}

function desktopAuthorizationPurposePresentation(purposeValue) {
  const purpose = String(purposeValue || '').trim();
  const presentation = {
    register: {
      label: '\u65b0\u8bbe\u5907\u6ce8\u518c',
      title: '\u786e\u8ba4\u8fd9\u53f0\u7535\u8111\u7684\u7533\u8bf7',
      phoneCopy: '\u4e8c\u7ef4\u7801\u53ea\u5efa\u7acb\u4e00\u6b21\u6027\u901a\u9053\uff0c\u5fae\u4fe1\u624b\u673a\u53f7\u7528\u4e8e\u786e\u8ba4\u7533\u8bf7\u4eba\u3002\u672c\u9875\u4e0d\u4f7f\u7528\u7f13\u5b58\u8d26\u53f7\u66ff\u4f60\u786e\u8ba4\u3002',
    },
    password_reset: {
      label: '\u91cd\u8bbe\u672c\u673a\u5bc6\u7801',
      title: '\u786e\u8ba4\u8fd9\u53f0\u7535\u8111\u7684\u5bc6\u7801\u91cd\u8bbe\u7533\u8bf7',
      phoneCopy: '\u8bf7\u91cd\u65b0\u6388\u6743\u5fae\u4fe1\u624b\u673a\u53f7\uff0c\u786e\u8ba4\u662f\u539f\u8bbe\u5907\u6240\u5c5e\u7684\u540c\u4e00\u4e2a\u771f\u5b9e\u8eab\u4efd\u3002\u672c\u6b21\u4e0d\u4f1a\u663e\u793a\u65e7\u5bc6\u7801\u3002',
    },
    'primary-host-bootstrap': {
      label: '\u5efa\u7acb\u6570\u636e\u4e3b\u673a',
      title: '\u786e\u8ba4\u5efa\u7acb\u672c\u5730\u6570\u636e\u4e3b\u673a',
      phoneCopy: '\u8fd9\u662f\u9ad8\u98ce\u9669\u64cd\u4f5c\uff1a\u672c\u6b21\u5fc5\u987b\u6bcf\u6b21\u91cd\u65b0\u6388\u6743\u5fae\u4fe1\u624b\u673a\u53f7\uff0c\u4e0d\u4f7f\u7528\u5df2\u7f13\u5b58\u7684\u767b\u5f55\u72b6\u6001\u66ff\u4ee3\u672c\u4eba\u6838\u9a8c\u3002',
    },
    'primary-host-transfer': {
      label: '\u8fc1\u79fb\u6570\u636e\u4e3b\u673a',
      title: '\u786e\u8ba4\u5c06\u6570\u636e\u4e3b\u673a\u8fc1\u79fb\u5230\u65b0\u7535\u8111',
      phoneCopy: '\u8fc1\u79fb\u4f1a\u8ba9\u65e7\u4e3b\u673a\u51ed\u636e\u5931\u6548\u3002\u672c\u6b21\u5fc5\u987b\u6bcf\u6b21\u91cd\u65b0\u6388\u6743\u5fae\u4fe1\u624b\u673a\u53f7\u3002',
    },
    'primary-host-recovery': {
      label: '\u7d27\u6025\u6062\u590d\u6570\u636e\u4e3b\u673a',
      title: '\u786e\u8ba4\u7d27\u6025\u6062\u590d\u4e3b\u673a\u8eab\u4efd',
      phoneCopy: '\u53ea\u6709\u65e7\u4e3b\u673a\u786e\u5b9e\u65e0\u6cd5\u8fde\u7eed\u5230\u8fbe\u65f6\u624d\u5e94\u7ee7\u7eed\u3002\u672c\u6b21\u5fc5\u987b\u6bcf\u6b21\u91cd\u65b0\u6388\u6743\u5fae\u4fe1\u624b\u673a\u53f7\u3002',
    },
  }[purpose];
  if (!presentation) throw runtimeError('DESKTOP_CHALLENGE_PURPOSE_INVALID');
  return Object.freeze({
    purpose,
    ...presentation,
    isHostOperation: purpose.startsWith('primary-host-'),
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
  if (!PURPOSES.has(purpose)) throw runtimeError('DESKTOP_CHALLENGE_PURPOSE_INVALID');
  if (!KNOWN_STATUSES.has(status)) throw runtimeError('DESKTOP_CHALLENGE_STATUS_INVALID');
  return Object.freeze({
    id: normalizedChallengeId(value.id),
    deviceName,
    keyFingerprintSummary: fingerprintSummary(value.keyFingerprintSummary || value.keyFingerprint),
    purpose,
    status,
    rowVersion: safeRowVersion(value.rowVersion ?? value.row_version),
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
  if (projected.purpose.startsWith('primary-host-')) {
    return ({
      pending_phone: 'phone-required',
      identity_verified: 'operation-confirmed',
      consumed: 'operation-confirmed',
      rejected: 'rejected',
      expired: 'expired',
    })[status] || 'error';
  }
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
  desktopAuthorizationPurposePresentation,
  desktopAuthorizationErrorMessage,
  desktopAuthorizationView,
  parseDesktopAuthorizationChallengeId,
  phoneCodeFromAuthorizationEvent,
  projectDesktopAuthorizationChallenge,
};
