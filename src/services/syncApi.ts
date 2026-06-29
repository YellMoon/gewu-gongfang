import type { SyncBatch, SyncChange } from './syncEngine';
import { getRuntimeConfig } from './runtimeConfigClient';

function normalizeSyncBaseUrl(baseUrl: string): string {
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (!base) return '';
  if (base.endsWith('/api/sync')) return base;
  if (base.endsWith('/api')) return `${base}/sync`;
  return `${base}/api/sync`;
}

async function getConfiguredHostBaseUrl(): Promise<string> {
  try {
    const runtimeConfig = await getRuntimeConfig();
    if (runtimeConfig?.hostBaseUrl) return runtimeConfig.hostBaseUrl;
  } catch {
    // Browser preview or old builds may not expose Electron runtime config.
  }
  return process.env.REACT_APP_API_BASE || '';
}

export async function getSyncBaseUrl(): Promise<string> {
  const configured = normalizeSyncBaseUrl(await getConfiguredHostBaseUrl());
  if (configured) return configured;
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    if (protocol === 'file:' || (hostname === 'localhost' && port === '3000')) {
      return 'http://localhost:3001/api/sync';
    }
  }
  return '/api/sync';
}

export async function getSyncUrl(path = ''): Promise<string> {
  const base = await getSyncBaseUrl();
  if (!path) return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function toIsoTime(value: number | string | Date | undefined): string {
  if (!value) return '1970-01-01T00:00:00.000Z';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return value > 0 ? new Date(value).toISOString() : '1970-01-01T00:00:00.000Z';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? '1970-01-01T00:00:00.000Z' : new Date(parsed).toISOString();
}

function toTimestamp(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function normalizeChange(change: any, fallbackDeviceId = 'desktop'): SyncChange {
  const data = { ...(change.data || change.fields || {}) };
  const recordId = data.id || change.recordId || change.record_id || change.id;
  const updatedAt = toIsoTime(change.updatedAt
    || change.updated_at
    || data.updated_at
    || change.timestamp
    || Date.now());
  return {
    id: change.id || `${change.table}:${recordId}:${updatedAt}`,
    table: change.table,
    action: change.action || (data.deleted ? 'delete' : 'update'),
    data: { ...data, id: recordId },
    version: change.version || updatedAt,
    updatedAt,
    tenantId: change.tenantId || change.tenant_id || data.tenant_id || 'default',
    deviceId: change.deviceId || change.device_id || change.clientId || change.client_id || fallbackDeviceId,
  };
}

function getDeviceId(): string {
  try {
    return localStorage.getItem('sync_engine_sync_device_id')
      ? JSON.parse(localStorage.getItem('sync_engine_sync_device_id') || '"desktop"')
      : 'desktop';
  } catch {
    return 'desktop';
  }
}

export async function registerSyncDevice(input: { deviceId: string; role: string; deviceName?: string }) {
  const res = await fetch(await getSyncUrl('/devices/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: input.deviceId,
      role: input.role,
      deviceName: input.deviceName,
    }),
  });
  return res.json();
}

export async function requestSyncAuthorization(input: { deviceId: string; role: string }) {
  const res = await fetch(await getSyncUrl('/authorize'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: input.deviceId, role: input.role }),
  });
  return res.json();
}

export async function pushSyncBatch(
  batch: SyncBatch,
  options: { authorizationToken?: string } = {},
): Promise<{ success: boolean; serverTimestamp: number; applied?: number; conflicts?: number; errors?: any[] }> {
  const changes = (batch.changes || batch.operations || []).map(change => normalizeChange(change, batch.deviceId || batch.clientId));
  try {
    const res = await fetch(await getSyncUrl('/push'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sync-authorization': options.authorizationToken || '',
      },
      body: JSON.stringify({
        deviceId: batch.deviceId || batch.clientId,
        client_id: batch.clientId || batch.deviceId,
        tenantId: batch.tenantId || 'default',
        since: toIsoTime(batch.lastSyncTimestamp),
        changes,
        syncAuthorizationToken: options.authorizationToken,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      success: !!data.success,
      serverTimestamp: toTimestamp(data.serverTime || data.server_time || data.serverTimestamp),
      applied: data.applied,
      conflicts: data.conflicts,
      errors: data.errors,
    };
  } catch (e) {
    console.error('[syncApi] push error:', e);
    return { success: false, serverTimestamp: Date.now() };
  }
}

export async function pullSyncOps(
  sinceTs: number,
): Promise<{ success: boolean; changes: SyncChange[]; operations: SyncChange[]; serverTimestamp: number }> {
  try {
    const url = new URL(await getSyncUrl(), window.location.origin);
    url.searchParams.set('since', toIsoTime(sinceTs));
    url.searchParams.set('deviceId', getDeviceId());
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const serverTimestamp = toTimestamp(data.serverTime || data.server_time || data.serverTimestamp);
    const changes = (data.changes || []).map((change: any) => normalizeChange(change, 'server'));
    return {
      success: !!data.success,
      changes,
      operations: changes,
      serverTimestamp,
    };
  } catch (e) {
    console.error('[syncApi] pull error:', e);
    return { success: false, changes: [], operations: [], serverTimestamp: Date.now() };
  }
}
