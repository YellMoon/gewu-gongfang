const SESSION_KEY = 'gewu_desktop_authorization_session';
const PENDING_KEY = 'gewu_desktop_pairing_pending';

// Online desktop sessions are intentionally process-memory only. The long-lived
// device credential and offline lease live in the Electron vault instead.
let cachedSession = null;

function authError(code = 'AUTHORIZATION_CONTEXT_REQUIRED') {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function normalizeDesktopAuthorizationSession(value) {
  const token = value?.token || value?.accessToken;
  const session = value?.session || {};
  const profile = value?.profile || {};
  const user = profile?.user || value?.user || {};
  const userId = session.userId || profile.userId || user.id || value?.userId;
  const deviceId = session.deviceId || profile.deviceId || value?.deviceId;
  const activeRole = session.activeRole || profile.activeRole || value?.activeRole;
  const eligibleRoles = session.eligibleRoles || profile.eligibleRoles || value?.eligibleRoles || [];

  if (!token || !userId || !deviceId || !activeRole) throw authError();

  return {
    authorization: `Bearer ${token}`,
    authContext: {
      userId,
      deviceId,
      activeRole,
      eligibleRoles: [...eligibleRoles],
      teacherId: profile.teacherId ?? value?.teacherId ?? null,
      studentId: profile.studentId ?? value?.studentId ?? null,
      sessionId: session.id || value?.sessionId || null,
      authVersion: session.authVersion ?? profile.authVersion ?? value?.authVersion ?? null,
      credentialVersion: session.credentialVersion ?? profile.credentialVersion ?? value?.credentialVersion ?? null,
      rowVersion: session.rowVersion ?? value?.rowVersion ?? null,
    },
    expiresAt: value.expiresAt || session.expiresAt || null,
    session: { ...session },
    profile: { ...profile },
    user: user.id ? { ...user } : { id: userId },
  };
}

function removeLegacyStorage(storage) {
  storage?.removeItem?.(SESSION_KEY);
  storage?.removeItem?.(PENDING_KEY);
}

export const desktopAuthorizationSessionKey = SESSION_KEY;

export function readDesktopAuthorizationSession(_storage = globalThis.sessionStorage) {
  if (!cachedSession) throw authError();
  return normalizeDesktopAuthorizationSession(cachedSession);
}

export async function hydrateDesktopAuthorizationSession(deps = {}) {
  const storage = deps.storage || globalThis.sessionStorage;
  let legacy = null;
  try {
    legacy = storage?.getItem?.(SESSION_KEY) || null;
  } catch (_error) {
    legacy = null;
  }
  if (legacy) {
    removeLegacyStorage(storage);
    cachedSession = null;
    throw authError('DESKTOP_IDENTITY_UPGRADE_REQUIRED');
  }
  if (!cachedSession) throw authError();
  return normalizeDesktopAuthorizationSession(cachedSession);
}

export async function saveDesktopAuthorizationSession(value, _deps = {}) {
  normalizeDesktopAuthorizationSession(value);
  cachedSession = structuredClone(value);
  return normalizeDesktopAuthorizationSession(cachedSession);
}

export async function clearDesktopAuthorizationSession(deps = {}) {
  cachedSession = null;
  removeLegacyStorage(deps.storage || globalThis.sessionStorage);
  if (deps.lockVault) await deps.desktopIdentity?.lock?.();
}

// Keep named exports during the migration so old bundles fail closed if a stale
// settings page tries to call the removed V1 pairing flow.
export const startPairing = undefined;
export const pollOrExchange = undefined;
