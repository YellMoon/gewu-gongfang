import {
  clearDesktopAuthorizationSession,
  saveDesktopAuthorizationSession,
} from './desktopAuthorizationSession.mjs';

export const OFFLINE_LEASE_MAX_MS = 14 * 24 * 60 * 60 * 1000;
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
  if (activeRole === 'teacher') {
    subjectId = String(identity.teacherId || identity.teacher_id || '').trim() || 'unbound';
  }
  if (activeRole === 'student' || activeRole === 'parent') {
    subjectId = String(identity.studentId || identity.student_id || '').trim() || 'unbound';
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
      'TARGET_HOST_REQUIRED',
      'TARGET_HOST_NOT_FOUND',
    ].includes(causeCode);
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

  async function beginRegistration({ baseUrl, deviceName, deviceKind = 'desktop-client' } = {}) {
    const normalizedUrl = normalizedBaseUrl(baseUrl);
    const publicIdentity = await desktopIdentity.beginRegistration({ deviceName, deviceKind });
    const data = await request(fetchImpl, normalizedUrl, '/api/desktop-identity/challenges/start', {
      method: 'POST',
      body: {
        deviceId: publicIdentity.deviceId,
        deviceName: publicIdentity.deviceName,
        deviceKind,
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
      qrImageDataUrl: challenge.qrImageDataUrl || null,
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
        deviceKind: publicIdentity.deviceKind,
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
      qrImageDataUrl: challenge.qrImageDataUrl || null,
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
      qrImageDataUrl: data.challenge?.qrImageDataUrl || pending.qrImageDataUrl || null,
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
    const passwordReset = pending.challenge.purpose === 'password_reset';
    const bootstrapHostEnrollment = !passwordReset
      && pending?.bootstrapHostEnrollment === true
      && pending?.publicIdentity?.deviceKind === 'primary-host';
    if (!passwordReset && !bootstrapHostEnrollment) {
      const activation = await request(
        fetchImpl,
        pending.baseUrl,
        `/api/desktop-identity/challenges/${encodeURIComponent(pending.challenge.id)}/activation/exchange`,
        {
          method: 'POST',
          body: {
            challengeSecret: pending.challengeSecret,
            signature: proof.signature,
            expectedRowVersion: pending.challenge.rowVersion,
          },
        }
      );
      const activationId = String(activation?.activation?.id || '').trim();
      const packageHash = String(activation?.activation?.packageHash || '').trim();
      const pendingPackage = activation?.activationPackage;
      const authorityContext = pendingPackage && {
        userId: pendingPackage.userId,
        deviceId: pendingPackage.deviceId,
        authorityId: pendingPackage.authorityId,
        hostEpochId: pendingPackage.hostEpochId,
        hostGeneration: pendingPackage.hostGeneration,
        hostPublicKey: pendingPackage.hostPublicKey,
        grant: pendingPackage.grant,
        lease: pendingPackage.lease,
      };
      if (!activationId || !packageHash || !pendingPackage?.authorization || !pendingPackage?.profile
        || !authorityContext?.userId || !authorityContext?.deviceId
        || !authorityContext?.authorityId || !authorityContext?.hostEpochId
        || !authorityContext?.hostGeneration || !authorityContext?.hostPublicKey
        || !authorityContext?.grant?.id
        || !authorityContext?.grant?.version || !authorityContext?.lease?.id
        || !authorityContext?.lease?.activeRole || !authorityContext?.lease?.issuedAt
        || !authorityContext?.lease?.expiresAt) {
        throw identityError('DESKTOP_ACTIVATION_PACKAGE_INVALID');
      }
      const profile = profileFrom({
        identity: pendingPackage.profile,
        authorization: pendingPackage.authorization,
        fallback: pendingPackage.profile,
      });
      if (typeof desktopIdentity.completeRegistration !== 'function'
        || typeof desktopIdentity.refreshOfflineLease !== 'function') {
        throw identityError('DESKTOP_IDENTITY_REGISTRATION_UNAVAILABLE');
      }
      await desktopIdentity.completeRegistration({
        password,
        authorization: pendingPackage.authorization,
        profile,
        offlineLease: null,
        authorityContext,
      });
      const activationProof = await desktopIdentity.signChallenge({
        purpose: 'activation-finalize', activationId, packageHash,
      });
      const finalized = await request(
        fetchImpl,
        pending.baseUrl,
        `/api/desktop-identity/activations/${encodeURIComponent(activationId)}/finalize`,
        { method: 'POST', body: { signature: activationProof.signature } }
      );
      if (!finalized.token || !finalized.session || !finalized.offlineLease || !finalized.profile) {
        throw identityError('DESKTOP_ACTIVATION_FINALIZE_INVALID');
      }
      const vaultStatus = await desktopIdentity.refreshOfflineLease({
        password,
        authorization: finalized.authorization,
        profile: finalized.profile,
        offlineLease: finalized.offlineLease,
      });
      activePassword = password;
      const stored = onlineSessionValue({ token: finalized.token, session: finalized.session, profile: finalized.profile });
      await sessionStore.save(stored);
      return {
        ...stored,
        vaultStatus,
        gateState: resolveDesktopGateState({ vaultStatus, online: true, onlineSession: stored, now: currentDate() }),
      };
    }
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
    activePassword = password;
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

  async function saveIssuedSession({ issued, password, vaultStatus }) {
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
    if (!desktopIdentity.refreshOfflineLease) {
      throw identityError('DESKTOP_IDENTITY_OFFLINE_LEASE_REFRESH_UNAVAILABLE');
    }
    await desktopIdentity.refreshOfflineLease({
      password,
      offlineLease: issued.offlineLease,
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

  async function unlock({
    baseUrl,
    password,
    online = true,
  } = {}) {
    const vaultStatus = await desktopIdentity.unlock({ password });
    activePassword = password;
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
      password,
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
    if (!started?.pairingId || !started?.pairingSecret || !started?.expiresAt) {
      throw identityError('DESKTOP_UNIFIED_ONLINE_PAIRING_INVALID');
    }
    return Object.freeze({
      baseUrl: normalizedUrl,
      publicIdentity: Object.freeze({ ...publicIdentity }),
      idempotencyKey: normalizedIdempotencyKey,
      pairingId: String(started.pairingId),
      pairingSecret: String(started.pairingSecret),
      expiresAt: String(started.expiresAt),
      qrValue: `gewu://desktop-pairing?pairingId=${encodeURIComponent(started.pairingId)}&secret=${encodeURIComponent(started.pairingSecret)}`,
    });
  }

  async function beginUnifiedOnlineRecovery({ baseUrl, deviceName, idempotencyKey } = {}) {
    if (typeof desktopIdentity.beginUnifiedOnlineRecovery !== 'function') {
      throw identityError('DESKTOP_UNIFIED_ONLINE_RECOVERY_UNAVAILABLE');
    }
    const normalizedUrl = normalizedBaseUrl(baseUrl);
    const normalizedIdempotencyKey = String(idempotencyKey || '').trim();
    if (!normalizedIdempotencyKey || normalizedIdempotencyKey.length > 256) {
      throw identityError('DESKTOP_UNIFIED_ONLINE_REGISTRATION_CONTEXT_INVALID');
    }
    const publicIdentity = await desktopIdentity.beginUnifiedOnlineRecovery({ deviceName });
    const started = await request(fetchImpl, normalizedUrl, '/api/desktop/pairing/start', {
      method: 'POST',
      body: {
        installationId: publicIdentity.deviceId,
        installationPublicKey: publicIdentity.publicKey,
        idempotencyKey: normalizedIdempotencyKey,
      },
    });
    if (!started?.pairingId || !started?.pairingSecret || !started?.expiresAt) {
      throw identityError('DESKTOP_UNIFIED_ONLINE_PAIRING_INVALID');
    }
    return Object.freeze({
      baseUrl: normalizedUrl,
      publicIdentity: Object.freeze({ ...publicIdentity }),
      idempotencyKey: normalizedIdempotencyKey,
      pairingId: String(started.pairingId),
      pairingSecret: String(started.pairingSecret),
      expiresAt: String(started.expiresAt),
      recovery: true,
      qrValue: `gewu://desktop-pairing?pairingId=${encodeURIComponent(started.pairingId)}&secret=${encodeURIComponent(started.pairingSecret)}`,
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
    return Object.freeze({
      ...pending,
      status: 'verified',
      verificationToken: String(data.verificationToken),
      deviceChallenge: String(data.deviceChallenge),
    });
  }

  async function completeUnifiedOnlineRegistration({ pending, password } = {}) {
    if (!pending?.baseUrl || !pending?.publicIdentity || !pending?.idempotencyKey
      || !pending?.verificationToken || !pending?.deviceChallenge) {
      throw identityError('DESKTOP_UNIFIED_ONLINE_REGISTRATION_CONTEXT_INVALID');
    }
    const completeVault = pending.recovery === true
      ? desktopIdentity.completeUnifiedOnlineRecovery
      : desktopIdentity.completeRegistration;
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
      user: { id: context.accountId, name: 'Cloud account' },
      eligibleRoles,
      activeRole,
      teacherId: activeRole === 'teacher' ? context.teacherId : null,
      studentId: activeRole === 'student' ? context.studentId : null,
    };
    const vaultStatus = await completeVault({
      password,
      authorization,
      profile,
      offlineLease: registered.offlineLease,
    });
    activePassword = password;
    const stored = onlineSessionValue({
      token: registered.sessionToken,
      session: {
        id: context.sessionId,
        userId: context.accountId,
        deviceId: context.deviceId,
        activeRole,
        eligibleRoles,
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
    if (!activePassword) throw identityError('DESKTOP_IDENTITY_LOCAL_PASSWORD_REQUIRED');
    return unlock({
      baseUrl,
      password: activePassword,
      online: true,
    });
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
      || !['students', 'student_contacts', 'teachers', 'courses', 'schedules', 'institutions', 'schools', 'rooms'].every(key => Array.isArray(projection[key]))) {
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
    const data = await request(fetchImpl, baseUrl, `/api/desktop/question-bank/questions?limit=${limit}`, {
      token: currentSession.token,
    });
    if (!Array.isArray(data?.questions)) {
      throw identityError('DESKTOP_CLOUD_QUESTION_RESPONSE_INVALID');
    }
    return data.questions;
  }

  async function updateCloudSchedule({ baseUrl, currentSession, scheduleId, expectedUpdatedAt, startAt, endAt, status, roomDisplay, tuition, teacherFee, notes } = {}) {
    if (!currentSession || currentSession.offline || !currentSession.token) {
      throw identityError('ONLINE_DESKTOP_SESSION_REQUIRED');
    }
    const normalizedScheduleId = String(scheduleId || '').trim();
    if (!normalizedScheduleId) throw identityError('DESKTOP_CLOUD_SCHEDULE_ID_REQUIRED');
    const data = await request(fetchImpl, baseUrl, `/api/business/schedules/${encodeURIComponent(normalizedScheduleId)}`, {
      method: 'PUT',
      token: currentSession.token,
      body: { expectedUpdatedAt, startAt, endAt, status, roomDisplay, tuition, teacherFee, notes },
    });
    if (!data?.schedule || typeof data.schedule !== 'object'
      || typeof data.schedule.id !== 'string' || typeof data.schedule.updatedAt !== 'string') {
      throw identityError('DESKTOP_CLOUD_SCHEDULE_RESPONSE_INVALID');
    }
    return data.schedule;
  }

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

  async function registerUnifiedDesktopOnline(requestValue) {
    if (!onlineRegistrationCommand
      || typeof onlineRegistrationCommand.execute !== 'function') {
      throw identityError('VNEXT_UNIFIED_DESKTOP_REGISTRATION_UNAVAILABLE');
    }
    return onlineRegistrationCommand.execute(requestValue);
  }

  return Object.freeze({
    beginPasswordReset,
    beginPasswordEnrollment,
    beginPasswordVerification,
    beginRegistration,
    beginUnifiedOnlineRegistration,
    createCloudTeacher,
    createCloudStudentRecord,
    deleteCloudTeacher,
    deleteCloudStudent,
    beginUnifiedOnlineRecovery,
    completeRegistration,
    completeUnifiedOnlineRegistration,
    ensureOnlineSession,
    enrollPasswordForVerifiedRegistration,
    listCloudBusinessProjection,
    listCloudQuestions,
    listCloudSchedules,
    lock,
    pollRegistration,
    pollUnifiedOnlineRegistration,
    registerUnifiedDesktopOnline,
    status: () => desktopIdentity.status(),
    switchRole,
    upsertCloudStudentContact,
    updateCloudSchedule,
    updateCloudTeacher,
    updateCloudStudent,
    updateCloudStudentRecord,
    updateCloudScheduleStudentOverride,
    unlock,
  });
}
