import {
  clearDesktopAuthorizationSession,
  saveDesktopAuthorizationSession,
} from './desktopAuthorizationSession.mjs';

export const OFFLINE_LEASE_MAX_MS = 14 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 30 * 1000;
const DESKTOP_ROLE_SET = new Set(['super_admin', 'teacher']);
const PRIVILEGED_ROLES = new Set(['super_admin']);
const CLOUD_IDENTITY_OUTAGE_STATUSES = new Set([502, 503, 504]);

function identityError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function normalizedBaseUrl(value) {
  const baseUrl = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) throw identityError('DESKTOP_IDENTITY_BASE_URL_REQUIRED');
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (cause) {
    throw identityError('DESKTOP_IDENTITY_BASE_URL_REQUIRED', cause);
  }
  const loopbackHost = parsed.hostname === 'localhost'
    || parsed.hostname === '127.0.0.1'
    || parsed.hostname === '[::1]';
  if (parsed.protocol === 'http:' && !loopbackHost) {
    throw identityError('DESKTOP_IDENTITY_INSECURE_BASE_URL');
  }
  return baseUrl;
}

function dateValue(value) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function uniqueRoles(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(role => String(role || '').trim()).filter(role => DESKTOP_ROLE_SET.has(role)))]
    : [];
}

function scopedValue(...candidates) {
  for (const [source, key] of candidates) {
    if (source && Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
      return source[key] ?? null;
    }
  }
  return null;
}

export function preferredActiveRole(eligibleRoles, requestedRole) {
  const roles = uniqueRoles(eligibleRoles);
  if (requestedRole && roles.includes(requestedRole)) return requestedRole;
  if (roles.includes('teacher')) return 'teacher';
  return roles[0] || null;
}

export function partitionKeyForIdentity(identity = {}) {
  const userId = String(identity.userId || identity.id || '').trim();
  const activeRole = String(identity.activeRole || identity.active_role || '').trim();
  if (!userId || !DESKTOP_ROLE_SET.has(activeRole)) throw identityError('DESKTOP_IDENTITY_PARTITION_INVALID');
  let subjectId = 'all';
  if (activeRole === 'teacher') {
    subjectId = String(identity.teacherId || identity.teacher_id || '').trim() || 'unbound';
  }
  return `${userId}:${activeRole}:${subjectId}`;
}

function profileFrom({ identity = {}, authorization = {}, session = {}, fallback = {} } = {}) {
  const eligibleRoles = uniqueRoles(
    session.eligibleRoles
      || identity.eligible_roles
      || identity.eligibleRoles
      || fallback.eligibleRoles
  );
  const activeRole = preferredActiveRole(
    eligibleRoles,
    session.activeRole || identity.active_role || identity.activeRole || fallback.activeRole
  );
  const userId = String(
    session.userId || identity.id || identity.userId || authorization.userId || fallback.userId || fallback.user?.id || ''
  ).trim();
  if (!userId || !activeRole || !eligibleRoles.includes(activeRole)) {
    throw identityError('DESKTOP_IDENTITY_PROFILE_INVALID');
  }
  const teacherId = scopedValue(
    [session, 'teacherId'], [session, 'teacher_id'],
    [identity, 'teacherId'], [identity, 'teacher_id'],
    [fallback, 'teacherId'], [fallback, 'teacher_id'],
  );
  const studentId = scopedValue(
    [session, 'studentId'], [session, 'student_id'],
    [identity, 'studentId'], [identity, 'student_id'],
    [fallback, 'studentId'], [fallback, 'student_id'],
  );
  return {
    userId,
    user: {
      id: userId,
      name: String(identity.name || identity.user_name || identity.user?.name || fallback.user?.name || '').trim(),
    },
    eligibleRoles,
    activeRole,
    teacherId: activeRole === 'teacher' ? teacherId : null,
    studentId: activeRole === 'student' ? studentId : null,
  };
}

function validOfflineLease(vaultStatus, now) {
  const lease = vaultStatus?.offlineLease;
  if (!lease || typeof lease !== 'object') return null;
  const issuedAt = dateValue(lease.issuedAt);
  const expiresAt = dateValue(lease.expiresAt);
  if (issuedAt === null || expiresAt === null
    || issuedAt > now.getTime() + CLOCK_SKEW_MS
    || expiresAt <= now.getTime()
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > OFFLINE_LEASE_MAX_MS) return null;
  if (String(lease.userId || '') !== String(vaultStatus.user?.id || '')
    || String(lease.deviceId || '') !== String(vaultStatus.deviceId || '')
    || String(lease.authorizationId || '') !== String(vaultStatus.authorizationId || '')
    || Number(lease.credentialVersion) !== Number(vaultStatus.credentialVersion)) return null;
  const roles = uniqueRoles(lease.eligibleRoles);
  if (!roles.includes(lease.activeRole) || !uniqueRoles(vaultStatus.eligibleRoles).includes(lease.activeRole)) {
    return null;
  }
  if (lease.activeRole === 'teacher'
    && String(lease.teacherId || '') !== String(vaultStatus.teacherId || '')) return null;
  if (lease.activeRole === 'student'
    && String(lease.studentId || '') !== String(vaultStatus.studentId || '')) return null;
  return lease;
}

function sessionMatchesVault(sessionValue, vaultStatus, now) {
  if (!sessionValue || typeof sessionValue !== 'object') return false;
  const session = sessionValue.session || {};
  const profile = sessionValue.profile || {};
  const expiresAt = dateValue(sessionValue.expiresAt || session.expiresAt);
  const sessionRoles = uniqueRoles(session.eligibleRoles || profile.eligibleRoles);
  const vaultRoles = uniqueRoles(vaultStatus.eligibleRoles);
  const activeRole = session.activeRole || profile.activeRole;
  const sessionTeacherId = scopedValue([session, 'teacherId'], [profile, 'teacherId']);
  const sessionStudentId = scopedValue([session, 'studentId'], [profile, 'studentId']);
  const vaultTeacherId = scopedValue([vaultStatus, 'teacherId']);
  const vaultStudentId = scopedValue([vaultStatus, 'studentId']);
  const sameRoles = sessionRoles.length === vaultRoles.length
    && sessionRoles.every(role => vaultRoles.includes(role));
  const sameScope = String(sessionTeacherId || '') === String(vaultTeacherId || '')
    && String(sessionStudentId || '') === String(vaultStudentId || '');
  const validRoleScope = activeRole === 'teacher'
    ? Boolean(sessionTeacherId) && !sessionStudentId
    : activeRole === 'student'
      ? Boolean(sessionStudentId) && !sessionTeacherId
      : !sessionTeacherId && !sessionStudentId;
  return expiresAt !== null
    && expiresAt > now.getTime()
    && String(session.userId || profile.userId || profile.user?.id || '') === String(vaultStatus.user?.id || '')
    && String(session.deviceId || profile.deviceId || '') === String(vaultStatus.deviceId || '')
    && String(session.id || '') === String(vaultStatus.authorizationId || '')
    && activeRole === vaultStatus.activeRole
    && sessionRoles.includes(activeRole)
    && vaultRoles.includes(activeRole)
    && sameRoles
    && sameScope
    && validRoleScope;
}

function unlockedState(kind, identity) {
  const activeRole = identity.activeRole || identity.active_role;
  const normalized = {
    userId: identity.userId || identity.id || identity.user?.id,
    activeRole,
    teacherId: activeRole === 'teacher' ? (identity.teacherId ?? identity.teacher_id ?? null) : null,
    studentId: activeRole === 'student' ? (identity.studentId ?? identity.student_id ?? null) : null,
  };
  return {
    kind,
    ...normalized,
    eligibleRoles: uniqueRoles(identity.eligibleRoles || identity.eligible_roles),
    expiresAt: identity.expiresAt || identity.expires_at || null,
    partitionKey: partitionKeyForIdentity(normalized),
  };
}

export function resolveDesktopGateState({ vaultStatus, online, onlineSession = null, now = new Date() } = {}) {
  const current = now instanceof Date ? new Date(now) : new Date(now);
  if (!Number.isFinite(current.getTime())) throw identityError('DESKTOP_IDENTITY_CLOCK_INVALID');
  if (!vaultStatus || vaultStatus.state === 'empty') return { kind: 'registration-required' };
  if (vaultStatus.legacyUpgradeRequired || vaultStatus.state === 'legacy_upgrade_required') {
    return { kind: 'upgrade-required' };
  }
  if (!vaultStatus.unlocked || vaultStatus.state === 'sealed') {
    return { kind: 'locked', ...(vaultStatus.deviceId ? { deviceId: vaultStatus.deviceId } : {}) };
  }
  if (online) {
    if (!sessionMatchesVault(onlineSession, vaultStatus, current)) {
      return { kind: 'online-authentication-required' };
    }
    const session = onlineSession.session || {};
    const profile = onlineSession.profile || vaultStatus;
    return unlockedState('online-unlocked', {
      ...profile,
      userId: session.userId || profile.userId || profile.user?.id,
      activeRole: session.activeRole || profile.activeRole,
      eligibleRoles: session.eligibleRoles || profile.eligibleRoles,
      expiresAt: onlineSession.expiresAt || session.expiresAt,
    });
  }
  const lease = validOfflineLease(vaultStatus, current);
  if (!lease) return { kind: 'offline-blocked' };
  return unlockedState('offline-unlocked', lease);
}

export function canStartBusinessRuntime({ gateState } = {}) {
  return gateState?.kind === 'online-unlocked'
    || gateState?.kind === 'offline-unlocked';
}

export function desktopIdentityExpiryDelay(gateState, now = new Date()) {
  if (!canStartBusinessRuntime({ gateState })) return null;
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const expiresAt = Date.parse(String(gateState.expiresAt || ''));
  if (!Number.isFinite(current) || !Number.isFinite(expiresAt)) return 0;
  return Math.max(0, expiresAt - current);
}

export function isDesktopIdentityNetworkFailure(error) {
  const causeCode = String(error?.cause?.code || error?.code || '');
  return error?.name === 'TypeError'
    || [
      'ECONNREFUSED',
      'ECONNRESET',
      'ENETUNREACH',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'CLOUD_ONLINE_IDENTITY_UNAVAILABLE',
      'TARGET_HOST_REQUIRED',
      'TARGET_HOST_NOT_FOUND',
    ].includes(causeCode);
}

async function responseData(response) {
  if (CLOUD_IDENTITY_OUTAGE_STATUSES.has(Number(response?.status))) {
    throw identityError('CLOUD_ONLINE_IDENTITY_UNAVAILABLE');
  }
  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    throw identityError('DESKTOP_IDENTITY_RESPONSE_INVALID', cause);
  }
  if (!response.ok || (payload?.success !== true && payload?.ok !== true)) {
    throw identityError(payload?.code || 'DESKTOP_IDENTITY_REQUEST_FAILED');
  }
  return payload.data || payload;
}

async function request(fetchImpl, baseUrl, pathname, { method = 'GET', body, token } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(`${normalizedBaseUrl(baseUrl)}${pathname}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return responseData(response);
}

function dataUrlFromBytes(bytes, mimeType) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let offset = 0; offset < view.length; offset += 8192) {
    binary += String.fromCharCode(...view.subarray(offset, Math.min(offset + 8192, view.length)));
  }
  if (typeof btoa !== 'function') throw identityError('DESKTOP_CLOUD_QUESTION_ASSET_RESPONSE_INVALID');
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function defaultSessionStore() {
  return {
    save: value => saveDesktopAuthorizationSession(value),
    clear: () => clearDesktopAuthorizationSession(),
  };
}

function onlineSessionValue({ token, session, profile }) {
  if (!token || !session?.id || !session?.deviceId || !session?.userId) {
    throw identityError('DESKTOP_SESSION_RESPONSE_INVALID');
  }
  return {
    token,
    expiresAt: session.expiresAt,
    session: { ...session },
    profile: { ...profile, user: { ...profile.user } },
  };
}

export function createDesktopIdentityClient({
  desktopIdentity = globalThis.window?.desktopIdentity,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  sessionStore = defaultSessionStore(),
  clearRoleCache = async () => {},
  onlineRegistrationCommand = null,
} = {}) {
  if (!desktopIdentity || typeof desktopIdentity.status !== 'function') {
    throw identityError('DESKTOP_IDENTITY_BRIDGE_REQUIRED');
  }
  if (typeof fetchImpl !== 'function') throw identityError('DESKTOP_IDENTITY_FETCH_REQUIRED');
  let activePassword = null;

  function currentDate() {
    const current = now();
    const date = current instanceof Date ? new Date(current) : new Date(current);
    if (!Number.isFinite(date.getTime())) throw identityError('DESKTOP_IDENTITY_CLOCK_INVALID');
    return date;
  }

  async function exchangeDirectSession(baseUrl, vaultStatus) {
    const challengeData = await request(
      fetchImpl,
      baseUrl,
      '/api/desktop-identity/session/challenges/start',
      {
        method: 'POST',
        body: {
          authorizationId: vaultStatus.authorizationId,
          deviceId: vaultStatus.deviceId,
        },
      }
    );
    const challenge = challengeData.challenge;
    const proof = await desktopIdentity.signChallenge({
      purpose: 'session',
      authorizationId: challenge.authorizationId,
      challengeId: challenge.id,
      credentialVersion: challenge.credentialVersion,
      nonce: challenge.nonce,
      nonceIssuedAt: challenge.nonceIssuedAt,
    });
    return request(
      fetchImpl,
      baseUrl,
      `/api/desktop-identity/session/challenges/${encodeURIComponent(challenge.id)}/exchange`,
      {
        method: 'POST',
        body: { signature: proof.signature, expectedRowVersion: challenge.rowVersion },
      }
    );
  }

  async function saveIssuedSession({ issued, vaultStatus }) {
    if (!issued.profile) throw identityError('DESKTOP_SESSION_PROFILE_REQUIRED');
    const profile = profileFrom({
      identity: issued.profile,
      session: issued.session,
      authorization: {
        id: vaultStatus.authorizationId,
        userId: vaultStatus.user?.id,
      },
      fallback: issued.profile || vaultStatus,
    });
    const stored = onlineSessionValue({ token: issued.token, session: issued.session, profile });
    if (!issued.offlineLease) throw identityError('DESKTOP_OFFLINE_LEASE_REQUIRED');
    if (!desktopIdentity.acceptIssuedSession) {
      throw identityError('DESKTOP_IDENTITY_ISSUED_SESSION_ACCEPT_UNAVAILABLE');
    }
    const acceptedVaultStatus = await desktopIdentity.acceptIssuedSession({
      session: issued.session,
      profile,
      offlineLease: issued.offlineLease,
    });
    await sessionStore.save(stored);
    return {
      ...stored,
      vaultStatus: acceptedVaultStatus,
      gateState: resolveDesktopGateState({
        vaultStatus: acceptedVaultStatus,
        online: true,
        onlineSession: stored,
        now: currentDate(),
      }),
    };
  }

  async function resume({ baseUrl, online = true } = {}) {
    if (typeof desktopIdentity.resume !== 'function') {
      throw identityError('DESKTOP_IDENTITY_RESUME_UNAVAILABLE');
    }
    const vaultStatus = await desktopIdentity.resume();
    activePassword = 'managed-session';
    if (!online) {
      await sessionStore.clear();
      return {
        offline: true,
        vaultStatus,
        gateState: resolveDesktopGateState({ vaultStatus, online: false, now: currentDate() }),
      };
    }
    return saveIssuedSession({
      issued: await exchangeDirectSession(baseUrl, vaultStatus),
      vaultStatus,
    });
  }

  async function beginUnifiedOnlineRegistration({ baseUrl, deviceName, idempotencyKey } = {}) {
    if (typeof desktopIdentity.beginUnifiedOnlineRegistration !== 'function') {
      throw identityError('DESKTOP_UNIFIED_ONLINE_REGISTRATION_UNAVAILABLE');
    }
    const normalizedUrl = normalizedBaseUrl(baseUrl);
    const normalizedIdempotencyKey = String(idempotencyKey || '').trim();
    if (!normalizedIdempotencyKey || normalizedIdempotencyKey.length > 256) {
      throw identityError('DESKTOP_UNIFIED_ONLINE_REGISTRATION_CONTEXT_INVALID');
    }
    const publicIdentity = await desktopIdentity.beginUnifiedOnlineRegistration({ deviceName });
    const started = await request(fetchImpl, normalizedUrl, '/api/desktop/pairing/start', {
      method: 'POST',
      body: {
        installationId: publicIdentity.deviceId,
        installationPublicKey: publicIdentity.publicKey,
        idempotencyKey: normalizedIdempotencyKey,
      },
    });
    const qrImageDataUrl = typeof started?.qrImageDataUrl === 'string' ? started.qrImageDataUrl : '';
    if (!started?.pairingId || !started?.pairingSecret || !started?.expiresAt
      || qrImageDataUrl.length > 8 * 1024 * 1024
      || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/u.test(qrImageDataUrl)) {
      throw identityError('DESKTOP_UNIFIED_ONLINE_PAIRING_INVALID');
    }
    return Object.freeze({
      baseUrl: normalizedUrl,
      publicIdentity: Object.freeze({ ...publicIdentity }),
      idempotencyKey: normalizedIdempotencyKey,
      status: 'awaiting_online_verification',
      pairingId: String(started.pairingId),
      pairingSecret: String(started.pairingSecret),
      expiresAt: String(started.expiresAt),
      qrImageDataUrl,
    });
  }

  async function beginPasswordVerification({ baseUrl, deviceName, idempotencyKey, loginType, login, password } = {}) {
    if (typeof desktopIdentity.beginUnifiedOnlineRegistration !== 'function') {
      throw identityError('DESKTOP_UNIFIED_ONLINE_REGISTRATION_UNAVAILABLE');
    }
    const normalizedUrl = normalizedBaseUrl(baseUrl);
    const normalizedIdempotencyKey = String(idempotencyKey || '').trim();
    const normalizedLogin = String(login || '').trim();
    if (!normalizedIdempotencyKey || normalizedIdempotencyKey.length > 256
      || !['phone', 'account_name'].includes(loginType) || !normalizedLogin || normalizedLogin.length > 256
      || typeof password !== 'string' || password.length === 0 || password.length > 1024) {
      throw identityError('DESKTOP_PASSWORD_VERIFICATION_INPUT_INVALID');
    }
    const verified = await request(fetchImpl, normalizedUrl, '/api/desktop/password-verification', {
      method: 'POST',
      body: { loginType, login: normalizedLogin, password },
    });
    if (!verified?.verificationToken || !verified?.deviceChallenge) {
      throw identityError('DESKTOP_PASSWORD_VERIFICATION_INVALID');
    }
    const desktopAccess = await readVerifiedDesktopAccess(normalizedUrl, verified.verificationToken);
    const publicIdentity = await desktopIdentity.beginUnifiedOnlineRegistration({ deviceName });
    if (!publicIdentity?.deviceId || !publicIdentity?.publicKey || !publicIdentity?.keyFingerprint) {
      throw identityError('DESKTOP_UNIFIED_ONLINE_REGISTRATION_CONTEXT_INVALID');
    }
    return Object.freeze({
      baseUrl: normalizedUrl,
      publicIdentity: Object.freeze({ ...publicIdentity }),
      idempotencyKey: normalizedIdempotencyKey,
      status: 'verified',
      verificationToken: String(verified.verificationToken),
      deviceChallenge: String(verified.deviceChallenge),
      desktopAccess,
    });
  }

  async function beginPasswordEnrollment({ baseUrl, deviceName, idempotencyKey, phoneCode, loginName, password } = {}) {
    if (typeof desktopIdentity.beginUnifiedOnlineRegistration !== 'function') {
      throw identityError('DESKTOP_UNIFIED_ONLINE_REGISTRATION_UNAVAILABLE');
    }
    const normalizedUrl = normalizedBaseUrl(baseUrl);
    const normalizedIdempotencyKey = String(idempotencyKey || '').trim();
    const normalizedPhoneCode = String(phoneCode || '').trim();
    if (!normalizedIdempotencyKey || normalizedIdempotencyKey.length > 256 || !normalizedPhoneCode || normalizedPhoneCode.length > 8192
      || !(loginName === null || (typeof loginName === 'string' && loginName === loginName.trim() && loginName.length > 0 && loginName.length <= 64))
      || typeof password !== 'string' || password.length === 0 || password.length > 1024) {
      throw identityError('DESKTOP_PASSWORD_ENROLLMENT_INPUT_INVALID');
    }
    const enrolled = await request(fetchImpl, normalizedUrl, '/api/desktop/password-enrollment', {
      method: 'POST',
      body: { phoneCode: normalizedPhoneCode, loginName, password },
    });
    if (!enrolled?.verificationToken || !enrolled?.deviceChallenge) {
      throw identityError('DESKTOP_PASSWORD_ENROLLMENT_INVALID');
    }
    const desktopAccess = await readVerifiedDesktopAccess(normalizedUrl, enrolled.verificationToken);
    const publicIdentity = await desktopIdentity.beginUnifiedOnlineRegistration({ deviceName });
    if (!publicIdentity?.deviceId || !publicIdentity?.publicKey || !publicIdentity?.keyFingerprint) {
      throw identityError('DESKTOP_UNIFIED_ONLINE_REGISTRATION_CONTEXT_INVALID');
    }
    return Object.freeze({
      baseUrl: normalizedUrl,
      publicIdentity: Object.freeze({ ...publicIdentity }),
      idempotencyKey: normalizedIdempotencyKey,
      status: 'verified',
      verificationToken: String(enrolled.verificationToken),
      deviceChallenge: String(enrolled.deviceChallenge),
      desktopAccess,
    });
  }

  async function enrollPasswordForVerifiedRegistration({ pending, loginName, password } = {}) {
    if (!pending?.baseUrl || !pending?.verificationToken || !pending?.deviceChallenge
      || pending?.status !== 'verified' || pending?.recovery === true) {
      throw identityError('DESKTOP_PASSWORD_ENROLLMENT_CONTEXT_INVALID');
    }
    if (!(loginName === null || (typeof loginName === 'string' && loginName === loginName.trim() && loginName.length > 0 && loginName.length <= 64))
      || typeof password !== 'string' || password.length === 0 || password.length > 1024) {
      throw identityError('DESKTOP_PASSWORD_ENROLLMENT_INPUT_INVALID');
    }
    const enrolled = await request(fetchImpl, pending.baseUrl, '/api/desktop/password-enrollment-from-verification', {
      method: 'POST',
      body: { verificationToken: pending.verificationToken, loginName, password },
    });
    if (!enrolled?.verificationToken || !enrolled?.deviceChallenge
      || enrolled.verificationToken !== pending.verificationToken || enrolled.deviceChallenge !== pending.deviceChallenge) {
      throw identityError('DESKTOP_PASSWORD_ENROLLMENT_INVALID');
    }
    return Object.freeze({ ...pending, cloudPasswordEnrolled: true });
  }

  async function readVerifiedDesktopAccess(baseUrl, verificationToken) {
    const value = await request(fetchImpl, baseUrl, '/api/desktop/verified-access', {
      method: 'POST',
      body: { verificationToken },
    });
    const roles = uniqueRoles(value?.roles);
    const teacherId = value?.teacherId === null ? null : String(value?.teacherId || '').trim();
    if (value?.access === 'teacher_registration_required' && roles.length === 0 && teacherId === null) {
      return Object.freeze({ access: value.access, roles: Object.freeze([]), teacherId: null });
    }
    if (value?.access !== 'allowed' || roles.length === 0
      || (roles.includes('teacher') && !teacherId)) {
      throw identityError('DESKTOP_VERIFIED_ACCESS_INVALID');
    }
    return Object.freeze({ access: value.access, roles: Object.freeze(roles), teacherId });
  }

  async function registerTeacherForVerifiedRegistration({ pending, name, subject = null } = {}) {
    if (!pending?.baseUrl || !pending?.verificationToken || pending?.status !== 'verified' || pending?.recovery === true) {
      throw identityError('DESKTOP_TEACHER_REGISTRATION_CONTEXT_INVALID');
    }
    if (typeof name !== 'string' || name !== name.trim() || name.length === 0 || name.length > 128
      || !(subject === null || (typeof subject === 'string' && subject === subject.trim() && subject.length > 0 && subject.length <= 128))) {
      throw identityError('DESKTOP_TEACHER_REGISTRATION_INPUT_INVALID');
    }
    const registered = await request(fetchImpl, pending.baseUrl, '/api/desktop/teacher-self-registration', {
      method: 'POST',
      body: { verificationToken: pending.verificationToken, name, subject },
    });
    if (typeof registered?.teacherId !== 'string' || registered.teacherId.length === 0
      || typeof registered?.updatedAt !== 'string' || !Number.isFinite(Date.parse(registered.updatedAt))
      || typeof registered?.replayed !== 'boolean') {
      throw identityError('DESKTOP_TEACHER_REGISTRATION_INVALID');
    }
    return Object.freeze({
      teacherId: registered.teacherId,
      updatedAt: registered.updatedAt,
      replayed: registered.replayed,
      desktopAccess: Object.freeze({ access: 'allowed', roles: Object.freeze(['teacher']), teacherId: registered.teacherId }),
    });
  }

  async function pollUnifiedOnlineRegistration(pending) {
    if (!pending?.baseUrl || !pending?.pairingId || !pending?.pairingSecret || !pending?.publicIdentity
      || !pending?.idempotencyKey) {
      throw identityError('DESKTOP_UNIFIED_ONLINE_REGISTRATION_CONTEXT_INVALID');
    }
    const data = await request(fetchImpl, pending.baseUrl,
      `/api/desktop/pairing/${encodeURIComponent(pending.pairingId)}?secret=${encodeURIComponent(pending.pairingSecret)}`);
    if (data?.status === 'awaiting_online_verification') return Object.freeze({ ...pending, status: data.status });
    if (data?.status !== 'verified' || !data.verificationToken || !data.deviceChallenge) {
      throw identityError('DESKTOP_UNIFIED_ONLINE_PAIRING_INVALID');
    }
    const desktopAccess = await readVerifiedDesktopAccess(pending.baseUrl, data.verificationToken);
    return Object.freeze({
      ...pending,
      status: 'verified',
      verificationToken: String(data.verificationToken),
      deviceChallenge: String(data.deviceChallenge),
      desktopAccess,
    });
  }

  async function completeUnifiedOnlineRegistration({ pending } = {}) {
    if (!pending?.baseUrl || !pending?.publicIdentity || !pending?.idempotencyKey
      || !pending?.verificationToken || !pending?.deviceChallenge) {
      throw identityError('DESKTOP_UNIFIED_ONLINE_REGISTRATION_CONTEXT_INVALID');
    }
    if (pending?.desktopAccess?.access !== 'allowed'
      || !uniqueRoles(pending.desktopAccess.roles).some(role => role === 'teacher' || role === 'super_admin')) {
      throw identityError('DESKTOP_TEACHER_REGISTRATION_REQUIRED');
    }
    const completeVault = desktopIdentity.completeRegistration;
    if (typeof desktopIdentity.signChallenge !== 'function' || typeof completeVault !== 'function') {
      throw identityError('DESKTOP_UNIFIED_ONLINE_REGISTRATION_UNAVAILABLE');
    }
    const proof = await desktopIdentity.signChallenge({
      purpose: 'unified-online-registration',
      challenge: pending.deviceChallenge,
    });
    if (!proof?.signature) throw identityError('DESKTOP_UNIFIED_ONLINE_PROOF_INVALID');
    const registered = await request(fetchImpl, pending.baseUrl, '/api/desktop/online-registration', {
      method: 'POST',
      body: {
        verificationToken: pending.verificationToken,
        installationId: pending.publicIdentity.deviceId,
        installationPublicKey: pending.publicIdentity.publicKey,
        deviceProof: proof.signature,
        idempotencyKey: pending.idempotencyKey,
      },
    });
    if (!registered?.sessionToken || !registered?.sessionId || !registered?.offlineLease
      || typeof registered.offlineLease.signature !== 'string' || !registered.offlineLease.signature) {
      throw identityError('DESKTOP_UNIFIED_ONLINE_REGISTRATION_INVALID');
    }
    const context = await request(fetchImpl, pending.baseUrl, '/api/desktop/session-context', {
      token: registered.sessionToken,
    });
    const eligibleRoles = uniqueRoles(context?.roles);
    const activeRole = preferredActiveRole(eligibleRoles);
    if (!context?.authorityId || !context?.accountId || !context?.deviceId || !context?.installationId
      || context.sessionId !== registered.sessionId || context.deviceId !== pending.publicIdentity.deviceId
      || context.installationId !== pending.publicIdentity.deviceId || !context.expiresAt
      || !activeRole
      || !Number.isSafeInteger(Number(context.rowVersion)) || Number(context.rowVersion) < 1
      || (activeRole === 'teacher' && !context.teacherId)
      || (activeRole === 'student' && !context.studentId)) {
      throw identityError('DESKTOP_UNIFIED_ONLINE_CONTEXT_INVALID');
    }
    const lastPhoneVerifiedAt = currentDate().toISOString();
    const authorization = {
      id: context.sessionId,
      deviceId: context.deviceId,
      deviceName: pending.publicIdentity.deviceName,
      deviceKind: pending.publicIdentity.deviceKind,
      userId: context.accountId,
      keyFingerprint: pending.publicIdentity.keyFingerprint,
      status: 'active',
      authorizationSource: 'wechat_phone',
      credentialVersion: 1,
      lastPhoneVerifiedAt,
      phoneReverifyDueAt: context.expiresAt,
    };
    const profile = {
      userId: context.accountId,
      user: { id: context.accountId, name: '\u6211\u7684\u8d26\u53f7' },
      eligibleRoles,
      activeRole,
      teacherId: activeRole === 'teacher' ? context.teacherId : null,
      studentId: activeRole === 'student' ? context.studentId : null,
    };
    const vaultStatus = await completeVault({
      authorization,
      profile,
      offlineLease: registered.offlineLease,
    });
    activePassword = 'managed-session';
    const stored = onlineSessionValue({
      token: registered.sessionToken,
      session: {
        id: context.sessionId,
        userId: context.accountId,
        deviceId: context.deviceId,
        activeRole,
        eligibleRoles,
        rowVersion: Number(context.rowVersion),
        expiresAt: context.expiresAt,
      },
      profile,
    });
    await sessionStore.save(stored);
    return {
      ...stored,
      vaultStatus,
      gateState: resolveDesktopGateState({ vaultStatus, online: true, onlineSession: stored, now: currentDate() }),
    };
  }

  async function ensureOnlineSession({ baseUrl } = {}) {
    return resume({ baseUrl, online: true });
  }

  async function switchRole({ baseUrl, currentSession, activeRole } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token || !currentSession.session) {
      throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    }
    const currentRole = currentSession.session.activeRole;
    if (currentRole === activeRole) throw identityError('DESKTOP_ACTIVE_ROLE_UNCHANGED');
    if (!uniqueRoles(currentSession.session.eligibleRoles).includes(activeRole)) {
      throw identityError('ACTIVE_ROLE_NOT_GRANTED');
    }
    const body = { activeRole };
    if (PRIVILEGED_ROLES.has(activeRole) && !PRIVILEGED_ROLES.has(currentRole)) {
      const proof = await desktopIdentity.signChallenge({
        purpose: 'role-elevation',
        sessionId: currentSession.session.id,
        activeRole,
        sessionVersion: currentSession.session.rowVersion,
      });
      body.elevationIssuedAt = proof.elevationIssuedAt;
      body.elevationSignature = proof.signature;
    }
    const priorPartition = partitionKeyForIdentity({
      ...currentSession.profile,
      userId: currentSession.session.userId,
      activeRole: currentRole,
    });
    await clearRoleCache(priorPartition);
    const exchanged = await request(fetchImpl, baseUrl, '/api/desktop-identity/session/role', {
      method: 'POST',
      token: currentSession.token,
      body,
    });
    const profile = profileFrom({
      identity: exchanged.profile,
      session: exchanged.session,
      fallback: currentSession.profile,
    });
    const stored = onlineSessionValue({ token: exchanged.token, session: exchanged.session, profile });
    if (!exchanged.offlineLease) throw identityError('DESKTOP_OFFLINE_LEASE_REQUIRED');
    if (typeof desktopIdentity.acceptIssuedSession !== 'function') {
      throw identityError('DESKTOP_IDENTITY_ISSUED_SESSION_ACCEPT_UNAVAILABLE');
    }
    await desktopIdentity.acceptIssuedSession({
      session: exchanged.session,
      profile,
      offlineLease: exchanged.offlineLease,
    });
    await sessionStore.save(stored);
    return stored;
  }

  async function lock() {
    activePassword = null;
    await sessionStore.clear();
    return desktopIdentity.lock();
  }

  async function listCloudSchedules({ baseUrl, currentSession } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) {
      throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    }
    const data = await request(fetchImpl, baseUrl, '/api/business/schedules', {
      token: currentSession.token,
    });
    if (!Array.isArray(data?.schedules)) {
      throw identityError('DESKTOP_CLOUD_SCHEDULE_RESPONSE_INVALID');
    }
    return data.schedules;
  }

  async function listCloudBusinessProjection({ baseUrl, currentSession } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) {
      throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    }
    const data = await request(fetchImpl, baseUrl, '/api/business/desktop-projection', {
      token: currentSession.token,
    });
    const projection = data?.projection;
    if (!projection || typeof projection !== 'object' || Array.isArray(projection)
      || !['students', 'student_contacts', 'teachers', 'courses', 'schedules', 'institutions', 'schools', 'rooms', 'grades', 'payments', 'consumptions', 'assetRecords', 'assetCategories', 'taxonomy_systems', 'taxonomy_nodes'].every(key => Array.isArray(projection[key]))) {
      throw identityError('DESKTOP_CLOUD_PROJECTION_RESPONSE_INVALID');
    }
    return projection;
  }

  async function listCloudQuestions({ baseUrl, currentSession, limit = 200 } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) {
      throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw identityError('DESKTOP_CLOUD_QUESTION_LIMIT_INVALID');
    }
    const questions = [];
    const seenIds = new Set();
    let afterId = null;
    for (;;) {
      const suffix = afterId === null ? '' : `&afterId=${encodeURIComponent(afterId)}`;
      const data = await request(fetchImpl, baseUrl, `/api/desktop/question-bank/questions?limit=${limit}${suffix}`, {
        token: currentSession.token,
      });
      if (!Array.isArray(data?.questions) || data.questions.length > limit
        || !(data.nextCursor === null || (typeof data.nextCursor === 'string' && data.nextCursor.trim() && data.nextCursor.length <= 128))) {
        throw identityError('DESKTOP_CLOUD_QUESTION_RESPONSE_INVALID');
      }
      for (const question of data.questions) {
        if (!question || typeof question.id !== 'string' || !question.id.trim() || question.id.length > 128
          || !Number.isSafeInteger(question.version) || question.version < 1 || seenIds.has(question.id)) {
          throw identityError('DESKTOP_CLOUD_QUESTION_RESPONSE_INVALID');
        }
        seenIds.add(question.id);
        questions.push(question);
      }
      if (data.nextCursor === null) return questions;
      if (!data.questions.length || data.nextCursor !== data.questions.at(-1).id || data.nextCursor === afterId) {
        throw identityError('DESKTOP_CLOUD_QUESTION_RESPONSE_INVALID');
      }
      afterId = data.nextCursor;
    }
  }

  async function readCloudQuestionAsset({ baseUrl, currentSession, assetKey } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    const normalizedAssetKey = String(assetKey || '').trim();
    if (!/^[0-9a-f]{64}$/.test(normalizedAssetKey)) throw identityError('DESKTOP_CLOUD_QUESTION_ASSET_INPUT_INVALID');
    const delivery = (await request(fetchImpl, baseUrl, `/api/desktop/question-bank/assets/${encodeURIComponent(normalizedAssetKey)}/delivery`, {
      method: 'POST', body: {}, token: currentSession.token,
    })).delivery;
    if (!delivery || typeof delivery.deliveryId !== 'string' || !/^question_asset_delivery_[A-Za-z0-9_-]{8,128}$/.test(delivery.deliveryId)
      || delivery.status !== 'ready' || typeof delivery.mimeType !== 'string' || !delivery.mimeType) {
      throw identityError('DESKTOP_CLOUD_QUESTION_ASSET_PENDING');
    }
    const response = await fetchImpl(`${normalizedBaseUrl(baseUrl)}/api/desktop/question-bank/asset-deliveries/${encodeURIComponent(delivery.deliveryId)}/download`, {
      headers: { Accept: delivery.mimeType, Authorization: `Bearer ${currentSession.token}` },
    });
    if (!response?.ok || typeof response.arrayBuffer !== 'function') throw identityError('DESKTOP_CLOUD_QUESTION_ASSET_UNAVAILABLE');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 1 || bytes.length > (64 * 1024 * 1024)) throw identityError('DESKTOP_CLOUD_QUESTION_ASSET_RESPONSE_INVALID');
    return dataUrlFromBytes(bytes, delivery.mimeType);
  }

  async function updateCloudSchedule({
    baseUrl, currentSession, scheduleId, expectedUpdatedAt, courseId, startAt, endAt, recurringRule,
    status, roomDisplay, serviceType, tuition, teacherFee, notes, pricings,
  } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) {
      throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    }
    const normalizedScheduleId = String(scheduleId || '').trim();
    const normalizedCourseId = String(courseId || '').trim();
    if (!normalizedScheduleId || !normalizedCourseId || !Array.isArray(pricings)) throw identityError('DESKTOP_CLOUD_SCHEDULE_INPUT_INVALID');
    const data = await request(fetchImpl, baseUrl, `/api/business/schedules/${encodeURIComponent(normalizedScheduleId)}`, {
      method: 'PUT',
      token: currentSession.token,
      body: {
        expectedUpdatedAt, courseId: normalizedCourseId, startAt, endAt, recurringRule,
        status, roomDisplay, serviceType, tuition, teacherFee, notes, pricings,
      },
    });
    if (!data?.schedule || typeof data.schedule !== 'object'
      || typeof data.schedule.id !== 'string' || typeof data.schedule.updatedAt !== 'string') {
      throw identityError('DESKTOP_CLOUD_SCHEDULE_RESPONSE_INVALID');
    }
    return data.schedule;
  }

  async function createCloudSchedule({
    baseUrl, currentSession, scheduleId, courseId, startAt, endAt, recurringRule, status,
    roomDisplay, serviceType, tuition, teacherFee, notes, pricings,
  } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) {
      throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    }
    const normalizedScheduleId = String(scheduleId || '').trim();
    if (!normalizedScheduleId || !Array.isArray(pricings)) throw identityError('DESKTOP_CLOUD_SCHEDULE_INPUT_INVALID');
    const data = await request(fetchImpl, baseUrl, '/api/business/schedules', {
      method: 'POST',
      token: currentSession.token,
      body: {
        scheduleId: normalizedScheduleId,
        data: { courseId, startAt, endAt, recurringRule, status, roomDisplay, serviceType, tuition, teacherFee, notes, pricings },
      },
    });
    if (!data?.schedule || data.schedule.id !== normalizedScheduleId || typeof data.schedule.updatedAt !== 'string') {
      throw identityError('DESKTOP_CLOUD_SCHEDULE_RESPONSE_INVALID');
    }
    return data.schedule;
  }

  async function deleteCloudSchedule({ baseUrl, currentSession, scheduleId, expectedUpdatedAt } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) {
      throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    }
    const normalizedScheduleId = String(scheduleId || '').trim();
    if (!normalizedScheduleId) throw identityError('DESKTOP_CLOUD_SCHEDULE_ID_REQUIRED');
    const data = await request(fetchImpl, baseUrl, `/api/business/schedules/${encodeURIComponent(normalizedScheduleId)}`, {
      method: 'DELETE', token: currentSession.token, body: { expectedUpdatedAt },
    });
    if (!data?.schedule || data.schedule.id !== normalizedScheduleId || typeof data.schedule.updatedAt !== 'string') {
      throw identityError('DESKTOP_CLOUD_SCHEDULE_RESPONSE_INVALID');
    }
    return data.schedule;
  }

  async function createCloudFoundationRecord({ baseUrl, currentSession, resource, responseKey, idKey, recordId, data: recordData }) {
    if (!currentSession || currentSession.offline || !currentSession.token) throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    const normalizedId = String(recordId || '').trim();
    if (!normalizedId) throw identityError('DESKTOP_CLOUD_FOUNDATION_ID_REQUIRED');
    const data = await request(fetchImpl, baseUrl, `/api/business/${resource}`, {
      method: 'POST', token: currentSession.token, body: { [idKey]: normalizedId, data: recordData },
    });
    if (!data?.[responseKey] || data[responseKey].id !== normalizedId || typeof data[responseKey].updatedAt !== 'string') throw identityError('DESKTOP_CLOUD_FOUNDATION_RESPONSE_INVALID');
    return data[responseKey];
  }

  async function updateCloudFoundationRecord({ baseUrl, currentSession, resource, responseKey, recordId, data: recordData }) {
    if (!currentSession || currentSession.offline || !currentSession.token) throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    const normalizedId = String(recordId || '').trim();
    if (!normalizedId) throw identityError('DESKTOP_CLOUD_FOUNDATION_ID_REQUIRED');
    const data = await request(fetchImpl, baseUrl, `/api/business/${resource}/${encodeURIComponent(normalizedId)}`, {
      method: 'PUT', token: currentSession.token, body: recordData,
    });
    if (!data?.[responseKey] || data[responseKey].id !== normalizedId || typeof data[responseKey].updatedAt !== 'string') throw identityError('DESKTOP_CLOUD_FOUNDATION_RESPONSE_INVALID');
    return data[responseKey];
  }

  async function deleteCloudFoundationRecord({ baseUrl, currentSession, resource, responseKey, recordId, expectedUpdatedAt }) {
    if (!currentSession || currentSession.offline || !currentSession.token) throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    const normalizedId = String(recordId || '').trim();
    if (!normalizedId) throw identityError('DESKTOP_CLOUD_FOUNDATION_ID_REQUIRED');
    const data = await request(fetchImpl, baseUrl, `/api/business/${resource}/${encodeURIComponent(normalizedId)}`, {
      method: 'DELETE', token: currentSession.token, body: { expectedUpdatedAt },
    });
    if (!data?.[responseKey] || data[responseKey].id !== normalizedId || typeof data[responseKey].updatedAt !== 'string') throw identityError('DESKTOP_CLOUD_FOUNDATION_RESPONSE_INVALID');
    return data[responseKey];
  }

  const createCloudInstitution = input => createCloudFoundationRecord({ ...input, resource: 'institutions', responseKey: 'institution', idKey: 'institutionId', recordId: input?.institutionId, data: { name: input?.name, contactPerson: input?.contactPerson, contactPhone: input?.contactPhone, revenueShare: input?.revenueShare, notes: input?.notes } });
  const updateCloudInstitution = input => updateCloudFoundationRecord({ ...input, resource: 'institutions', responseKey: 'institution', recordId: input?.institutionId, data: { expectedUpdatedAt: input?.expectedUpdatedAt, name: input?.name, contactPerson: input?.contactPerson, contactPhone: input?.contactPhone, revenueShare: input?.revenueShare, notes: input?.notes } });
  const deleteCloudInstitution = input => deleteCloudFoundationRecord({ ...input, resource: 'institutions', responseKey: 'institution', recordId: input?.institutionId });
  const createCloudSchool = input => createCloudFoundationRecord({ ...input, resource: 'schools', responseKey: 'school', idKey: 'schoolId', recordId: input?.schoolId, data: { name: input?.name, count: input?.count } });
  const updateCloudSchool = input => updateCloudFoundationRecord({ ...input, resource: 'schools', responseKey: 'school', recordId: input?.schoolId, data: { expectedUpdatedAt: input?.expectedUpdatedAt, name: input?.name, count: input?.count } });
  const deleteCloudSchool = input => deleteCloudFoundationRecord({ ...input, resource: 'schools', responseKey: 'school', recordId: input?.schoolId });

  async function updateCloudStudent({
    baseUrl, currentSession, studentId, expectedUpdatedAt, name, school, gradeYear, gradeCurrent, institutionId, parentName, notes, sourceType, studentSource,
  } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) {
      throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    }
    const normalizedStudentId = String(studentId || '').trim();
    if (!normalizedStudentId) throw identityError('DESKTOP_CLOUD_STUDENT_ID_REQUIRED');
    const data = await request(fetchImpl, baseUrl, `/api/business/students/${encodeURIComponent(normalizedStudentId)}`, {
      method: 'PUT',
      token: currentSession.token,
      body: { expectedUpdatedAt, name, school, gradeYear, gradeCurrent, institutionId, parentName, notes, sourceType, studentSource },
    });
    if (!data?.student || typeof data.student !== 'object'
      || data.student.id !== normalizedStudentId || typeof data.student.updatedAt !== 'string') {
      throw identityError('DESKTOP_CLOUD_STUDENT_RESPONSE_INVALID');
    }
    return data.student;
  }

  async function createCloudTeacher({ baseUrl, currentSession, teacherId, name, phone, subject, hourlyRate, notes } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    const normalizedTeacherId = String(teacherId || '').trim();
    if (!normalizedTeacherId) throw identityError('DESKTOP_CLOUD_TEACHER_ID_REQUIRED');
    const data = await request(fetchImpl, baseUrl, '/api/business/teachers', {
      method: 'POST', token: currentSession.token, body: { teacherId: normalizedTeacherId, name, phone, subject, hourlyRate, notes },
    });
    if (!data?.teacher || data.teacher.id !== normalizedTeacherId || typeof data.teacher.updatedAt !== 'string') throw identityError('DESKTOP_CLOUD_TEACHER_RESPONSE_INVALID');
    return data.teacher;
  }

  async function updateCloudTeacher({ baseUrl, currentSession, teacherId, expectedUpdatedAt, name, phone, subject, hourlyRate, notes } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    const normalizedTeacherId = String(teacherId || '').trim();
    if (!normalizedTeacherId) throw identityError('DESKTOP_CLOUD_TEACHER_ID_REQUIRED');
    const data = await request(fetchImpl, baseUrl, `/api/business/teachers/${encodeURIComponent(normalizedTeacherId)}`, {
      method: 'PUT', token: currentSession.token, body: { expectedUpdatedAt, name, phone, subject, hourlyRate, notes },
    });
    if (!data?.teacher || data.teacher.id !== normalizedTeacherId || typeof data.teacher.updatedAt !== 'string') throw identityError('DESKTOP_CLOUD_TEACHER_RESPONSE_INVALID');
    return data.teacher;
  }

  async function deleteCloudTeacher({ baseUrl, currentSession, teacherId, expectedUpdatedAt } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    const normalizedTeacherId = String(teacherId || '').trim();
    if (!normalizedTeacherId) throw identityError('DESKTOP_CLOUD_TEACHER_ID_REQUIRED');
    const data = await request(fetchImpl, baseUrl, `/api/business/teachers/${encodeURIComponent(normalizedTeacherId)}`, {
      method: 'DELETE', token: currentSession.token, body: { expectedUpdatedAt },
    });
    if (!data?.teacher || data.teacher.id !== normalizedTeacherId || typeof data.teacher.updatedAt !== 'string') throw identityError('DESKTOP_CLOUD_TEACHER_RESPONSE_INVALID');
    return data.teacher;
  }

  async function createCloudRoom({ baseUrl, currentSession, roomId, name, address } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    const normalizedRoomId = String(roomId || '').trim();
    if (!normalizedRoomId) throw identityError('DESKTOP_CLOUD_ROOM_ID_REQUIRED');
    const data = await request(fetchImpl, baseUrl, '/api/business/rooms', { method: 'POST', token: currentSession.token, body: { roomId: normalizedRoomId, name, address } });
    if (!data?.room || data.room.id !== normalizedRoomId || typeof data.room.updatedAt !== 'string') throw identityError('DESKTOP_CLOUD_ROOM_RESPONSE_INVALID');
    return data.room;
  }

  async function updateCloudRoom({ baseUrl, currentSession, roomId, expectedUpdatedAt, name, address } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    const normalizedRoomId = String(roomId || '').trim();
    if (!normalizedRoomId) throw identityError('DESKTOP_CLOUD_ROOM_ID_REQUIRED');
    const data = await request(fetchImpl, baseUrl, `/api/business/rooms/${encodeURIComponent(normalizedRoomId)}`, { method: 'PUT', token: currentSession.token, body: { expectedUpdatedAt, name, address } });
    if (!data?.room || data.room.id !== normalizedRoomId || typeof data.room.updatedAt !== 'string') throw identityError('DESKTOP_CLOUD_ROOM_RESPONSE_INVALID');
    return data.room;
  }

  async function deleteCloudRoom({ baseUrl, currentSession, roomId, expectedUpdatedAt } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    const normalizedRoomId = String(roomId || '').trim();
    if (!normalizedRoomId) throw identityError('DESKTOP_CLOUD_ROOM_ID_REQUIRED');
    const data = await request(fetchImpl, baseUrl, `/api/business/rooms/${encodeURIComponent(normalizedRoomId)}`, { method: 'DELETE', token: currentSession.token, body: { expectedUpdatedAt } });
    if (!data?.room || data.room.id !== normalizedRoomId || typeof data.room.updatedAt !== 'string') throw identityError('DESKTOP_CLOUD_ROOM_RESPONSE_INVALID');
    return data.room;
  }

  async function createCloudCourse({ baseUrl, currentSession, courseId, ...data } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    const normalizedCourseId = String(courseId || '').trim();
    if (!normalizedCourseId) throw identityError('DESKTOP_CLOUD_COURSE_ID_REQUIRED');
    const result = await request(fetchImpl, baseUrl, '/api/business/courses', { method: 'POST', token: currentSession.token, body: { courseId: normalizedCourseId, data } });
    if (!result?.course || result.course.id !== normalizedCourseId || typeof result.course.updatedAt !== 'string') throw identityError('DESKTOP_CLOUD_COURSE_RESPONSE_INVALID');
    return result.course;
  }

  async function updateCloudCourse({ baseUrl, currentSession, courseId, expectedUpdatedAt, ...data } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    const normalizedCourseId = String(courseId || '').trim();
    if (!normalizedCourseId) throw identityError('DESKTOP_CLOUD_COURSE_ID_REQUIRED');
    const result = await request(fetchImpl, baseUrl, `/api/business/courses/${encodeURIComponent(normalizedCourseId)}`, { method: 'PUT', token: currentSession.token, body: { expectedUpdatedAt, ...data } });
    if (!result?.course || result.course.id !== normalizedCourseId || typeof result.course.updatedAt !== 'string') throw identityError('DESKTOP_CLOUD_COURSE_RESPONSE_INVALID');
    return result.course;
  }

  async function deleteCloudCourse({ baseUrl, currentSession, courseId, expectedUpdatedAt } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    const normalizedCourseId = String(courseId || '').trim();
    if (!normalizedCourseId) throw identityError('DESKTOP_CLOUD_COURSE_ID_REQUIRED');
    const result = await request(fetchImpl, baseUrl, `/api/business/courses/${encodeURIComponent(normalizedCourseId)}`, { method: 'DELETE', token: currentSession.token, body: { expectedUpdatedAt } });
    if (!result?.course || result.course.id !== normalizedCourseId || typeof result.course.updatedAt !== 'string') throw identityError('DESKTOP_CLOUD_COURSE_RESPONSE_INVALID');
    return result.course;
  }

  async function updateCloudStudentRecord({
    baseUrl, currentSession, studentId, expectedUpdatedAt, name, school, gradeYear, gradeCurrent,
    institutionId, parentName, notes, sourceType, studentSource, contacts,
  } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) {
      throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    }
    const normalizedStudentId = String(studentId || '').trim();
    if (!normalizedStudentId || !Array.isArray(contacts)) throw identityError('DESKTOP_CLOUD_STUDENT_RECORD_INPUT_INVALID');
    const data = await request(fetchImpl, baseUrl, `/api/business/students/${encodeURIComponent(normalizedStudentId)}/record`, {
      method: 'PUT',
      token: currentSession.token,
      body: { expectedUpdatedAt, name, school, gradeYear, gradeCurrent, institutionId, parentName, notes, sourceType, studentSource, contacts },
    });
    if (!data?.student || typeof data.student !== 'object'
      || data.student.id !== normalizedStudentId || typeof data.student.updatedAt !== 'string') {
      throw identityError('DESKTOP_CLOUD_STUDENT_RESPONSE_INVALID');
    }
    return data.student;
  }

  async function createCloudStudentRecord({
    baseUrl, currentSession, studentId, name, school, gradeYear, gradeCurrent,
    institutionId, parentName, notes, sourceType, studentSource, contacts,
  } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) {
      throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    }
    const normalizedStudentId = String(studentId || '').trim();
    if (!normalizedStudentId || !Array.isArray(contacts)) throw identityError('DESKTOP_CLOUD_STUDENT_RECORD_INPUT_INVALID');
    const data = await request(fetchImpl, baseUrl, '/api/business/students', {
      method: 'POST',
      token: currentSession.token,
      body: { studentId: normalizedStudentId, name, school, gradeYear, gradeCurrent, institutionId, parentName, notes, sourceType, studentSource, contacts },
    });
    if (!data?.student || data.student.id !== normalizedStudentId || typeof data.student.updatedAt !== 'string') {
      throw identityError('DESKTOP_CLOUD_STUDENT_RESPONSE_INVALID');
    }
    return data.student;
  }

  async function deleteCloudStudent({ baseUrl, currentSession, studentId, expectedUpdatedAt } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) {
      throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    }
    const normalizedStudentId = String(studentId || '').trim();
    if (!normalizedStudentId) throw identityError('DESKTOP_CLOUD_STUDENT_ID_REQUIRED');
    const data = await request(fetchImpl, baseUrl, `/api/business/students/${encodeURIComponent(normalizedStudentId)}`, {
      method: 'DELETE',
      token: currentSession.token,
      body: { expectedUpdatedAt },
    });
    if (!data?.student || data.student.id !== normalizedStudentId || typeof data.student.updatedAt !== 'string') {
      throw identityError('DESKTOP_CLOUD_STUDENT_RESPONSE_INVALID');
    }
    return data.student;
  }

  async function updateCloudScheduleStudentOverride({
    baseUrl, currentSession, scheduleId, studentId, expectedUpdatedAt, attendanceStatus, tuition, teacherFee,
  } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) {
      throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    }
    const normalizedScheduleId = String(scheduleId || '').trim();
    const normalizedStudentId = String(studentId || '').trim();
    if (!normalizedScheduleId || !normalizedStudentId) throw identityError('DESKTOP_CLOUD_SCHEDULE_ID_REQUIRED');
    const data = await request(
      fetchImpl,
      baseUrl,
      `/api/business/schedules/${encodeURIComponent(normalizedScheduleId)}/students/${encodeURIComponent(normalizedStudentId)}`,
      {
        method: 'PUT',
        token: currentSession.token,
        body: { expectedUpdatedAt, attendanceStatus, tuition, teacherFee },
      },
    );
    if (!data?.schedule || typeof data.schedule !== 'object'
      || typeof data.schedule.id !== 'string' || typeof data.schedule.updatedAt !== 'string') {
      throw identityError('DESKTOP_CLOUD_SCHEDULE_RESPONSE_INVALID');
    }
    return data.schedule;
  }

  async function upsertCloudStudentContact({
    baseUrl, currentSession, studentId, contactSlot, expectedUpdatedAt, relationship, phone, wechat,
  } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) {
      throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    }
    const normalizedStudentId = String(studentId || '').trim();
    if (!normalizedStudentId || !Number.isInteger(contactSlot) || contactSlot < 1 || contactSlot > 3) {
      throw identityError('DESKTOP_CLOUD_STUDENT_CONTACT_INPUT_INVALID');
    }
    const data = await request(
      fetchImpl,
      baseUrl,
      `/api/business/students/${encodeURIComponent(normalizedStudentId)}/contacts/${contactSlot}`,
      {
        method: 'PUT',
        token: currentSession.token,
        body: { expectedUpdatedAt, relationship, phone, wechat },
      },
    );
    const contact = data?.contact;
    if (!contact || typeof contact !== 'object' || typeof contact.id !== 'string' || contact.studentId !== normalizedStudentId
      || contact.slot !== contactSlot || !['student', 'guardian'].includes(contact.relationship)
      || !(contact.phone === null || typeof contact.phone === 'string') || !(contact.wechat === null || typeof contact.wechat === 'string')
      || contact.status !== 'active' || typeof contact.updatedAt !== 'string') {
      throw identityError('DESKTOP_CLOUD_STUDENT_CONTACT_RESPONSE_INVALID');
    }
    return contact;
  }

  async function mutateCloudSupplementalRecord({ baseUrl, currentSession, resource, responseKey, idKey, recordId, method, body }) {
    if (!currentSession || currentSession.offline || !currentSession.token) throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    const normalizedId = String(recordId || '').trim();
    if (!normalizedId) throw identityError('DESKTOP_CLOUD_SUPPLEMENTAL_ID_REQUIRED');
    const create = method === 'POST';
    const data = await request(fetchImpl, baseUrl, create ? `/api/business/${resource}` : `/api/business/${resource}/${encodeURIComponent(normalizedId)}`, {
      method, token: currentSession.token, body: create ? { [idKey]: normalizedId, data: body } : body,
    });
    if (!data?.[responseKey] || data[responseKey].id !== normalizedId || typeof data[responseKey].updatedAt !== 'string') {
      throw identityError('DESKTOP_CLOUD_SUPPLEMENTAL_RESPONSE_INVALID');
    }
    return data[responseKey];
  }

  const supplemental = (resource, responseKey, idKey, fields) => Object.freeze({
    create: input => mutateCloudSupplementalRecord({ ...input, resource, responseKey, idKey, recordId: input?.[idKey], method: 'POST', body: Object.fromEntries(fields.map(field => [field, input?.[field]])) }),
    update: input => mutateCloudSupplementalRecord({ ...input, resource, responseKey, idKey, recordId: input?.[idKey], method: 'PUT', body: { expectedUpdatedAt: input?.expectedUpdatedAt, ...Object.fromEntries(fields.map(field => [field, input?.[field]])) } }),
    remove: input => mutateCloudSupplementalRecord({ ...input, resource, responseKey, idKey, recordId: input?.[idKey], method: 'DELETE', body: { expectedUpdatedAt: input?.expectedUpdatedAt } }),
  });
  const paymentMutations = supplemental('payments', 'payment', 'paymentId', ['studentId', 'amount', 'paymentType', 'paymentDate', 'paymentMethod', 'notes']);
  const consumptionMutations = supplemental('consumptions', 'consumption', 'consumptionId', ['scheduleId', 'studentId', 'hours', 'amount', 'consumptionDate', 'notes']);
  const gradeMutations = supplemental('grades', 'grade', 'gradeId', ['studentId', 'subject', 'score', 'examDate', 'notes']);
  const assetCategoryMutations = supplemental('personal-asset-categories', 'category', 'categoryId', ['name', 'type', 'color']);
  const assetRecordMutations = supplemental('personal-asset-records', 'record', 'recordId', ['date', 'type', 'categoryId', 'categoryName', 'amount', 'studentId', 'studentName', 'note']);

  async function registerUnifiedDesktopOnline(requestValue) {
    if (!onlineRegistrationCommand
      || typeof onlineRegistrationCommand.execute !== 'function') {
      throw identityError('VNEXT_UNIFIED_DESKTOP_REGISTRATION_UNAVAILABLE');
    }
    return onlineRegistrationCommand.execute(requestValue);
  }

  return Object.freeze({
    beginPasswordEnrollment,
    beginPasswordVerification,
    beginUnifiedOnlineRegistration,
    createCloudCourse,
    createCloudInstitution,
    createCloudPayment: paymentMutations.create,
    createCloudConsumption: consumptionMutations.create,
    createCloudGrade: gradeMutations.create,
    createCloudPersonalAssetCategory: assetCategoryMutations.create,
    createCloudPersonalAssetRecord: assetRecordMutations.create,
    createCloudSchedule,
    createCloudSchool,
    createCloudRoom,
    createCloudTeacher,
    createCloudStudentRecord,
    deleteCloudTeacher,
    deleteCloudStudent,
    deleteCloudCourse,
    deleteCloudRoom,
    deleteCloudInstitution,
    deleteCloudPayment: paymentMutations.remove,
    deleteCloudConsumption: consumptionMutations.remove,
    deleteCloudGrade: gradeMutations.remove,
    deleteCloudPersonalAssetCategory: assetCategoryMutations.remove,
    deleteCloudPersonalAssetRecord: assetRecordMutations.remove,
    deleteCloudSchedule,
    deleteCloudSchool,
    completeUnifiedOnlineRegistration,
    ensureOnlineSession,
    enrollPasswordForVerifiedRegistration,
    registerTeacherForVerifiedRegistration,
    listCloudBusinessProjection,
    readCloudQuestionAsset,
    listCloudQuestions,
    listCloudSchedules,
    lock,
    pollUnifiedOnlineRegistration,
    registerUnifiedDesktopOnline,
    status: () => desktopIdentity.status(),
    switchRole,
    upsertCloudStudentContact,
    updateCloudSchedule,
    updateCloudCourse,
    updateCloudInstitution,
    updateCloudPayment: paymentMutations.update,
    updateCloudConsumption: consumptionMutations.update,
    updateCloudGrade: gradeMutations.update,
    updateCloudPersonalAssetCategory: assetCategoryMutations.update,
    updateCloudPersonalAssetRecord: assetRecordMutations.update,
    updateCloudRoom,
    updateCloudSchool,
    updateCloudTeacher,
    updateCloudStudent,
    updateCloudStudentRecord,
    updateCloudScheduleStudentOverride,
    resume,
  });
}
