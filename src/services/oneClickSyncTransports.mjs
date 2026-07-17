import { resolveOnlineSyncActor } from './pairingApiBase.mjs';

export function normalizeApiBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed.slice(0, -4) : trimmed;
}

function toIsoTime(value) {
  if (!value) return '1970-01-01T00:00:00.000Z';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return value > 0 ? new Date(value).toISOString() : '1970-01-01T00:00:00.000Z';
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? '1970-01-01T00:00:00.000Z' : new Date(parsed).toISOString();
}

function toTimestamp(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

async function readJsonResponse(res) {
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data?.error || data?.code || `HTTP ${res.status}`);
    error.code = data?.code || `HTTP_${res.status}`;
    throw error;
  }
  return data;
}

async function requireOnlineSession(options) {
  if (typeof options?.sessionResolver !== 'function') {
    const error = new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
    error.code = 'ONLINE_DESKTOP_SESSION_REQUIRED';
    throw error;
  }
  return resolveOnlineSyncActor(await options.sessionResolver());
}

export function createDirectSyncTransport(options = {}) {
  const baseUrl = normalizeApiBaseUrl(options.baseUrl || 'http://127.0.0.1:3001');
  const fetchImpl = options.fetchImpl || fetch;
  const deviceId = options.deviceId || 'desktop';
  const role = options.role || 'desktop-client';
  const resolveSession = async () => requireOnlineSession(options);
  const authenticatedHeaders = session => ({ ...(session?.authorization ? { Authorization: session.authorization } : {}),
    ...(session?.authContext?.deviceId ? { 'x-device-id': session.authContext.deviceId } : {}) });

  async function post(path, body, headers = {}) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body || {}),
    });
    return readJsonResponse(res);
  }

  return {
    name: 'direct',
    label: 'LAN direct',
    baseUrl,
    async check() {
      try {
        const session = await resolveSession();
        const res = await fetchImpl(`${baseUrl}/api/health`, {
          method: 'GET',
          headers: authenticatedHeaders(session),
        });
        const data = await readJsonResponse(res);
        return { ok: data?.ok !== false, data };
      } catch (error) {
        return { ok: false, code: error.code || 'DIRECT_UNREACHABLE', reason: error.message };
      }
    },
    async preview(input = {}) {
      try {
        const session = await resolveSession();
        const url = new URL(`${baseUrl}/api/sync`);
        url.searchParams.set('since', toIsoTime(input.lastSyncTime));
        url.searchParams.set('deviceId', session?.authContext?.deviceId || input.deviceId || deviceId);
        const data = await readJsonResponse(await fetchImpl(url.toString(), {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', ...authenticatedHeaders(session) },
        }));
        return {
          success: !!data.success,
          hostOnline: true,
          incomingChanges: data.changes || [],
          serverTimestamp: toTimestamp(data.serverTimestamp || data.serverTime || data.server_time),
        };
      } catch (error) {
        return { success: false, hostOnline: false, incomingChanges: [], code: error.code || 'DIRECT_PREVIEW_FAILED', error: error.message };
      }
    },
    async pushSyncBatch(batch) {
      const session = await resolveSession();
      const batchDeviceId = session.authContext.deviceId;
      await post('/api/sync/devices/register', {
        deviceId: batchDeviceId,
        role,
        deviceName: options.deviceName || batchDeviceId,
      }, authenticatedHeaders(session));
      const auth = await post('/api/sync/authorize', {
        deviceId: batchDeviceId,
        role,
      }, authenticatedHeaders(session));
      const data = await post('/api/sync/push', {
        deviceId: batchDeviceId,
        tenantId: batch.tenantId || 'default',
        changes: batch.changes || batch.operations || [],
        syncAuthorizationToken: auth?.authorization?.token,
      }, {
        'x-sync-authorization': auth?.authorization?.token || '',
        ...authenticatedHeaders(session),
      });
      return {
        success: !!data.success,
        serverTimestamp: toTimestamp(data.serverTimestamp || data.serverTime || data.server_time),
        applied: data.applied || 0,
        conflicts: data.conflicts || 0,
        errors: data.errors || [],
      };
    },
    async pullSyncOps(lastSyncTs) {
      const session = await resolveSession();
      const url = new URL(`${baseUrl}/api/sync`);
      url.searchParams.set('since', toIsoTime(lastSyncTs));
      url.searchParams.set('deviceId', session?.authContext?.deviceId || deviceId);
      const data = await readJsonResponse(await fetchImpl(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', ...authenticatedHeaders(session) },
      }));
      const changes = data.changes || [];
      return {
        success: !!data.success,
        changes,
        operations: changes,
        serverTimestamp: toTimestamp(data.serverTimestamp || data.serverTime || data.server_time),
      };
    },
  };
}

export function createCloudRelaySyncTransport(options = {}) {
  const baseUrl = normalizeApiBaseUrl(options.baseUrl || '');
  const fetchImpl = options.fetchImpl || fetch;
  const deviceId = options.deviceId || 'desktop';
  const desktopSyncToken = options.desktopSyncToken || '';
  const resolveSession = async () => requireOnlineSession(options);
  const headers = session => ({
    'Content-Type': 'application/json',
    ...(desktopSyncToken ? { 'x-gewu-desktop-sync-token': desktopSyncToken } : {}),
    ...(session?.authorization ? { Authorization: session.authorization } : {}),
    ...(session?.authContext?.deviceId ? { 'x-device-id': session.authContext.deviceId } : {}),
  });
  return {
    name: 'cloud',
    label: 'Cloud relay',
    queueOnly: true,
    async check() {
      if (!baseUrl) return { ok: false, code: 'CLOUD_CONFIG_MISSING', reason: 'cloud base url is not configured' };
      try {
        const session = await resolveSession();
        const data = await readJsonResponse(await fetchImpl(`${baseUrl}/api/cloud/host/status`, {
          method: 'GET',
          headers: headers(session),
        }));
        return { ok: !!data.success, hostOnline: !!data.online, data };
      } catch (error) {
        return { ok: false, code: error.code || 'CLOUD_UNREACHABLE', reason: error.message };
      }
    },
    async preview() {
      const check = await this.check();
      return {
        success: check.ok,
        hostOnline: !!check.hostOnline,
        incomingChanges: [],
      };
    },
    async submitSyncRequest(input = {}) {
      const session = await resolveSession();
      await readJsonResponse(await fetchImpl(`${baseUrl}/api/cloud/desktop-sync/devices/register`, {
        method:'POST', headers:headers(session), body:JSON.stringify({ deviceId:session.authContext.deviceId }),
      }));
      const data = await readJsonResponse(await fetchImpl(`${baseUrl}/api/cloud/desktop-sync/requests`, {
        method: 'POST',
        headers: headers(session),
        body: JSON.stringify({
          deviceId: session.authContext.deviceId,
          tenantId: input.tenantId || 'default',
          pendingChanges: input.pendingChanges || [],
          preview: input.preview || null,
        }),
      }));
      return {
        success: !!data.success,
        requestId: data.request?.id,
        status: data.request?.status,
        acceptedChanges: data.request?.acceptedChanges || 0,
      };
    },
    async pollSyncRequest(requestId) {
      const session = await resolveSession();
      const data = await readJsonResponse(await fetchImpl(`${baseUrl}/api/cloud/desktop-sync/requests/${encodeURIComponent(requestId)}/result`, {
        method: 'GET',
        headers: headers(session),
      }));
      return data.request || null;
    },
  };
}

function isLocalBaseUrl(value) {
  const text = String(value || '').toLowerCase();
  return text.includes('127.0.0.1') || text.includes('localhost') || text.includes('[::1]');
}

function parseLanUrls(value) {
  const raw = Array.isArray(value) ? value : (() => {
    try {
      return JSON.parse(value || '[]');
    } catch (_err) {
      return [];
    }
  })();
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(
    raw
      .map(url => normalizeApiBaseUrl(url))
      .filter(url => url && !isLocalBaseUrl(url))
  ));
}

export async function discoverLanDirectSyncTransports(options = {}) {
  const baseUrl = normalizeApiBaseUrl(options.baseUrl || '');
  if (!baseUrl) return [];
  const fetchImpl = options.fetchImpl || fetch;
  const desktopSyncToken = options.desktopSyncToken || '';
  const session = await requireOnlineSession(options);
  const headers = {
    'Content-Type': 'application/json',
    ...(desktopSyncToken ? { 'x-gewu-desktop-sync-token': desktopSyncToken } : {}),
    ...(session?.authorization ? { Authorization: session.authorization } : {}),
    ...(session?.authContext?.deviceId ? { 'x-device-id': session.authContext.deviceId } : {}),
  };
  const data = await readJsonResponse(await fetchImpl(`${baseUrl}/api/cloud/host/status`, {
    method: 'GET',
    headers,
  }));
  const host = data.host || {};
  const candidates = [
    ...parseLanUrls(host.lanUrls || host.lan_urls),
    ...parseLanUrls([host.baseUrl || host.base_url]),
  ];
  return Array.from(new Set(candidates)).map(url => createDirectSyncTransport({
    baseUrl: url,
    deviceId: options.deviceId,
    role: options.role,
    deviceName: options.deviceName,
    sessionResolver: options.sessionResolver,
    fetchImpl,
  }));
}
