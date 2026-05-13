import type { SyncBatch, SyncOperation, SyncTable } from './syncEngine';

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

function batchToChanges(batch: SyncBatch): Record<string, any[]> {
  return batch.operations.reduce<Record<string, any[]>>((changes, op) => {
    const tableChanges = changes[op.table] || [];
    const baseRecord = op.action === 'create' ? { ...(op.data || {}) } : { ...(op.fields || {}) };
    tableChanges.push({
      ...baseRecord,
      id: op.recordId,
      deleted: op.action === 'delete' ? 1 : (baseRecord as any).deleted || 0,
      updated_at: new Date(op.timestamp).toISOString(),
      _sync_operation_id: op.id,
      _sync_action: op.action,
      _sync_client_id: op.clientId,
    });
    changes[op.table] = tableChanges;
    return changes;
  }, {});
}

function changesToOperations(changes: Record<string, any[]> = {}, serverTimestamp: number): SyncOperation[] {
  return Object.entries(changes)
    .filter(([, records]) => Array.isArray(records))
    .flatMap(([table, records]) =>
      records.map((record: any) => {
        const timestamp = toTimestamp(record.updated_at || record.created_at || serverTimestamp);
        return {
          id: record._sync_operation_id || `server_${table}_${record.id}_${timestamp}`,
          table: table as SyncTable,
          recordId: String(record.id),
          action: record.deleted ? 'delete' : 'create',
          data: record.deleted ? undefined : record,
          fields: undefined,
          timestamp,
          clientId: record._sync_client_id || 'server',
          vectorClock: record.vector_clock || { server: timestamp },
        } as SyncOperation;
      }),
    );
}

export async function pushSyncBatch(batch: SyncBatch): Promise<{ success: boolean; serverTimestamp: number }> {
  try {
    const res = await fetch(`${SYNC_URL}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: batch.clientId,
        last_sync_time: toIsoTime(batch.lastSyncTimestamp),
        changes: batchToChanges(batch),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      success: !!data.success,
      serverTimestamp: toTimestamp(data.server_time || data.serverTimestamp),
    };
  } catch (e) {
    console.error('[syncApi] push error:', e);
    return { success: false, serverTimestamp: Date.now() };
  }
}

export async function pullSyncOps(
  sinceTs: number,
): Promise<{ success: boolean; operations: SyncOperation[]; serverTimestamp: number }> {
  try {
    const res = await fetch(`${SYNC_URL}/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        last_sync_time: toIsoTime(sinceTs),
        client_id: localStorage.getItem('sync_client_id') || 'electron',
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const serverTimestamp = toTimestamp(data.server_time || data.serverTimestamp);
    return {
      success: !!data.success,
      operations: changesToOperations(data.changes, serverTimestamp),
      serverTimestamp,
    };
  } catch (e) {
    console.error('[syncApi] pull error:', e);
    return { success: false, operations: [], serverTimestamp: Date.now() };
  }
}
