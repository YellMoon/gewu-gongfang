const SESSION_KEY = 'gewu_desktop_authorization_session';

function authError() {
  const error = new Error('AUTHORIZATION_CONTEXT_REQUIRED'); error.code = 'AUTHORIZATION_CONTEXT_REQUIRED'; return error;
}

export function readDesktopAuthorizationSession(storage = globalThis.sessionStorage) {
  let value;
  try { value = JSON.parse(storage?.getItem?.(SESSION_KEY) || 'null'); } catch (_error) { throw authError(); }
  const token = value?.token || value?.accessToken;
  const userId = value?.user?.id || value?.userId;
  const deviceId = value?.deviceId;
  if (!token || !userId || !deviceId) throw authError();
  return { authorization: `Bearer ${token}`, authContext: { userId, deviceId } };
}

export const desktopAuthorizationSessionKey = SESSION_KEY;
