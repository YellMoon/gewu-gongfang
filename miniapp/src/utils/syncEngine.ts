import Taro from '@tarojs/taro';

export type SyncTable =
  | 'students' | 'courses' | 'schedules' | 'payments' | 'consumptions'
  | 'teachers' | 'grades' | 'rooms' | 'institutions' | 'assetRecords'
  | 'questions' | 'assetCategories';

export type SyncAction = 'create' | 'update' | 'delete';

export interface SyncChange {
  id: string;
  table: SyncTable;
  action: SyncAction;
  data: any;
  version: string;
  updatedAt: string;
  tenantId: string;
  deviceId: string;
}

export type SyncOperation = SyncChange;

export interface SyncBatch {
  changes: SyncChange[];
  operations: SyncChange[];
  lastSyncTimestamp: number;
  deviceId: string;
  clientId: string;
  tenantId: string;
}

export interface SyncConflict {
  change: SyncChange;
  serverData: any;
  resolution: 'local-wins' | 'server-wins' | 'manual';
}

export interface SyncResult {
  success: boolean;
  applied: number;
  conflicts: SyncConflict[];
  serverChanges: SyncChange[];
  serverTimestamp: number;
}

export interface SyncStatus {
  online: boolean;
  pendingCount: number;
  lastSyncTime: number | null;
  lastSyncResult: 'success' | 'partial' | 'error' | null;
}

class TaroSyncStorage {
  private prefix = 'sync_engine_';

  get<T>(key: string): T | null {
    try {
      const val = Taro.getStorageSync(this.prefix + key);
      return val || null;
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T): void {
    try {
      Taro.setStorageSync(this.prefix + key, value);
    } catch (e) {
      console.error('[SyncEngine/Storage] write failed:', key, e);
    }
  }

  remove(key: string): void {
    try {
      Taro.removeStorageSync(this.prefix + key);
    } catch {
      // ignore
    }
  }
}

function toIsoTime(value: number | string | undefined): string {
  if (!value) return new Date().toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function normalizeChange(change: any, fallbackDeviceId: string, fallbackTenantId = 'default'): SyncChange {
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
    tenantId: change.tenantId || change.tenant_id || data.tenant_id || fallbackTenantId,
    deviceId: change.deviceId || change.device_id || change.clientId || change.client_id || fallbackDeviceId,
  };
}

export class MiniSyncEngine {
  private deviceId: string;
  private tenantId = 'default';
  private storage: TaroSyncStorage;
  private pendingChanges: SyncChange[];

  constructor() {
    this.storage = new TaroSyncStorage();
    this.deviceId = this.loadDeviceId();
    this.pendingChanges = this.loadPendingChanges();
  }

  private generateDeviceId(): string {
    return `miniapp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private loadDeviceId(): string {
    const stored = this.storage.get<string>('sync_device_id') || this.storage.get<string>('sync_client_id');
    if (stored) return stored;
    const id = this.generateDeviceId();
    this.storage.set('sync_device_id', id);
    this.storage.set('sync_client_id', id);
    return id;
  }

  getClientId(): string { return this.deviceId; }
  getDeviceId(): string { return this.deviceId; }

  private loadPendingChanges(): SyncChange[] {
    const current = this.storage.get<SyncChange[]>('sync_pending_changes');
    if (current) return current;
    const legacy = this.storage.get<any[]>('sync_pending_ops') || [];
    return legacy.map(change => normalizeChange(change, this.deviceId, this.tenantId));
  }

  private savePendingChanges(): void {
    this.storage.set('sync_pending_changes', this.pendingChanges);
    this.storage.set('sync_pending_ops', this.pendingChanges);
  }

  getPendingCount(): number { return this.pendingChanges.length; }
  getPendingChanges(): SyncChange[] { return [...this.pendingChanges]; }

  createOperation(table: SyncTable, recordId: string, action: SyncAction, data?: any, fields?: Record<string, any>): SyncChange {
    const payload = action === 'update'
      ? { ...(fields || {}), id: recordId }
      : { ...(data || {}), id: recordId };
    const updatedAt = toIsoTime(payload.updated_at || Date.now());
    const change: SyncChange = {
      id: `chg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      table,
      action,
      data: payload,
      version: updatedAt,
      updatedAt,
      tenantId: payload.tenant_id || this.tenantId,
      deviceId: this.deviceId,
    };
    this.pendingChanges.push(change);
    this.savePendingChanges();
    return change;
  }

  async push(baseUrl: string, token: string): Promise<{ pushed: number; success: boolean }> {
    if (this.pendingChanges.length === 0) return { pushed: 0, success: true };
    const changes = [...this.pendingChanges];

    try {
      const res = await Taro.request({
        url: `${baseUrl}/api/sync/push`,
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
        },
        data: {
          changes,
          deviceId: this.deviceId,
          client_id: this.deviceId,
          tenantId: this.tenantId,
          lastSyncTimestamp: this.storage.get<number>('sync_last_ts') || 0,
        },
        timeout: 30000,
      });

      if (res.statusCode === 200 && (res.data as any)?.success) {
        this.pendingChanges = [];
        this.savePendingChanges();
        this.storage.set('sync_last_ts', (res.data as any).serverTimestamp || Date.now());
        this.storage.set('sync_last_result', 'success');
        return { pushed: changes.length, success: true };
      }
      this.storage.set('sync_last_result', 'error');
      return { pushed: 0, success: false };
    } catch (err) {
      console.error('[MiniSyncEngine] push failed:', err);
      this.storage.set('sync_last_result', 'error');
      return { pushed: 0, success: false };
    }
  }

  async pull(baseUrl: string, token: string): Promise<{ operations: SyncChange[]; changes: SyncChange[]; success: boolean }> {
    const lastSyncTs = this.storage.get<number>('sync_last_ts') || 0;

    try {
      const res = await Taro.request({
        url: `${baseUrl}/api/sync?since=${encodeURIComponent(toIsoTime(lastSyncTs))}&deviceId=${encodeURIComponent(this.deviceId)}`,
        method: 'GET',
        header: {
          'Authorization': token ? `Bearer ${token}` : '',
        },
        timeout: 30000,
      });

      if (res.statusCode === 200 && (res.data as any)?.success) {
        const changes = (((res.data as any).changes || []) as any[]).map(change => normalizeChange(change, 'server'));
        this.storage.set('sync_last_ts', (res.data as any).serverTimestamp || Date.now());
        this.storage.set('sync_last_result', 'success');
        return { operations: changes, changes, success: true };
      }

      this.storage.set('sync_last_result', 'error');
      return { operations: [], changes: [], success: false };
    } catch (err) {
      console.error('[MiniSyncEngine] pull failed:', err);
      this.storage.set('sync_last_result', 'error');
      return { operations: [], changes: [], success: false };
    }
  }

  clearPending(): void {
    this.pendingChanges = [];
    this.savePendingChanges();
  }

  reset(): void {
    this.pendingChanges = [];
    this.savePendingChanges();
    this.storage.remove('sync_last_ts');
    this.storage.remove('sync_last_result');
  }

  getStatus(): SyncStatus {
    return {
      online: true,
      pendingCount: this.pendingChanges.length,
      lastSyncTime: this.storage.get<number>('sync_last_ts') || null,
      lastSyncResult: this.storage.get<SyncStatus['lastSyncResult']>('sync_last_result') || null,
    };
  }
}

export default MiniSyncEngine;
