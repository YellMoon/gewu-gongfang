import {
  clearDesktopAuthorizationSession,
  saveDesktopAuthorizationSession,
} from './desktopAuthorizationSession.mjs';

export const OFFLINE_LEASE_MAX_MS = 72 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 30 * 1000;
const PRIVILEGED_ROLES = new Set(['super_admin', 'admin']);

function identityError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function normalizedBaseUrl(value) {
  const baseUrl = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) throw identityError('DESKTOP_IDENTITY_BASE_URL_REQUIRED');
  return baseUrl;
}

function dateValue(value) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function uniqueRoles(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(role => String(role || '').trim()).filter(Boolean))]
    : [];
}

export function preferredActiveRole(eligibleRoles, requestedRole) {
  const roles = uniqueRoles(eligibleRoles);
  if (requestedRole && roles.includes(requestedRole)) return requestedRole;
  if (roles.includes('teacher')) return 'teacher';
  if (roles.includes('student')) return 'student';
  if (roles.includes('parent')) return 'parent';
  return roles[0] || null;
}

export function partitionKeyForIdentity(identity = {}) {
  const userId = String(identity.userId || identity.id || '').trim();
  const activeRole = String(identity.activeRole || identity.active_role || '').trim();
  if (!userId || !activeRole) throw identityError('DESKTOP_IDENTITY_PARTITION_INVALID');
  let subjectId = 'all';
  if (activeRole === 'teacher') subjectId = String(identity.teacherId || identity.teacher_id || '').trim();
  if (activeRole === 'student' || activeRole === 'parent') {
    subjectId = String(identity.studentId || identity.student_id || '').trim();
  }
  if (!subjectId) throw identityError('DESKTOP_IDENTITY_PARTITION_INVALID');
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
  return {
    userId,
    user: {
      id: userId,
      name: String(identity.name || identity.user_name || fallback.user?.name || '').trim(),
    },
    eligibleRoles,
    activeRole,
    teacherId: identity.teacher_id ?? identity.teacherId ?? fallback.teacherId ?? session.teacherId ?? null,
    studentId: identity.student_id ?? identity.studentId ?? fallback.studentId ?? session.studentId ?? null,
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
  if ((lease.activeRole === 'student' || lease.activeRole === 'parent')
    && String(lease.studentId || '') !== String(vaultStatus.studentId || '')) return null;
  return lease;
}

function sessionMatchesVault(sessionValue, vaultStatus, now) {
  if (!sessionValue || typeof sessionValue !== 'object') return false;
  const session = sessionValue.session || {};
  const profile = sessionValue.profile || vaultStatus;
  const expiresAt = dateValue(sessionValue.expiresAt || session.expiresAt);
  return expiresAt !== null
    && expiresAt > now.getTime()
    && String(session.userId || profile.userId || profile.user?.id || '') === String(vaultStatus.user?.id || '')
    && String(session.deviceId || profile.deviceId || '') === String(vaultStatus.deviceId || '')
    && uniqueRoles(session.eligibleRoles || profile.eligibleRoles).includes(session.activeRole || profile.activeRole);
}

function unlockedState(kind, identity) {
  const activeRole = identity.activeRole || identity.active_role;
  const normalized = {
    userId: identity.userId || identity.id || identity.user?.id,
    activeRole,
    teacherId: identity.teacherId ?? identity.teacher_id ?? null,
    studentId: identity.studentId ?? identity.student_id ?? null,
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
  return gateState?.kind === 'online-unlocked' || gateState?.kind === 'offline-unlocked';
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
    || ['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ETIMEDOUT', 'EAI_AGAIN'].includes(causeCode);
}

export function registrationViewForChallenge(challenge = {}) {
  const map = {
    pending_phone: 'phone-verification-required',
    identity_verified_pending_approval: 'approval-pending',
    approved_pending_exchange: 'password-setup-required',
    rejected: 'registration-rejected',
    expired: 'registration-expired',
    cancelled: 'registration-rejected',
    conflict: 'registration-rejected',
    exchanged: 'registration-complete',
  };
  return { kind: map[challenge.status] || 'registration-pending', challenge };
}

async function responseData(response) {
  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    throw identityError('DESKTOP_IDENTITY_RESPONSE_INVALID', cause);
  }
  if (!response.ok || payload?.success !== true) {
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
} = {}) {
  if (!desktopIdentity || typeof desktopIdentity.status !== 'function') {
    throw identityError('DESKTOP_IDENTITY_BRIDGE_REQUIRED');
  }
  if (typeof fetchImpl !== 'function') throw identityError('DESKTOP_IDENTITY_FETCH_REQUIRED');

  function currentDate() {
    const current = now();
    const date = current instanceof Date ? new Date(current) : new Date(current);
    if (!Number.isFinite(date.getTime())) throw identityError('DESKTOP_IDENTITY_CLOCK_INVALID');
    return date;
  }

  async function beginRegistration({ baseUrl, deviceName, deviceKind = 'desktop-client' } = {}) {
    const normalizedUrl = normalizedBaseUrl(baseUrl);
    const publicIdentity = await desktopIdentity.beginRegistration({ deviceName, deviceKind });
    const data = await request(fetchImpl, normalizedUrl, '/api/desktop-identity/challenges/start', {
      method: 'POST',
      body: {
        deviceId: publicIdentity.deviceId,
        deviceName: publicIdentity.deviceName,
        publicKey: publicIdentity.publicKey,
        keyFingerprint: publicIdentity.keyFingerprint,
        purpose: 'register',
      },
    });
    const challenge = data.challenge;
    if (!challenge?.id || !challenge.challengeSecret) {
      throw identityError('DESKTOP_REGISTRATION_CHALLENGE_INVALID');
    }
    return {
      baseUrl: normalizedUrl,
      publicIdentity,
      challenge,
      challengeSecret: challenge.challengeSecret,
      qrValue: challenge.qrValue || null,
    };
  }

  async function beginPasswordReset({ baseUrl } = {}) {
    const normalizedUrl = normalizedBaseUrl(baseUrl);
    if (typeof desktopIdentity.beginPasswordReset !== 'function') {
      throw identityError('DESKTOP_IDENTITY_PASSWORD_RESET_UNAVAILABLE');
    }
    const publicIdentity = await desktopIdentity.beginPasswordReset();
    const data = await request(fetchImpl, normalizedUrl, '/api/desktop-identity/challenges/start', {
      method: 'POST',
      body: {
        deviceId: publicIdentity.deviceId,
        deviceName: publicIdentity.deviceName,
        publicKey: publicIdentity.publicKey,
        keyFingerprint: publicIdentity.keyFingerprint,
        purpose: 'password_reset',
      },
    });
    const challenge = { ...data.challenge, purpose: 'password_reset' };
    if (!challenge?.id || !challenge.challengeSecret) {
      throw identityError('DESKTOP_PASSWORD_RESET_CHALLENGE_INVALID');
    }
    return {
      baseUrl: normalizedUrl,
      publicIdentity,
      challenge,
      challengeSecret: challenge.challengeSecret,
      qrValue: challenge.qrValue || null,
    };
  }

  async function pollRegistration(pending) {
    if (!pending?.challenge?.id || !pending?.challengeSecret) {
      throw identityError('DESKTOP_REGISTRATION_CONTEXT_REQUIRED');
    }
    const data = await request(
      fetchImpl,
      pending.baseUrl,
      `/api/desktop-identity/challenges/${encodeURIComponent(pending.challenge.id)}`
    );
    return {
      ...pending,
      challenge: data.challenge,
      qrValue: data.challenge?.qrValue || pending.qrValue || null,
    };
  }

  async function completeRegistration({ pending, password } = {}) {
    if (pending?.challenge?.status !== 'approved_pending_exchange') {
      throw identityError('DESKTOP_REGISTRATION_NOT_APPROVED');
    }
    const proof = await desktopIdentity.signChallenge({
      purpose: 'exchange',
      challengeId: pending.challenge.id,
      challengeSecret: pending.challengeSecret,
      rowVersion: pending.challenge.rowVersion,
    });
    const exchanged = await request(
      fetchImpl,
      pending.baseUrl,
      `/api/desktop-identity/challenges/${encodeURIComponent(pending.challenge.id)}/exchange`,
      {
        method: 'POST',
        body: {
          challengeSecret: pending.challengeSecret,
          signature: proof.signature,
          expectedRowVersion: pending.challenge.rowVersion,
        },
      }
    );
    if (!exchanged.profile) throw identityError('DESKTOP_SESSION_PROFILE_REQUIRED');
    const profile = profileFrom({
      identity: exchanged.profile,
      authorization: exchanged.authorization,
      session: exchanged.session,
      fallback: exchanged.profile,
    });
    const lease = exchanged.offlineLease;
    if (!lease) throw identityError('DESKTOP_OFFLINE_LEASE_REQUIRED');
    const passwordReset = pending.challenge.purpose === 'password_reset';
    const commitVault = passwordReset
      ? desktopIdentity.completePasswordReset?.bind(desktopIdentity)
      : desktopIdentity.completeRegistration?.bind(desktopIdentity);
    if (typeof commitVault !== 'function') {
      throw identityError(passwordReset
        ? 'DESKTOP_IDENTITY_PASSWORD_RESET_UNAVAILABLE'
        : 'DESKTOP_IDENTITY_REGISTRATION_UNAVAILABLE');
    }
    const vaultStatus = await commitVault({
      password,
      authorization: exchanged.authorization,
      profile,
      offlineLease: lease,
      sessionToken: exchanged.token,
    });
    const stored = onlineSessionValue({ token: exchanged.token, session: exchanged.session, profile });
    await sessionStore.save(stored);
    return {
      ...stored,
      vaultStatus,
      gateState: resolveDesktopGateState({
        vaultStatus,
        online: true,
        onlineSession: stored,
        now: currentDate(),
      }),
    };
  }

  async function unlock({ baseUrl, password, online = true } = {}) {
    const vaultStatus = await desktopIdentity.unlock({ password });
    if (!online) {
      await sessionStore.clear();
      return {
        offline: true,
        vaultStatus,
        gateState: resolveDesktopGateState({ vaultStatus, online: false, now: currentDate() }),
      };
    }
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
    const exchanged = await request(
      fetchImpl,
      baseUrl,
      `/api/desktop-identity/session/challenges/${encodeURIComponent(challenge.id)}/exchange`,
      {
        method: 'POST',
        body: { signature: proof.signature, expectedRowVersion: challenge.rowVersion },
      }
    );
    if (!exchanged.profile) throw identityError('DESKTOP_SESSION_PROFILE_REQUIRED');
    const profile = profileFrom({
      identity: exchanged.profile,
      session: exchanged.session,
      authorization: {
        id: vaultStatus.authorizationId,
        userId: vaultStatus.user?.id,
      },
      fallback: exchanged.profile || vaultStatus,
    });
    const stored = onlineSessionValue({ token: exchanged.token, session: exchanged.session, profile });
    if (!exchanged.offlineLease) throw identityError('DESKTOP_OFFLINE_LEASE_REQUIRED');
    if (!desktopIdentity.refreshOfflineLease) {
      throw identityError('DESKTOP_IDENTITY_OFFLINE_LEASE_REFRESH_UNAVAILABLE');
    }
    await desktopIdentity.refreshOfflineLease({
      password,
      offlineLease: exchanged.offlineLease,
    });
    await sessionStore.save(stored);
    return {
      ...stored,
      vaultStatus,
      gateState: resolveDesktopGateState({
        vaultStatus,
        online: true,
        onlineSession: stored,
        now: currentDate(),
      }),
    };
  }

  async function switchRole({ baseUrl, currentSession, activeRole, password } = {}) {
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
      if (!password) throw identityError('DESKTOP_IDENTITY_LOCAL_PASSWORD_REQUIRED');
      await desktopIdentity.unlock({ password });
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
      session: exchanged.session,
      fallback: currentSession.profile,
    });
    const stored = onlineSessionValue({ token: exchanged.token, session: exchanged.session, profile });
    await sessionStore.save(stored);
    return stored;
  }

  async function lock() {
    await sessionStore.clear();
    return desktopIdentity.lock();
  }

  return Object.freeze({
    beginPasswordReset,
    beginRegistration,
    completeRegistration,
    lock,
    pollRegistration,
    status: () => desktopIdentity.status(),
    switchRole,
    unlock,
  });
}
