import { v4 as uuid } from 'uuid';

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
  resolvedFields?: Record<string, any>;
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

export const SYNC_TABLES: SyncTable[] = [
  'students', 'courses', 'schedules', 'payments', 'consumptions',
  'teachers', 'grades', 'rooms', 'institutions', 'assetRecords',
  'questions', 'assetCategories',
];

function toIsoTime(value: number | string | Date | undefined): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

export class SyncEngine {
  private deviceId: string;
  private tenantId: string;
  private storage: SyncStorage;
  private pendingChanges: SyncChange[];

  constructor(deviceId?: string, storage?: SyncStorage, tenantId = 'default') {
    this.storage = storage || new DefaultSyncStorage();
    this.deviceId = deviceId || this.loadDeviceId();
    this.tenantId = tenantId;
    this.pendingChanges = this.loadPendingChanges();
  }

  private loadDeviceId(): string {
    const stored = this.storage.get<string>('sync_device_id') || this.storage.get<string>('sync_client_id');
    if (stored) return stored;
    const id = `desktop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
    this.storage.set('sync_device_id', id);
    this.storage.set('sync_client_id', id);
    return id;
  }

  getClientId(): string {
    return this.deviceId;
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  getVectorClock(): Record<string, number> {
    return {};
  }

  private loadPendingChanges(): SyncChange[] {
    const current = this.storage.get<SyncChange[]>('sync_pending_changes');
    if (current) return current;
    const legacy = this.storage.get<any[]>('sync_pending_ops') || [];
    return legacy.map(op => this.normalizeLegacyOperation(op));
  }

  private savePendingChanges(): void {
    this.storage.set('sync_pending_changes', this.pendingChanges);
    this.storage.set('sync_pending_ops', this.pendingChanges);
  }

  private normalizeLegacyOperation(op: any): SyncChange {
    const updatedAt = toIsoTime(op.updatedAt || op.timestamp || op.data?.updated_at || op.fields?.updated_at);
    const data = op.action === 'update'
      ? { ...(op.fields || {}), id: op.recordId || op.data?.id }
      : { ...(op.data || {}), id: op.recordId || op.data?.id };
    return {
      id: op.id || uuid(),
      table: op.table,
      action: op.action,
      data,
      version: op.version || updatedAt,
      updatedAt,
      tenantId: op.tenantId || this.tenantId,
      deviceId: op.deviceId || op.clientId || this.deviceId,
    };
  }

  getPendingCount(): number {
    return this.pendingChanges.length;
  }

  getPendingOps(): SyncChange[] {
    return [...this.pendingChanges];
  }

  getPendingChanges(): SyncChange[] {
    return [...this.pendingChanges];
  }

  createOperation(table: SyncTable, recordId: string, action: SyncAction, data?: any, fields?: Record<string, any>): SyncChange {
    const updatedAt = toIsoTime((data || fields)?.updated_at || Date.now());
    const payload = action === 'update'
      ? { ...(fields || {}), id: recordId }
      : { ...(data || {}), id: recordId };
    const change: SyncChange = {
      id: uuid(),
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

  createOperations(ops: Array<{ table: SyncTable; recordId: string; action: SyncAction; data?: any; fields?: Record<string, any> }>): SyncChange[] {
    return ops.map(op => this.createOperation(op.table, op.recordId, op.action, op.data, op.fields));
  }

  async push(pushFn: (batch: SyncBatch) => Promise<{ success: boolean; serverTimestamp: number }>): Promise<{ pushed: number; success: boolean }> {
    if (this.pendingChanges.length === 0) return { pushed: 0, success: true };

    const changes = [...this.pendingChanges];
    const batch: SyncBatch = {
      changes,
      operations: changes,
      lastSyncTimestamp: this.storage.get<number>('sync_last_ts') || 0,
      deviceId: this.deviceId,
      clientId: this.deviceId,
      tenantId: this.tenantId,
    };

    try {
      const result = await pushFn(batch);
      if (result.success) {
        this.pendingChanges = [];
        this.savePendingChanges();
        this.storage.set('sync_last_ts', result.serverTimestamp);
        this.storage.set('sync_last_result', 'success');
        return { pushed: changes.length, success: true };
      }
      this.storage.set('sync_last_result', 'error');
      return { pushed: 0, success: false };
    } catch (err) {
      console.error('[SyncEngine] push failed:', err);
      this.storage.set('sync_last_result', 'error');
      return { pushed: 0, success: false };
    }
  }

  async pull(
    pullFn: (lastSyncTs: number) => Promise<{ success: boolean; changes: SyncChange[]; operations?: SyncChange[]; serverTimestamp: number }>,
    localData: Partial<Record<SyncTable, Map<string, any>>>,
  ): Promise<{ applied: number; conflicts: SyncConflict[]; success: boolean }> {
    const lastSyncTs = this.storage.get<number>('sync_last_ts') || 0;

    try {
      const result = await pullFn(lastSyncTs);
      if (!result.success) return { applied: 0, conflicts: [], success: false };

      const incoming = result.changes || result.operations || [];
      const conflicts: SyncConflict[] = [];
      let applied = 0;

      for (const change of incoming) {
        const localRecord = localData[change.table]?.get(change.data?.id);
        const merged = this.mergeChange(change, localRecord);
        if (merged.conflict) conflicts.push(merged.conflict);
        if (merged.apply) {
          applied++;
          const map = localData[change.table];
          if (map) this.applyChangeToLocal(change, map);
        }
      }

      this.storage.set('sync_last_ts', result.serverTimestamp);
      this.storage.set('sync_last_result', conflicts.length > 0 ? 'partial' : 'success');
      return { applied, conflicts, success: true };
    } catch (err) {
      console.error('[SyncEngine] pull failed:', err);
      this.storage.set('sync_last_result', 'error');
      return { applied: 0, conflicts: [], success: false };
    }
  }

  private mergeChange(change: SyncChange, localRecord: any | undefined): { apply: boolean; conflict?: SyncConflict } {
    const hasPendingLocal = this.pendingChanges.some(
      pending => pending.table === change.table
        && pending.data?.id === change.data?.id
        && pending.updatedAt > change.updatedAt,
    );
    if (hasPendingLocal) {
      return {
        apply: false,
        conflict: { change, serverData: change.data, resolution: 'local-wins' },
      };
    }
    if (!localRecord) return { apply: true };
    const localUpdatedAt = toIsoTime(localRecord.updated_at || localRecord.updatedAt || 0);
    return { apply: change.updatedAt >= localUpdatedAt };
  }

  private applyChangeToLocal(change: SyncChange, localMap: Map<string, any>): void {
    const recordId = change.data?.id;
    if (!recordId) return;
    if (change.action === 'delete') {
      localMap.delete(recordId);
      return;
    }
    localMap.set(recordId, { ...change.data, _synced: true });
  }

  resolveConflict(conflict: SyncConflict, resolution: 'local-wins' | 'server-wins'): void {
    conflict.resolution = resolution;
  }

  getStatus(): SyncStatus {
    return {
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      pendingCount: this.pendingChanges.length,
      lastSyncTime: this.storage.get<number>('sync_last_ts') || null,
      lastSyncResult: this.storage.get<SyncStatus['lastSyncResult']>('sync_last_result') || null,
    };
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
}

export interface SyncStorage {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
}

class DefaultSyncStorage implements SyncStorage {
  private prefix = 'sync_engine_';

  get<T>(key: string): T | null {
    try {
      const val = localStorage.getItem(this.prefix + key);
      return val ? JSON.parse(val) : null;
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (e) {
      console.error('[SyncEngine/Storage] write failed:', key, e);
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(this.prefix + key);
    } catch {
      // ignore
    }
  }
}

export default SyncEngine;
