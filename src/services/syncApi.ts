import type { SyncBatch, SyncChange } from './syncEngine';

const BASE_URL = (process.env.REACT_APP_API_BASE || '').replace(/\/$/, '');
const SYNC_URL = BASE_URL.endsWith('/api') ? `${BASE_URL}/sync` : `${BASE_URL}/api/sync`;

function toIsoTime(timestamp: number): string {
  return timestamp > 0 ? new Date(timestamp).toISOString() : '1970-01-01T00:00:00.000Z';
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
  const updatedAt = change.updatedAt
    || change.updated_at
    || data.updated_at
    || (change.timestamp ? new Date(change.timestamp).toISOString() : new Date().toISOString());
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

export async function pushSyncBatch(batch: SyncBatch): Promise<{ success: boolean; serverTimestamp: number }> {
  const changes = (batch.changes || batch.operations || []).map(change => normalizeChange(change, batch.deviceId || batch.clientId));
  try {
    const res = await fetch(`${SYNC_URL}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: batch.deviceId || batch.clientId,
        client_id: batch.clientId || batch.deviceId,
        tenantId: batch.tenantId || 'default',
        since: toIsoTime(batch.lastSyncTimestamp),
        changes,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      success: !!data.success,
      serverTimestamp: toTimestamp(data.serverTime || data.server_time || data.serverTimestamp),
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
    const url = new URL(SYNC_URL || '/api/sync', window.location.origin);
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
