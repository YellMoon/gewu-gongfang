import { readDesktopAuthorizationSession } from './desktopAuthorizationSession.mjs';

export async function requestHostPaperExportRuntime(apiBase, input, deps = {}) {
  const session = readDesktopAuthorizationSession(deps.storage || globalThis.sessionStorage);
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const idempotencyKey = (deps.idempotencyKeyFactory || (() => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`))();
  const response = await fetchImpl(`${apiBase}/paper-export`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: session.authorization, 'x-device-id': session.authContext.deviceId, 'x-idempotency-key': idempotencyKey }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) throw new Error(payload.error || payload.code || 'host paper export failed');
  return payload.data;
}

export async function downloadHostArtifactRuntime(_apiBase, result, deps = {}) {
  const session = readDesktopAuthorizationSession(deps.storage || globalThis.sessionStorage);
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const headers = token => ({ Authorization: session.authorization, 'x-device-id': session.authContext.deviceId, 'x-gewu-artifact-token': token });
  let token = result.token; let fileUrl = result.fileUrl;
  let response = await fetchImpl(fileUrl, { headers: headers(token) });
  if ([401, 410].includes(response.status)) {
    const refreshed = await fetchImpl(result.accessUrl, { method: 'GET', headers: { Authorization: session.authorization, 'x-device-id': session.authContext.deviceId } });
    const payload = await refreshed.json().catch(() => ({}));
    if (!refreshed.ok || !payload.success) throw new Error(payload.error || payload.code || 'artifact access refresh failed');
    token = payload.data.token; fileUrl = payload.data.fileUrl || fileUrl;
    response = await fetchImpl(fileUrl, { headers: headers(token) });
  }
  if (!response.ok) throw new Error(`artifact download failed (${response.status})`);
  const blob = await response.blob();
  const createObjectURL = deps.createObjectURL || (value => URL.createObjectURL(value));
  const revokeObjectURL = deps.revokeObjectURL || (value => URL.revokeObjectURL(value));
  const anchor = (deps.createAnchor || (() => document.createElement('a')))();
  const blobUrl = createObjectURL(blob);
  try { anchor.href = blobUrl; anchor.download = result.fileName; anchor.rel = 'noopener'; anchor.click(); }
  finally { revokeObjectURL(blobUrl); }
}
