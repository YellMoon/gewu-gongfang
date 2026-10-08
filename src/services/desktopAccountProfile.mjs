function failure(code) { return Object.assign(new Error(code), { code }); }

const PROFILE_FIELDS = ['accountName', 'name', 'phone', 'subject', 'wechat'];
const DESKTOP_ROLES = ['teacher', 'super_admin'];

function profileFields(data, activeRole) {
  if (!data || !DESKTOP_ROLES.includes(activeRole) || data.activeRole !== activeRole
    || !Array.isArray(data.eligibleRoles) || !data.eligibleRoles.includes(activeRole)
    || data.eligibleRoles.length > 2 || new Set(data.eligibleRoles).size !== data.eligibleRoles.length
    || data.eligibleRoles.some(role => !DESKTOP_ROLES.includes(role))
    || PROFILE_FIELDS.some(key => data[key] !== null && (typeof data[key] !== 'string'
      || data[key].length > 256 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(data[key])))) {
    throw failure('DESKTOP_ACCOUNT_PROFILE_INVALID');
  }
  return Object.fromEntries([...PROFILE_FIELDS.map(key => [key, data[key]]),
    ['activeRole', activeRole], ['eligibleRoles', [...data.eligibleRoles]]]);
}

function cacheKey(userId, activeRole) {
  return typeof userId === 'string' && userId.trim() && DESKTOP_ROLES.includes(activeRole)
    ? `gewu_desktop_account_profile:v1:${encodeURIComponent(userId)}:${activeRole}` : null;
}

// This cache is presentation only. It never supplies identity or permissions.
export function readCachedDesktopAccountProfile({ userId, activeRole, storage = undefined } = {}) {
  try {
    const key = cacheKey(userId, activeRole);
    if (!key) return null;
    const cached = JSON.parse((storage || globalThis.localStorage)?.getItem(key) || 'null');
    if (cached?.version !== 1 || cached.userId !== userId || cached.activeRole !== activeRole) return null;
    return profileFields(cached.profile, activeRole);
  } catch { return null; }
}

export function cacheDesktopAccountProfile({ userId, activeRole, profile, storage = undefined } = {}) {
  try {
    const key = cacheKey(userId, activeRole);
    const target = storage || globalThis.localStorage;
    if (!key || !target?.setItem) return false;
    target.setItem(key, JSON.stringify({ version: 1, userId, activeRole, profile: profileFields(profile, activeRole) }));
    return true;
  } catch { return false; }
}

export async function loadDesktopAccountProfile({ baseUrl, session, signal, fetchImpl = globalThis.fetch } = {}) {
  if (!session?.authorization?.startsWith('Bearer ') || !['teacher', 'super_admin'].includes(session?.authContext?.activeRole)) {
    throw failure('AUTHORIZATION_CONTEXT_REQUIRED');
  }
  const url = new URL('/api/desktop-identity/profile', baseUrl);
  const response = await fetchImpl(url.href, {
    method: 'GET', headers: { Accept: 'application/json', Authorization: session.authorization },
    signal, cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok || result?.success !== true) throw failure(result?.code || 'DESKTOP_ACCOUNT_PROFILE_UNAVAILABLE');
  return profileFields(result.data, session.authContext.activeRole);
}
