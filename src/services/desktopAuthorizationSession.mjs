const SESSION_KEY = 'gewu_desktop_authorization_session';
const PENDING_KEY = 'gewu_desktop_pairing_pending';

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
export function saveDesktopAuthorizationSession(value, storage=globalThis.sessionStorage){storage.setItem(SESSION_KEY,JSON.stringify(value));return readDesktopAuthorizationSession(storage);}
export function clearDesktopAuthorizationSession(storage=globalThis.sessionStorage){storage.removeItem(SESSION_KEY);storage.removeItem(PENDING_KEY);}
function randomSecret(){const bytes=new Uint8Array(32);globalThis.crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
export async function startPairing({baseUrl,phone,deviceId,deviceName},deps={}){const fetchImpl=deps.fetchImpl||fetch,storage=deps.storage||globalThis.sessionStorage,secret=randomSecret();const res=await fetchImpl(`${String(baseUrl).replace(/\/$/,'')}/api/desktop-pairing/start`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,deviceId,deviceName,secret})});const data=await res.json();if(!res.ok||!data.success)throw Object.assign(new Error(data.code||'PAIRING_START_FAILED'),{code:data.code});const pending={...data.pairing,secret,baseUrl,deviceId};storage.setItem(PENDING_KEY,JSON.stringify(pending));return pending;}
export async function pollOrExchange(deps={}){const fetchImpl=deps.fetchImpl||fetch,storage=deps.storage||globalThis.sessionStorage,pending=JSON.parse(storage.getItem(PENDING_KEY)||'null');if(!pending)throw authError();const res=await fetchImpl(`${String(pending.baseUrl).replace(/\/$/,'')}/api/desktop-pairing/exchange`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:pending.id,secret:pending.secret})});const data=await res.json();if(!res.ok||!data.success)throw Object.assign(new Error(data.code||'PAIRING_NOT_APPROVED'),{code:data.code});saveDesktopAuthorizationSession({token:data.token,userId:data.userId,deviceId:data.deviceId},storage);storage.removeItem(PENDING_KEY);return data;}
