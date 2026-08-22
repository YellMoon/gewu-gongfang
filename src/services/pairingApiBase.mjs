export function resolvePairingApiBase(config={},location=globalThis.location){const raw=config.cloudBaseUrl||((location?.protocol==='http:'||location?.protocol==='https:')?location.origin:'');if(!raw){const e=new Error('PAIRING_API_BASE_REQUIRED');e.code='PAIRING_API_BASE_REQUIRED';throw e;}return String(raw).replace(/\/+$/,'').replace(/\/api$/,'');}

function onlineSessionError() {
  const error = new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
  error.code = 'ONLINE_DESKTOP_SESSION_REQUIRED';
  return error;
}

export function resolveOnlineSyncActor(session, options = {}) {
  const context = session?.authContext || {};
  const nowValue = options.now ?? Date.now();
  const now = nowValue instanceof Date ? nowValue.getTime() : new Date(nowValue).getTime();
  const expiresAt = Date.parse(String(session?.expiresAt || ''));
  const authVersion = Number(context.authVersion);
  const credentialVersion = Number(context.credentialVersion);
  if (!session || session.offline === true
    || !String(session.authorization || '').startsWith('Bearer ')
    || !context.userId || !context.deviceId || !context.activeRole || !context.sessionId
    || !Number.isSafeInteger(authVersion) || authVersion < 1
    || !Number.isSafeInteger(credentialVersion) || credentialVersion < 1
    || !Number.isFinite(now) || !Number.isFinite(expiresAt) || expiresAt <= now
    || (context.activeRole === 'teacher' && !context.teacherId)) {
    throw onlineSessionError();
  }
  return session;
}

export async function resolveRenewableOnlineSyncActor({
  readSession,
  ensureOnline,
  now = Date.now(),
} = {}) {
  if (typeof readSession !== 'function') throw onlineSessionError();
  try {
    return resolveOnlineSyncActor(readSession(), { now });
  } catch (error) {
    // The desktop authorization session is deliberately process-memory only.
    // After an app restart, its reader reports an absent authorization context
    // before it can report an expired online session. Both cases must renew
    // through the unlocked device's challenge flow.
    if (!['ONLINE_DESKTOP_SESSION_REQUIRED', 'AUTHORIZATION_CONTEXT_REQUIRED'].includes(error?.code)
      || typeof ensureOnline !== 'function') {
      throw error;
    }
  }
  await ensureOnline();
  return resolveOnlineSyncActor(readSession(), { now });
}
