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
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export function createDirectSyncTransport(options = {}) {
  const baseUrl = normalizeApiBaseUrl(options.baseUrl || 'http://127.0.0.1:3001');
  const fetchImpl = options.fetchImpl || fetch;
  const deviceId = options.deviceId || 'desktop';
  const role = options.role || 'desktop-client';
  const authContext = options.authContext || null;
  const authorization = options.authorization || '';
  const authenticatedHeaders = () => ({ ...(authorization ? { Authorization: authorization } : {}),
    ...(authContext?.deviceId ? { 'x-device-id': authContext.deviceId } : {}) });

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
        const res = await fetchImpl(`${baseUrl}/api/health`, { method: 'GET' });
        const data = await readJsonResponse(res);
        return { ok: data?.ok !== false, data };
      } catch (error) {
        return { ok: false, reason: error.message };
      }
    },
    async preview(input = {}) {
      try {
        const url = new URL(`${baseUrl}/api/sync`);
        url.searchParams.set('since', toIsoTime(input.lastSyncTime));
        url.searchParams.set('deviceId', input.deviceId || deviceId);
        const data = await readJsonResponse(await fetchImpl(url.toString(), {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', ...authenticatedHeaders() },
        }));
        return {
          success: !!data.success,
          hostOnline: true,
          incomingChanges: data.changes || [],
          serverTimestamp: toTimestamp(data.serverTimestamp || data.serverTime || data.server_time),
        };
      } catch (error) {
        return { success: false, hostOnline: false, incomingChanges: [], error: error.message };
      }
    },
    async pushSyncBatch(batch) {
      if (!authContext?.userId || !authContext?.deviceId || !authorization) {
        const error = new Error('AUTHORIZATION_CONTEXT_REQUIRED'); error.code = 'AUTHORIZATION_CONTEXT_REQUIRED'; throw error;
      }
      const batchDeviceId = batch.deviceId || batch.clientId || deviceId;
      await post('/api/sync/devices/register', {
        deviceId: batchDeviceId,
        role,
        deviceName: options.deviceName || batchDeviceId,
      }, authenticatedHeaders());
      const auth = await post('/api/sync/authorize', {
        deviceId: batchDeviceId,
        role,
      }, authenticatedHeaders());
      const data = await post('/api/sync/push', {
        deviceId: batchDeviceId,
        tenantId: batch.tenantId || 'default',
        changes: batch.changes || batch.operations || [],
        syncAuthorizationToken: auth?.authorization?.token,
      }, {
        'x-sync-authorization': auth?.authorization?.token || '',
        ...authenticatedHeaders(),
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
      const url = new URL(`${baseUrl}/api/sync`);
      url.searchParams.set('since', toIsoTime(lastSyncTs));
      url.searchParams.set('deviceId', deviceId);
      const data = await readJsonResponse(await fetchImpl(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', ...authenticatedHeaders() },
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
  const authContext = options.authContext || null;
  const authorization = options.authorization || '';
  const headers = () => ({
    'Content-Type': 'application/json',
    ...(desktopSyncToken ? { 'x-gewu-desktop-sync-token': desktopSyncToken } : {}),
    ...(authorization ? { Authorization: authorization } : {}),
    ...(authContext?.deviceId ? { 'x-device-id': authContext.deviceId } : {}),
  });
  return {
    name: 'cloud',
    label: 'Cloud relay',
    queueOnly: true,
    async check() {
      if (!baseUrl) return { ok: false, reason: 'cloud base url is not configured' };
      try {
        const data = await readJsonResponse(await fetchImpl(`${baseUrl}/api/cloud/host/status`, {
          method: 'GET',
          headers: headers(),
        }));
        return { ok: !!data.success, hostOnline: !!data.online, data };
      } catch (error) {
        return { ok: false, reason: error.message };
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
      if (!authContext?.userId || !authContext?.deviceId || !authorization) {
        const error = new Error('AUTHORIZATION_CONTEXT_REQUIRED'); error.code = 'AUTHORIZATION_CONTEXT_REQUIRED'; throw error;
      }
      const data = await readJsonResponse(await fetchImpl(`${baseUrl}/api/cloud/desktop-sync/requests`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          deviceId,
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
      const data = await readJsonResponse(await fetchImpl(`${baseUrl}/api/cloud/desktop-sync/requests/${encodeURIComponent(requestId)}/result`, {
        method: 'GET',
        headers: headers(),
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
  const headers = {
    'Content-Type': 'application/json',
    ...(desktopSyncToken ? { 'x-gewu-desktop-sync-token': desktopSyncToken } : {}),
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
    authorization: options.authorization,
    authContext: options.authContext,
    fetchImpl,
  }));
}
