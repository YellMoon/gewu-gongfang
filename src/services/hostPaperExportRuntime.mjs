import { readDesktopAuthorizationSession } from './desktopAuthorizationSession.mjs';

export async function requestHostPaperExportRuntime(apiBase, input, deps = {}) {
  const session = readDesktopAuthorizationSession(deps.storage || globalThis.sessionStorage);
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const response = await fetchImpl(`${apiBase}/paper-export`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: session.authorization, 'x-device-id': session.authContext.deviceId }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) throw new Error(payload.error || payload.code || 'host paper export failed');
  return payload.data;
}
