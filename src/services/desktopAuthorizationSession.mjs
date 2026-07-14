const SESSION_KEY = 'gewu_desktop_authorization_session';
const PENDING_KEY = 'gewu_desktop_pairing_pending';
let cachedCredential = null;

function authError(code = 'AUTHORIZATION_CONTEXT_REQUIRED') {
  const error = new Error(code); error.code = code; return error;
}
function sessionFrom(value) {
  const token = value?.token || value?.accessToken;
  const userId = value?.user?.id || value?.userId;
  const deviceId = value?.deviceId;
  if (!token || !userId || !deviceId) throw authError();
  return { authorization: `Bearer ${token}`, authContext: { userId, deviceId }, user: value.user || { id: userId } };
}
function apiOf(deps = {}) { return deps.api || globalThis.window?.api; }

export function readDesktopAuthorizationSession(storage = globalThis.sessionStorage) {
  if (cachedCredential) return sessionFrom(cachedCredential);
  let value;
  try { value = JSON.parse(storage?.getItem?.(SESSION_KEY) || 'null'); } catch (_error) { throw authError(); }
  return sessionFrom(value);
}
export async function hydrateDesktopAuthorizationSession(deps = {}) {
  const api = apiOf(deps);
  const storage = deps.storage || globalThis.sessionStorage;
  if (api?.invoke) {
    const persisted = await api.invoke('desktop-auth:get');
    if (persisted) { cachedCredential = persisted; storage?.removeItem?.(SESSION_KEY); return sessionFrom(persisted); }
  }
  let legacy = null;
  try { legacy = JSON.parse(storage?.getItem?.(SESSION_KEY) || 'null'); } catch (_error) { legacy = null; }
  if (legacy && api?.invoke) {
    await api.invoke('desktop-auth:set', legacy);
    storage.removeItem(SESSION_KEY);
    cachedCredential = legacy;
    return sessionFrom(legacy);
  }
  if (legacy) { cachedCredential = legacy; return sessionFrom(legacy); }
  throw authError();
}
export const desktopAuthorizationSessionKey = SESSION_KEY;
export async function saveDesktopAuthorizationSession(value, deps = {}) {
  sessionFrom(value);
  const api = apiOf(deps);
  if (api?.invoke) await api.invoke('desktop-auth:set', value);
  else (deps.storage || globalThis.sessionStorage)?.setItem?.(SESSION_KEY, JSON.stringify(value));
  cachedCredential = value;
  return sessionFrom(value);
}
export async function clearDesktopAuthorizationSession(deps = {}) {
  cachedCredential = null;
  const storage = deps.storage || globalThis.sessionStorage;
  storage?.removeItem?.(SESSION_KEY); storage?.removeItem?.(PENDING_KEY);
  const api = apiOf(deps); if (api?.invoke) await api.invoke('desktop-auth:clear');
}
function randomSecret(){const bytes=new Uint8Array(32);globalThis.crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
export async function startPairing({baseUrl,deviceId,deviceName},deps={}){
  const fetchImpl=deps.fetchImpl||fetch,storage=deps.storage||globalThis.sessionStorage,secret=randomSecret();
  const res=await fetchImpl(`${String(baseUrl).replace(/\/$/,'')}/api/desktop-pairing/start`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId,deviceName,secret})});
  const data=await res.json();if(!res.ok||!data.success)throw Object.assign(new Error(data.code||'PAIRING_START_FAILED'),{code:data.code});
  const pending={...data.pairing,secret,baseUrl,deviceId};storage.setItem(PENDING_KEY,JSON.stringify(pending));return pending;
}
export async function pollOrExchange(deps={}){
  const fetchImpl=deps.fetchImpl||fetch,storage=deps.storage||globalThis.sessionStorage,pending=JSON.parse(storage.getItem(PENDING_KEY)||'null');if(!pending)throw authError();
  const res=await fetchImpl(`${String(pending.baseUrl).replace(/\/$/,'')}/api/desktop-pairing/exchange`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:pending.id,secret:pending.secret})});
  const data=await res.json();if(!res.ok||!data.success)throw Object.assign(new Error(data.code||'PAIRING_NOT_APPROVED'),{code:data.code});
  await saveDesktopAuthorizationSession({token:data.token,userId:data.userId,deviceId:data.deviceId,user:data.user},{storage,api:apiOf(deps)});storage.removeItem(PENDING_KEY);return data;
}
